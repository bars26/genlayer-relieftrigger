// Live end-to-end demo of ReliefTrigger on GenLayer Studio, using real GDACS events.
//
//   node scripts/demo.mjs <contract-address>            # create pools, trigger, contest, pay
//   node scripts/demo.mjs <contract-address> close <pool_id> <donor1-key> <donor2-key>
//                                                       # after coverage ends: close + reclaim
//
// Creates throwaway Studio accounts (two donors and a relief recipient), funds them from the
// Studio faucet, then runs real GDACS events through three pools. Prints each transaction hash,
// consensus status and the contract's own execution result (a reverted call is still ACCEPTED).

import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { writeFileSync } from "fs";

const [CONTRACT, MODE, ...REST] = process.argv.slice(2);
if (!CONTRACT) {
  console.error("usage: node scripts/demo.mjs <contract-address> [close <pool_id> <donor1-key> <donor2-key>]");
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

if (MODE === "close") {
  const [poolId, k1, k2] = REST;
  const d1 = createAccount(k1);
  const d2 = createAccount(k2);
  const D1 = client(d1);
  const D2 = client(d2);
  const before = { d1: await balance(d1.address), d2: await balance(d2.address) };
  await write(D1, "donor-1", "close", [poolId]);
  await write(D1, "donor-1", "reclaim", [poolId]);
  await write(D2, "donor-2", "reclaim", [poolId]);
  const p = await read(D1, "get_pool", [poolId]);
  console.log(`\n${poolId}: state=${field(p, "state")} closing_balance=${fmt(field(p, "closing_balance"))} balance=${fmt(field(p, "balance"))}`);
  await sleep(5000);
  const after = { d1: await balance(d1.address), d2: await balance(d2.address) };
  console.log(`donor-1 ${fmt(before.d1)} -> ${fmt(after.d1)} GEN, donor-2 ${fmt(before.d2)} -> ${fmt(after.d2)} GEN`);
  console.log("\nJSON:", JSON.stringify({ contract: CONTRACT, poolId, log }));
  process.exit(0);
}

const donor1Key = generatePrivateKey();
const donor2Key = generatePrivateKey();
const donor1 = createAccount(donor1Key);
const donor2 = createAccount(donor2Key);
const recipientKey = generatePrivateKey();
const recipient = createAccount(recipientKey);
const D1 = client(donor1);
const D2 = client(donor2);
const R = client(recipient);

// Keep the throwaway keys outside the repo so the close/reclaim step can run after coverage ends.
if (process.env.DEMO_KEYS) {
  writeFileSync(process.env.DEMO_KEYS, JSON.stringify({ donor1: donor1Key, donor2: donor2Key, recipient: recipientKey }));
}
console.log("contract ", CONTRACT);
console.log("donor-1  ", donor1.address);
console.log("donor-2  ", donor2.address);
console.log("recipient", recipient.address);
await fund(donor1.address, 100n);
await fund(donor2.address, 100n);
await fund(recipient.address, 1n);
await sleep(3000);
const start = { d1: await balance(donor1.address), d2: await balance(donor2.address), r: await balance(recipient.address) };
console.log(`funded: donor-1 ${fmt(start.d1)}, donor-2 ${fmt(start.d2)}, recipient ${fmt(start.r)} GEN\n`);

const first = Number((await read(D1, "list_pools")).length);
const ids = { myanmar: `pool_${first}`, mexico: `pool_${first + 1}`, rakhine: `pool_${first + 2}`, istanbul: `pool_${first + 3}`, wildfire: `pool_${first + 4}` };
const today = new Date().toISOString().slice(0, 10);

// Pool A: central Myanmar earthquakes, M7+, 1M+ people exposed, area judged by the validators' LLMs.
await write(D1, "donor-1", "create_pool", [
  "Central Myanmar earthquake response", recipient.address, "EQ", "MMR", "Orange", "7", 1000000,
  "The earthquake struck the Mandalay or Sagaing Region of central Myanmar.", 4n * GEN, "2025-01-01", "2026-12-31",
], 10n * GEN);
await write(D2, "donor-2", "donate", [ids.myanmar], 5n * GEN);
await write(D2, "donor-2", "donate", [ids.myanmar], GEN / 20n); // below 0.1 GEN: refunded, not kept

// Pool B: Pacific hurricanes hitting Mexico, Red alert, 180+ km/h, coverage ends today.
await write(D1, "donor-1", "create_pool", [
  "Mexico Pacific hurricane fund", recipient.address, "TC", "MEX", "Red", "180", 0, "", 2n * GEN, "2026-06-01", today,
], 5n * GEN);
await write(D2, "donor-2", "donate", [ids.mexico], 3n * GEN);

// Pool C: the same Myanmar data, but terms written for a different region.
await write(D1, "donor-1", "create_pool", [
  "Rakhine coast earthquake response", recipient.address, "EQ", "MMR", "Orange", "6", 0,
  "The earthquake struck Rakhine State on Myanmar's western coast.", 1n * GEN, "2025-01-01", "2026-12-31",
], 2n * GEN);

console.log("");
const claim = async (who, c, label, poolId, type, id) => {
  await write(c, who, "trigger", [poolId, type, id]);
  const p = await read(D1, "get_pool", [poolId]);
  const facts = JSON.parse(field(p, "claim_facts_json"));
  console.log(`  -> ${label}: ${field(p, "claim_verdict")} (${field(p, "claim_code")}) gdacs ${facts.alert ?? "?"} ${facts.severity ?? "?"} ${(facts.countries || []).join(",")} ${facts.from_date ?? ""}${facts.usgs_mag != null ? ` usgs M${facts.usgs_mag}` : ""}`);
  return field(p, "claim_verdict");
};

// A: an M6.7 aftershock is below the M7 trigger, so the recipient dismisses it.
await claim("recipient", R, "A  EQ 1474479 (M6.7 aftershock)", ids.myanmar, "EQ", "1474479");
await write(R, "recipient", "resolve", [ids.myanmar]);
// A: an M5.5 quake two weeks later is also below the trigger. Nobody dismisses it: a claim that
// pays nothing cannot hold the pool, so the next trigger supersedes it immediately.
await claim("donor-2", D2, "A  EQ 1477002 (M5.5)", ids.myanmar, "EQ", "1477002");
// A: the M7.7 Mandalay earthquake qualifies. Releasing it before the contest window ends
// needs donors holding more than half of the donations made before the claim.
const a = await claim("recipient", R, "A  EQ 1474477 (M7.7 Mandalay)", ids.myanmar, "EQ", "1474477");
if (a === "MEETS") {
  await write(R, "recipient", "approve_release", [ids.myanmar], 0n, { expectError: true }); // no say in its own payout
  await write(R, "recipient", "contest", [ids.myanmar], 0n, { expectError: true }); // nor a contest of it
  await write(D2, "donor-2", "donate", [ids.myanmar], 20n * GEN); // a large donation after the claim...
  await write(D2, "donor-2", "approve_release", [ids.myanmar]); // ...still counts only the 5 GEN given before: 5 of 15
  await write(R, "recipient", "resolve", [ids.myanmar], 0n, { expectError: true }); // a minority cannot release it
  await write(D1, "donor-1", "approve_release", [ids.myanmar]); // 15 of 15: released at once
}

// B: an earthquake does not match a hurricane pool; then Hurricane POLO-26 does. A donor contests,
// which restarts the window; the re-assessment agrees and a donor majority releases it.
console.log("");
await claim("donor-2", D2, "B  EQ 1474477 on a TC pool", ids.mexico, "EQ", "1474477");
await write(R, "recipient", "resolve", [ids.mexico]);
const b = await claim("recipient", R, "B  TC 1001325 (POLO-26)", ids.mexico, "TC", "1001325");
await write(D2, "donor-2", "contest", [ids.mexico]);
const bp = await read(D1, "get_pool", [ids.mexico]);
console.log(`  -> contest: ${b} -> ${field(bp, "claim_verdict")}`);
await write(D2, "donor-2", "contest", [ids.mexico], 0n, { expectError: true }); // donors contest once
if (field(bp, "claim_verdict") === "MEETS") await write(D1, "donor-1", "approve_release", [ids.mexico]); // 5 of 8

// C: the facts pass every coded check but the area condition does not hold.
console.log("");
const c = await claim("recipient", R, "C  EQ 1474477 vs Rakhine terms", ids.rakhine, "EQ", "1474477");
if (c !== "MEETS") {
  await write(D1, "donor-1", "contest", [ids.rakhine], 0n, { expectError: true }); // only the recipient contests a refusal
  await write(R, "recipient", "resolve", [ids.rakhine]); // the recipient may dismiss early
}

// D: a forward-looking DEMO pool for a Marmara/Istanbul earthquake (real use: money waits for a future disaster).
console.log("");
await write(D1, "donor-1", "create_pool", [
  "DEMO · Istanbul / Marmara earthquake response", recipient.address, "EQ", "TUR", "Red", "7", 1000000,
  "The earthquake struck the Marmara region of Türkiye, affecting Istanbul, Kocaeli, Sakarya, Yalova, Tekirdağ or Bursa province.",
  5n * GEN, today, "2036-10-04",
], 20n * GEN);
await write(D2, "donor-2", "donate", [ids.istanbul], 10n * GEN);

// E: a DEMO wildfire-recovery pool, tested on the July 2026 forest fires in France (47,910 ha).
await write(D1, "donor-1", "create_pool", [
  "DEMO · European wildfire recovery: reforestation and wildlife care", recipient.address, "WF", "ESP,FRA,GRC,ITA,PRT,TUR", "Red", "", 0, "",
  3n * GEN, "2026-06-01", "2027-12-31",
], 15n * GEN);
await write(D2, "donor-2", "donate", [ids.wildfire], 5n * GEN);
const e = await claim("donor-2", D2, "E  WF 1029628 (France, July 2026)", ids.wildfire, "WF", "1029628");
if (e === "MEETS") await write(D1, "donor-1", "approve_release", [ids.wildfire]); // 15 of 20

await sleep(5000);
const end = { d1: await balance(donor1.address), d2: await balance(donor2.address), r: await balance(recipient.address) };
console.log("\nfinal pools:");
for (const [k, id] of Object.entries(ids)) {
  const p = await read(D1, "get_pool", [id]);
  console.log(`  ${id} ${k.padEnd(8)} state=${field(p, "state").padEnd(7)} balance=${fmt(field(p, "balance")).padStart(6)} paid=${fmt(field(p, "total_paid"))} events=${field(p, "paid_events_json")}`);
}
console.log(`  was_paid(${ids.myanmar}, EQ, 1474477) = ${await read(D1, "was_paid", [ids.myanmar, "EQ", "1474477"])}`);
console.log(`  was_paid(${ids.myanmar}, EQ, 1474479) = ${await read(D1, "was_paid", [ids.myanmar, "EQ", "1474479"])}`);
console.log(`\nbalances: donor-1 ${fmt(start.d1)} -> ${fmt(end.d1)}, donor-2 ${fmt(start.d2)} -> ${fmt(end.d2)}, recipient ${fmt(start.r)} -> ${fmt(end.r)} GEN`);
console.log("(transfers are emitted on finalization, so balances catch up once the appeal window closes)");
console.log(`\nto close ${ids.mexico} after ${today}: node scripts/demo.mjs ${CONTRACT} close ${ids.mexico} <donor-1 key> <donor-2 key>`);
const out = { contract: CONTRACT, donor1: donor1.address, donor2: donor2.address, recipient: recipient.address, ids, log };
console.log("\nJSON:", JSON.stringify(out));
