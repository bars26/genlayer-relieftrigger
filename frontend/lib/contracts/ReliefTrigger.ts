import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Pool, TransactionReceipt } from "./types";
import { ReliefError, classifyError, rawMessage } from "../utils/errors";
import { withBackoff } from "../utils/retry";

export type TxStep = "awaiting_wallet" | "submitted" | "retrying" | "accepted";

export interface TxProgress {
  step: TxStep;
  txHash?: string;
  message?: string;
}

export interface TxResult {
  txHash: string;
  status: string;
  executionResult: string;
  receipt: TransactionReceipt;
  /** The contract method's return value (pool id, verdict, "paid", ...). */
  returned?: unknown;
}

/**
 * Pull the contract-execution outcome out of a consensus receipt.
 *   result.status "rollback" -> the contract raised; payload is its message.
 *   result.status "return"   -> payload.readable is the JSON-encoded return value.
 */
export function executionOutcome(receipt: any): { result: string; message: string; returned: unknown } {
  const lr = receipt?.consensus_data?.leader_receipt;
  const first = Array.isArray(lr) ? lr[0] : lr;
  const result = String(first?.execution_result ?? receipt?.execution_result ?? "UNKNOWN");
  const r = first?.result ?? {};
  let returned: unknown = undefined;
  if (r?.status === "return") {
    const readable = r?.payload?.readable;
    try {
      returned = typeof readable === "string" ? JSON.parse(readable) : readable;
    } catch {
      returned = readable;
    }
  }
  const g = first?.genvm_result ?? {};
  const message = [
    r?.status === "rollback" && typeof r?.payload === "string" ? r.payload : "",
    g.error_description,
    g.stderr,
    Array.isArray(g.raw_error?.causes) ? g.raw_error.causes.join(",") : "",
  ]
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .join(" | ");
  return { result, message, returned };
}

const WRITE_EFFECT: Record<string, string> = {
  create_pool: "no pool was created",
  donate: "the donation was not recorded",
  trigger: "no claim was recorded (validators may have failed to read GDACS or to agree)",
  contest: "the contest was not recorded",
  resolve: "nothing was paid or dismissed",
  close: "the pool was not closed",
  reclaim: "nothing was returned",
};

export interface CreatePoolInput {
  name: string;
  recipient: string;
  hazards: string;
  countries: string;
  minAlert: string;
  minSeverity: string;
  minExposed: bigint;
  areaTerms: string;
  payout: bigint;
  coverageStart: string;
  coverageEnd: string;
}

/** Typed wrapper around the ReliefTrigger Intelligent Contract. */
class ReliefTrigger {
  private contractAddress: `0x${string}`;
  private client: any;

  constructor(contractAddress: string, address?: string | null, studioUrl?: string) {
    this.contractAddress = contractAddress as `0x${string}`;
    const config: any = { chain: studionet };
    if (address) config.account = address as `0x${string}`;
    if (studioUrl) config.endpoint = studioUrl;
    this.client = createClient(config);
  }

  private read<T>(functionName: string, args: unknown[] = []): Promise<T> {
    return withBackoff(
      () => this.client.readContract({ address: this.contractAddress, functionName, args }) as Promise<T>,
      { phase: "read", attempts: 5 }
    );
  }

  listPools = () => this.read<string[]>("list_pools").then((v) => (Array.isArray(v) ? v : []));
  getPool = (id: string) => this.read<Pool>("get_pool", [id]);
  wasPaid = async (id: string, type: string, eventId: string) =>
    Boolean(await this.read<boolean>("was_paid", [id, type, eventId]));
  getContribution = (id: string, donor: string) => this.read<string>("get_contribution", [id, donor]);

  async getTransactionStatus(txHash: string): Promise<string> {
    const tx: any = await withBackoff(() => this.client.getTransaction({ hash: txHash as `0x${string}` }), {
      phase: "read",
    });
    return String(tx?.statusName ?? tx?.status_name ?? tx?.status ?? "UNKNOWN");
  }

