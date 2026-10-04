"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import ReliefTrigger, { type CreatePoolInput, type TxProgress, type TxResult } from "../contracts/ReliefTrigger";
import type { GdacsEvent, Pool } from "../contracts/types";
import { getContractAddress, getStudioUrl } from "../genlayer/client";
import { useWallet } from "../genlayer/wallet";
import { ReliefError, classifyError } from "../utils/errors";
import { mapWithConcurrency } from "../utils/retry";
import { error, success } from "../utils/toast";
import { startTx, updateTx, type TxKind } from "./useTxLog";

export function useReliefContract(): ReliefTrigger | null {
  const { address } = useWallet();
  const contractAddress = getContractAddress();
  const studioUrl = getStudioUrl();
  return useMemo(
    () => (contractAddress ? new ReliefTrigger(contractAddress, address, studioUrl) : null),
    [contractAddress, address, studioUrl]
  );
}

type PoolsData = { pools: Pool[]; failedIds: string[] };

async function fetchJson(url: string, timeoutMs = 25_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

/**
 * Every pool, from the CDN-cached server snapshot (app/api/pools), so page loads spend
 * none of the visitor's Studio rate-limit budget. Falls back to slow direct reads.
 */
export function useAllPools() {
  const contract = useReliefContract();
  const query = useQuery<PoolsData, Error>({
    queryKey: ["pools"],
    queryFn: async () => {
      try {
        const body = await fetchJson("/api/pools");
        if (!Array.isArray(body.pools)) throw new Error("Malformed snapshot");
        return { pools: body.pools as Pool[], failedIds: (body.failedIds ?? []) as string[] };
      } catch (snapshotErr) {
        if (!contract) throw classifyError(snapshotErr, "read");
        const ids = await contract.listPools();
        const rows = await mapWithConcurrency(ids, 2, async (id) => {
          try {
            return { id, pool: await contract.getPool(id) };
          } catch {
            return { id, pool: null as Pool | null };
          }
        });
        return {
          pools: rows.filter((r) => r.pool).map((r) => r.pool as Pool),
          failedIds: rows.filter((r) => !r.pool).map((r) => r.id),
        };
      }
    },
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  return {
    pools: query.data?.pools ?? [],
    failedIds: query.data?.failedIds ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Recent Orange and Red GDACS alerts, from the app's cached /api/events route. */
export function useRecentEvents() {
  return useQuery<GdacsEvent[], Error>({
    queryKey: ["gdacsEvents"],
    queryFn: async () => {
      const body = await fetchJson("/api/events");
      return Array.isArray(body.events) ? (body.events as GdacsEvent[]) : [];
    },
    staleTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/** Re-read one pool from the chain after a write and merge it into the cached list. */
async function mergeFreshPool(qc: ReturnType<typeof useQueryClient>, contract: ReliefTrigger, id: string) {
  try {
    const pool = await contract.getPool(id);
    qc.setQueryData<PoolsData>(["pools"], (prev) => {
      const pools = prev?.pools ?? [];
      const i = pools.findIndex((p) => p.id === id);
      return {
        pools: i >= 0 ? pools.map((p) => (p.id === id ? pool : p)) : [...pools, pool],
        failedIds: (prev?.failedIds ?? []).filter((x) => x !== id),
      };
    });
  } catch {
    // Already confirmed on chain; the next snapshot refresh picks it up.
  }
}

export type WriteVars =
  | { kind: "create"; input: CreatePoolInput; value: bigint }
  | { kind: "donate"; id: string; value: bigint }
  | { kind: "trigger"; id: string; type: string; eventId: string }
  | { kind: "contest"; id: string }
  | { kind: "resolve"; id: string }
  | { kind: "close"; id: string }
  | { kind: "reclaim"; id: string };

export const WRITE_LABEL: Record<WriteVars["kind"], string> = {
  create: "Create pool",
  donate: "Donate",
  trigger: "Trigger",
  contest: "Contest",
  resolve: "Resolve",
  close: "Close",
  reclaim: "Reclaim",
};

const VERDICT_TEXT: Record<string, string> = {
  MEETS: "Validators found the event meets the terms.",
  DOES_NOT_MEET: "Validators found the event does not meet the terms.",
  UNCLEAR: "Validators could not decide (a source was unreachable or the area was unclear).",
};

/** One mutation for every ReliefTrigger write, with a transaction log entry and typed errors. */
export function usePoolWrite() {
  const contract = useReliefContract();
  const { address } = useWallet();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (vars: WriteVars) => {
      const target =
        vars.kind === "create" ? vars.input.name : vars.kind === "trigger" ? `${vars.id} ${vars.type}:${vars.eventId}` : vars.id;
      const logId = startTx(vars.kind as TxKind, target);
      setPending(vars.kind === "create" ? "create" : `${vars.kind}:${vars.id}`);
      const onProgress = (p: TxProgress) =>
        updateTx(logId, {
          state: p.step === "awaiting_wallet" ? "awaiting_wallet" : p.step === "accepted" ? "accepted" : "confirming",
          txHash: p.txHash,
          progress: p.message,
        });
      try {
        if (!contract) throw new ReliefError({ kind: "unknown", phase: "send", message: "The contract address is not configured." });
        if (!address) throw new ReliefError({ kind: "wallet_missing", phase: "send", message: "No wallet is connected." });

        let result: TxResult;
        let id = vars.kind === "create" ? "" : vars.id;
        let note = "Done.";
        // Re-read right before sending so a stale list never sends a call the contract would refuse.
        const fresh = vars.kind === "create" ? null : await contract.getPool(vars.id);
        const refuse = (message: string): never => {
          throw new ReliefError({ kind: "contract_revert", phase: "estimate", message, hint: "The pool was refreshed; nothing was sent." });
        };
        switch (vars.kind) {
          case "create":
            result = await contract.createPool(vars.input, vars.value, onProgress);
            id = typeof result.returned === "string" ? result.returned : "";
            note = id ? `Pool ${id} created.` : "Pool created.";
            break;
          case "donate":
            if (fresh!.state === "closed") refuse("This pool is closed.");
            result = await contract.donate(vars.id, vars.value, onProgress);
            break;
          case "trigger":
            if (fresh!.state !== "open") refuse(`This pool is ${fresh!.state}; it cannot be triggered right now.`);
            result = await contract.trigger(vars.id, vars.type, vars.eventId, onProgress);
            note = VERDICT_TEXT[String(result.returned)] ?? "Claim recorded.";
            break;
          case "contest":
            if (fresh!.state !== "pending" || fresh!.claim_contested) refuse("This claim can no longer be contested.");
            result = await contract.contest(vars.id, onProgress);
            note = `Re-assessed: ${String(result.returned)}.`;
            break;
          case "resolve":
            if (fresh!.state !== "pending") refuse("There is no pending claim to resolve.");
            result = await contract.resolve(vars.id, onProgress);
            note = result.returned === "paid" ? "Payout sent to the recipient." : "Claim dismissed; the pool stays funded.";
            break;
          case "close":
            if (fresh!.state !== "open") refuse(`This pool is ${fresh!.state}; it cannot be closed now.`);
            result = await contract.close(vars.id, onProgress);
            break;
          case "reclaim":
            if (fresh!.state !== "closed") refuse("The pool must be closed before donors can reclaim.");
            result = await contract.reclaim(vars.id, onProgress);
            note = `Reclaimed ${(Number(String(result.returned ?? "0")) / 1e18).toFixed(4)} GEN.`;
            break;
        }
        updateTx(logId, {
          state: "accepted",
          txHash: result.txHash,
          status: result.status,
          executionResult: result.executionResult,
          siteId: id,
          progress: note,
        });
        return { id, txHash: result.txHash, kind: vars.kind, note };
      } catch (err) {
        const e = classifyError(err, "send");
        if (contract && vars.kind !== "create") mergeFreshPool(qc, contract, vars.id);
        updateTx(logId, {
          state: "failed",
          txHash: e.txHash,
          error: { kind: e.kind, message: e.message, hint: e.hint, detail: e.detail, phase: e.phase },
        });
        error(`${WRITE_LABEL[vars.kind]} failed`, {
          description: [e.message, e.hint].filter(Boolean).join(" "),
          duration: 12000,
        });
        throw err;
      } finally {
        setPending(null);
      }
    },
    onSuccess: ({ id, txHash, kind, note }) => {
      if (contract && id) mergeFreshPool(qc, contract, id);
      qc.invalidateQueries({ queryKey: ["genBalance"] });
      success(kind === "create" ? `Pool ${id} created` : `${WRITE_LABEL[kind]} confirmed`, {
        description: `${note} Tx ${txHash.slice(0, 10)}... is ACCEPTED by validator consensus.`,
        duration: 8000,
      });
    },
  });

  return { write: mutation.mutate, writeAsync: mutation.mutateAsync, pending, isPending: mutation.isPending };
}
