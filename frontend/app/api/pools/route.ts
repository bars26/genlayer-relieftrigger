import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

/**
 * Server-side snapshot of every pool, cached at the CDN.
 *
 * GenLayer Studio rate-limits per IP and counts contract reads (`gen_call`) in the
 * same 30-per-minute bucket as `eth_sendRawTransaction`. Reading pools from the visitor's
 * browser would spend the budget the visitor needs for their own transactions, so the
 * registry is read here, with one `get_pools` call, and served from the CDN.
 */

export const dynamic = "force-dynamic";

const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
const RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio.genlayer.com/api";

type Snapshot = { pools: unknown[]; failedIds: string[]; fetchedAt: string };
let memo: { at: number; data: Snapshot } | null = null;
const MEMO_MS = 10_000;
const PAGE = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function read<T>(client: any, functionName: string, args: unknown[]): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await client.readContract({ address: CONTRACT, functionName, args })) as T;
    } catch (err) {
      last = err;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw last;
}

function toJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v))
  );
}

async function load(): Promise<Snapshot> {
  // One gen_call per 200 pools (get_pools) instead of one per pool, so the snapshot costs a
  // single request against Studio's 30-per-minute bucket, from the server, at most every 10 s.
  const client: any = createClient({ chain: studionet, endpoint: RPC } as any);
  const pools: unknown[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await read<unknown[]>(client, "get_pools", [offset, PAGE]);
    pools.push(...page.map(toJson));
    if (page.length < PAGE) break;
  }
  return { pools, failedIds: [], fetchedAt: new Date().toISOString() };
}

export async function GET() {
  try {
    if (!memo || Date.now() - memo.at > MEMO_MS || memo.data.failedIds.length > 0) {
      const data = await load();
      if (!memo || data.pools.length >= memo.data.pools.length) memo = { at: Date.now(), data };
    }
    const partial = memo.data.failedIds.length > 0;
    return Response.json(memo.data, {
      headers: {
        "Cache-Control": partial
          ? "public, s-maxage=10, stale-while-revalidate=20"
          : // Short on purpose: a long stale-while-revalidate serves the first visitor after a quiet
            // period a snapshot from hours ago, so a pool that was triggered meanwhile looks unchanged.
            "public, s-maxage=15, stale-while-revalidate=45",
      },
    });
  } catch (err) {
    if (memo) return Response.json(memo.data, { headers: { "Cache-Control": "public, s-maxage=10" } });
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
