// Live end-to-end demo of ReliefTrigger v3 on GenLayer Studio, using real GDACS events:
// burned-hectare thresholds for wildfires, payouts split between several purpose wallets and
// a plain-English reason stored with every ruling.
//
//   node scripts/demo.mjs <contract-address>
//
// Creates throwaway Studio accounts (two donors, three wildfire-recovery wallets and two
// earthquake-response wallets), funds them from the Studio faucet, then runs real GDACS events
// through three pools. Prints each transaction hash, consensus status, the contract's own
// execution result (a reverted call is still ACCEPTED) and the reason stored with each ruling.

import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { writeFileSync } from "fs";

const [CONTRACT] = process.argv.slice(2);
if (!CONTRACT) {
  console.error("usage: node scripts/demo.mjs <contract-address>");
  process.exit(1);
}
const RPC = "https://studio.genlayer.com/api";
const GEN = 10n ** 18n;

function client(account) {
  return createClient({ chain: studionet, endpoint: RPC, account });
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];

const TRANSIENT = /rate limit|Unexpected token '<'|not valid JSON|fetch failed|ECONNRESET|socket hang up|50[234]/i;

async function write(c, who, functionName, args, value = 0n, { expectError = false } = {}) {
  const from = c.account.address;
  for (let attempt = 1; ; attempt++) {
    const nonceBefore = BigInt(await rpc("eth_getTransactionCount", [from, "latest"]));
    try {
      let hash;
      try {
        hash = await c.writeContract({ address: CONTRACT, functionName, args, value });
      } catch (err) {
        // The RPC sometimes answers a send with an HTML error page. Only resend if the
        // nonce did not move; otherwise the first send went through and we pick it up.
        if (!TRANSIENT.test(String(err?.message || err))) throw err;
        await sleep(15000);
        const nonceAfter = BigInt(await rpc("eth_getTransactionCount", [from, "latest"]));
        if (nonceAfter === nonceBefore) throw err;
        const txs = await rpc("sim_getTransactionsForAddress", [from]);
        hash = txs.filter((t) => (t.from_address || "").toLowerCase() === from.toLowerCase()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0].hash;
        console.log(`  send answered with an error page but the tx exists: ${hash}`);
      }
      // Once a hash exists, only the wait is retried; the transaction is never sent twice.
      let receipt;
      for (let wait = 1; ; wait++) {
        try {
          receipt = await c.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 60, interval: 5000 });
          break;
        } catch (err) {
          if (!TRANSIENT.test(String(err?.message || err)) || wait >= 6) throw Object.assign(err, { sent: true });
          await sleep(10000 * wait);
        }
      }
      const lr = receipt?.consensus_data?.leader_receipt;
      const first = Array.isArray(lr) ? lr[0] : lr;
      const exec = first?.execution_result ?? "?";
      let returned = first?.result?.payload?.readable;
      try { returned = JSON.parse(returned); } catch {}
      const row = { who, call: `${functionName}(${args.map((a) => (typeof a === "bigint" ? `${Number(a) / 1e18} GEN` : JSON.stringify(a)).slice(0, 40)).join(", ")})`, value: (Number(value) / 1e18).toString(), hash, status: receipt.statusName ?? receipt.status_name ?? "ACCEPTED", exec, returned: typeof returned === "string" ? returned : undefined };
      log.push(row);
      console.log(`${row.who.padEnd(10)} ${row.call.padEnd(52)} ${row.status.padEnd(9)} ${row.exec.padEnd(7)} ${hash}${row.returned?.startsWith?.("REFUNDED") ? "  -> " + row.returned : ""}`);
      if (expectError) {
        if (exec !== "ERROR") throw new Error(`${functionName} was expected to be refused but executed with ${exec}`);
        const msg = typeof first?.result?.payload === "string" ? first.result.payload : "";
        row.refused = msg;
        console.log(`  -> refused as designed: ${msg}`);
        return receipt;
      }
      if (exec !== "SUCCESS") throw new Error(`${functionName} executed with ${exec}`);
      return receipt;
    } catch (err) {
      const msg = String(err?.message || err);
      if (TRANSIENT.test(msg) && attempt < 5 && !err?.sent) {
        console.log(`  transient RPC error (${msg.slice(0, 60)}), waiting ${15 * attempt}s`);
        await sleep(15000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

async function read(c, functionName, args = []) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await c.readContract({ address: CONTRACT, functionName, args });
    } catch (err) {
      if ((/rate limit/i.test(String(err?.message)) || TRANSIENT.test(String(err?.message))) && attempt < 6) {
        await sleep(15000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

const balance = async (addr) => BigInt(await rpc("eth_getBalance", [addr, "latest"]));
const fmt = (wei) => (Number(wei) / 1e18).toFixed(2);

const fund = async (addr, gen) => rpc("sim_fundAccount", [addr, Number(gen * GEN)]);
const field = (pool, name) => (pool instanceof Map ? pool.get(name) : pool[name]);

// ---- v3 run: per-hazard thresholds, split payouts, explained rulings ----
const keys = Object.fromEntries(["donor1", "donor2", "reforest", "wildlife", "families", "responder", "shelter"].map((k) => [k, generatePrivateKey()]));
const acct = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, createAccount(v)]));
const C = Object.fromEntries(Object.entries(acct).map(([k, a]) => [k, client(a)]));
if (process.env.DEMO_KEYS) writeFileSync(process.env.DEMO_KEYS, JSON.stringify(keys));

console.log("contract ", CONTRACT);
for (const [k, a] of Object.entries(acct)) console.log(k.padEnd(10), a.address);
await fund(acct.donor1.address, 100n);
await fund(acct.donor2.address, 100n);
for (const k of ["reforest", "wildlife", "families", "responder", "shelter"]) await fund(acct[k].address, 1n);
await sleep(3000);
const start = Object.fromEntries(await Promise.all(Object.entries(acct).map(async ([k, a]) => [k, await balance(a.address)])));
console.log(`funded: ${Object.entries(start).map(([k, v]) => `${k} ${fmt(v)}`).join(", ")} GEN\n`);

const first = Number((await read(C.donor1, "list_pools")).length);
const ids = { wildfire: `pool_${first}`, quake: `pool_${first + 1}`, megafire: `pool_${first + 2}` };
const MED = "ESP,FRA,GRC,ITA,PRT,TUR";
const SPLIT = JSON.stringify([
  { address: acct.reforest.address, percent: 50, label: "Reforestation" },
  { address: acct.wildlife.address, percent: 30, label: "Wildlife care" },
  { address: acct.families.address, percent: 20, label: "Displaced families" },
]);
const QUAKE_SPLIT = JSON.stringify([
  { address: acct.responder.address, percent: 70, label: "Search and rescue" },
  { address: acct.shelter.address, percent: 30, label: "Emergency shelter" },
]);
const rulings = [];
const claim = async (who, c, label, poolId, type, id) => {
  await write(c, who, "trigger", [poolId, type, id]);
  const p = await read(C.donor1, "get_pool", [poolId]);
  const row = { pool: poolId, event: `${type}:${id}`, label, verdict: field(p, "claim_verdict"), code: field(p, "claim_code"), why: field(p, "claim_why") };
  rulings.push(row);
  console.log(`  -> ${label}: ${row.verdict} (${row.code}) ${row.why}`);
  return row.verdict;
};

// Invalid terms are refused and refunded: percents that do not add up, and a threshold for a hazard the pool does not cover.
await write(C.donor1, "donor-1", "create_pool", ["Bad split", JSON.stringify([{ address: acct.reforest.address, percent: 60 }, { address: acct.wildlife.address, percent: 30 }]), "WF", MED, "Orange", "WF:10000", 0, "", GEN, "2026-06-01", "2027-12-31"], 2n * GEN);
await write(C.donor1, "donor-1", "create_pool", ["Bad threshold", SPLIT, "EQ", "TUR", "Red", "WF:10000", 0, "", GEN, "2026-06-01", "2027-12-31"], 2n * GEN);

// A: Mediterranean wildfire recovery. Orange or Red, at least 10,000 burned hectares, split 50/30/20.
console.log("");
await write(C.donor1, "donor-1", "create_pool", ["Mediterranean wildfire recovery", SPLIT, "WF", MED, "Orange", "WF:10000", 0, "", 6n * GEN, "2026-06-01", "2027-12-31"], 20n * GEN);
await write(C.donor2, "donor-2", "donate", [ids.wildfire], 10n * GEN);
await claim("wildlife", C.wildlife, "A  WF 1029958 Greece, 1,568 ha", ids.wildfire, "WF", "1029958");
await write(C.wildlife, "wildlife", "resolve", [ids.wildfire]); // any recipient may dismiss a refusal early
await claim("families", C.families, "A  WF 1029489 France, 2,280 ha", ids.wildfire, "WF", "1029489");
await write(C.families, "families", "contest", [ids.wildfire]); // the recipients' side asks once for a fresh look
await write(C.reforest, "reforest", "contest", [ids.wildfire], 0n, { expectError: true }); // ...once for the whole side
await write(C.reforest, "reforest", "resolve", [ids.wildfire]);
await claim("donor-2", C.donor2, "A  WF 1030534 Belgium", ids.wildfire, "WF", "1030534"); // not covered; superseded below
const a = await claim("reforest", C.reforest, "A  WF 1030410 Spain, 19,294 ha", ids.wildfire, "WF", "1030410");
if (a === "MEETS") {
  await write(C.reforest, "reforest", "approve_release", [ids.wildfire], 0n, { expectError: true }); // recipients have no say
  await write(C.donor2, "donor-2", "approve_release", [ids.wildfire]); // 10 of 30: not enough
  await write(C.reforest, "reforest", "resolve", [ids.wildfire], 0n, { expectError: true });
  await write(C.donor1, "donor-1", "approve_release", [ids.wildfire]); // 30 of 30: paid 3.0 / 1.8 / 1.2
}

// B: Myanmar earthquake response, M7+ with 1M+ exposed, Mandalay/Sagaing area, split 70/30.
console.log("");
await write(C.donor1, "donor-1", "create_pool", ["Central Myanmar earthquake response", QUAKE_SPLIT, "EQ", "MMR", "Orange", "EQ:7", 1000000,
  "The earthquake struck the Mandalay or Sagaing Region of central Myanmar.", 4n * GEN, "2025-01-01", "2026-12-31"], 8n * GEN);
const b = await claim("responder", C.responder, "B  EQ 1474477 Mandalay M7.7", ids.quake, "EQ", "1474477");
if (b === "MEETS") await write(C.donor1, "donor-1", "approve_release", [ids.quake]); // sole donor: paid 2.8 / 1.2

// C: the same Spanish fires against a pool for mega-fires only (100,000 ha).
console.log("");
await write(C.donor2, "donor-2", "create_pool", ["Mega-fire reserve", SPLIT, "WF", MED, "Orange", "WF:100000", 0, "", 5n * GEN, "2026-06-01", "2027-12-31"], 10n * GEN);
await claim("reforest", C.reforest, "C  WF 1029643 Spain, 66,098 ha vs 100,000", ids.megafire, "WF", "1029643");
await write(C.reforest, "reforest", "resolve", [ids.megafire]);

await sleep(5000);
console.log("\nfinal pools:");
for (const [k, id] of Object.entries(ids)) {
  const p = await read(C.donor1, "get_pool", [id]);
  console.log(`  ${id} ${k.padEnd(8)} state=${field(p, "state").padEnd(7)} balance=${fmt(field(p, "balance")).padStart(6)} paid=${fmt(field(p, "total_paid"))} events=${field(p, "paid_events_json")} thresholds=${field(p, "thresholds_json")}`);
}
const end = Object.fromEntries(await Promise.all(Object.entries(acct).map(async ([k, a]) => [k, await balance(a.address)])));
console.log(`\nbalances: ${Object.keys(acct).map((k) => `${k} ${fmt(start[k])} -> ${fmt(end[k])}`).join(", ")} GEN`);
console.log("(transfers are emitted on finalization, so balances catch up once the appeal window closes)");
const out = { contract: CONTRACT, accounts: Object.fromEntries(Object.entries(acct).map(([k, a]) => [k, a.address])), ids, rulings, log };
writeFileSync(new URL("../docs/demo-run.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("\nwrote docs/demo-run.json");