  createPool(p: CreatePoolInput, valueWei: bigint, onProgress?: (p: TxProgress) => void) {
    return this.write(
      "create_pool",
      [p.name, p.recipient, p.hazards, p.countries, p.minAlert, p.minSeverity, p.minExposed, p.areaTerms, p.payout, p.coverageStart, p.coverageEnd],
      valueWei,
      onProgress
    );
  }
  donate(id: string, valueWei: bigint, onProgress?: (p: TxProgress) => void) {
    return this.write("donate", [id], valueWei, onProgress);
  }
  trigger(id: string, type: string, eventId: string, onProgress?: (p: TxProgress) => void) {
    return this.write("trigger", [id, type, eventId], 0n, onProgress);
  }
  contest(id: string, onProgress?: (p: TxProgress) => void) {
    return this.write("contest", [id], 0n, onProgress);
  }
  resolve(id: string, onProgress?: (p: TxProgress) => void) {
    return this.write("resolve", [id], 0n, onProgress);
  }
  close(id: string, onProgress?: (p: TxProgress) => void) {
    return this.write("close", [id], 0n, onProgress);
  }
  reclaim(id: string, onProgress?: (p: TxProgress) => void) {
    return this.write("reclaim", [id], 0n, onProgress);
  }

  /**
   * Send a write and wait for consensus. Sends are never auto-retried (each attempt would
   * prompt the wallet again); receipt polling is, because the hash is already known.
   * A call the contract reverted is still ACCEPTED by consensus, so the receipt's
   * execution_result is checked and a revert is reported as such.
   */
  private async write(
    functionName: string,
    args: unknown[],
    value: bigint,
    onProgress?: (p: TxProgress) => void
  ): Promise<TxResult> {
    onProgress?.({ step: "awaiting_wallet", message: "Approve the transaction in your wallet." });
    let txHash: string;
    try {
      txHash = (await this.client.writeContract({ address: this.contractAddress, functionName, args, value })) as string;
    } catch (err) {
      throw classifyError(err, "send");
    }
    onProgress?.({ step: "submitted", txHash, message: "Transaction sent. Waiting for validators." });

    let receipt: any;
    try {
      receipt = await withBackoff(
        () => this.client.waitForTransactionReceipt({ hash: txHash, status: "ACCEPTED" as any, retries: 60, interval: 5000 }),
        {
          phase: "confirm",
          onRetry: (i) =>
            onProgress?.({ step: "retrying", txHash, message: `RPC busy while confirming; retrying in ${Math.round(i.waitMs / 1000)}s` }),
        }
      );
    } catch (err) {
      throw classifyError(err, "confirm", txHash);
    }

    const status = String(receipt?.statusName ?? receipt?.status_name ?? "ACCEPTED");
    const outcome = executionOutcome(receipt);
    onProgress?.({ step: "accepted", txHash, message: `Consensus status: ${status}` });
    // Payable methods refuse by refunding and returning "REFUNDED: <reason>" instead of reverting,
    // because GenLayer keeps a reverted call's value in the contract.
    if (typeof outcome.returned === "string" && outcome.returned.startsWith("REFUNDED:")) {
      throw new ReliefError({
        kind: "contract_revert",
        phase: "verify",
        txHash,
        message: `The contract refused this call and is sending your GEN back: ${outcome.returned.slice(9).trim()}`,
        hint: "Nothing changed on the pool. The refund lands in your wallet once the transaction finalizes.",
        detail: String(outcome.returned),
      });
    }
    if (outcome.result === "ERROR") {
      throw new ReliefError({
        kind: "accepted_no_effect",
        phase: "verify",
        txHash,
        message: `The transaction was ACCEPTED, but the contract rejected the call, so ${WRITE_EFFECT[functionName] ?? "nothing changed"}.`,
        hint: outcome.message ? `Contract message: ${outcome.message}` : "Open the transaction in the explorer for details.",
        detail: outcome.message || rawMessage(receipt?.result) || "execution_result: ERROR",
      });
    }
    return { txHash, status, executionResult: outcome.result, receipt, returned: outcome.returned };
  }
}

export default ReliefTrigger;
