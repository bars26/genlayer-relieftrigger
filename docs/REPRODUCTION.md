# Reproduction log

Live run of `scripts/demo.mjs` on GenLayer Studio, 2026-10-04, against contract
[`0x6C4f01974d6059c1aA9Bfb0Bb9B353981e58f1B4`](https://explorer-studio.genlayer.com/address/0x6C4f01974d6059c1aA9Bfb0Bb9B353981e58f1B4).
The deployed code is byte-identical to `contracts/relief_trigger.py` (`node scripts/verify-code.mjs 0x6C4f01974d6059c1aA9Bfb0Bb9B353981e58f1B4` prints
`identical (24820 bytes)`). The raw run, with every hash, is in [`demo-run.json`](demo-run.json).

Accounts (throwaway, funded from the Studio faucet):

| Role | Address |
|---|---|
| donor-1 | `0x69C1E3cB2837b688eebe9436cE8341D3e0a92Fa7` |
| donor-2 | `0xeAc52A43F88866328F8A80D1D47B03B6782EE6cE` |
| recipient (the responder) | `0xb1eEAF03DD62b9890dB2393Da58e05C632779e7d` |

## Pools

| Pool | Terms | Funding |
|---|---|---|
| `pool_0` Central Myanmar earthquake response | EQ · MMR · Orange+ · M ≥ 7 · ≥ 1,000,000 exposed · 2025-01-01 → 2026-12-31 · area: *"The earthquake struck the Mandalay or Sagaing Region of central Myanmar."* · payout 4 GEN | donor-1 10, donor-2 5 (+ a 0.05 GEN donation that is refunded) |
| `pool_1` Mexico Pacific hurricane fund | TC · MEX · Red · wind ≥ 180 km/h · 2026-06-01 → 2026-10-04 · payout 2 GEN | donor-1 5, donor-2 3 |
| `pool_2` Rakhine coast earthquake response | EQ · MMR · Orange+ · M ≥ 6 · area: *"The earthquake struck Rakhine State on Myanmar's western coast."* · payout 1 GEN | donor-1 2 |

## Claims, and what validators read

| Pool | GDACS event | What validators read (GDACS, USGS) | Verdict | Reason code | Resolution |
|---|---|---|---|---|---|
| `pool_0` | [EQ 1474479](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1474479) | Red · MMR · 2025-03-28 · M6.7 · USGS M6.7 | DOES_NOT_MEET | `severity` (6.7 < 7) | recipient dismisses early |
| `pool_0` | [EQ 1477002](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1477002) | Red · MMR · 2025-04-13 · M5.5 · USGS M5.3 | DOES_NOT_MEET | `severity` (5.5 < 7) | nobody dismisses it; the next trigger **supersedes** it at once (a claim that pays nothing cannot hold the pool) |
| `pool_0` | [EQ 1474477](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1474477) | Red · MMR · 2025-03-28 · M7.7 · USGS M7.7 "2025 Mandalay, Burma (Myanmar) Earthquake" · 17,235,221 exposed | **MEETS** | `area` (LLM: Mandalay/Sagaing) | donor-1 releases early → **4 GEN to the recipient** |
| `pool_1` | [EQ 1474477](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1474477) | an earthquake, on a cyclone pool | DOES_NOT_MEET | `hazard` | recipient dismisses early |
| `pool_1` | [TC 1001325](https://www.gdacs.org/report.aspx?eventtype=TC&eventid=1001325) (POLO-26) | Red · MEX · 2026-09-21 · 287 km/h | **MEETS** | `met` | donor-2 contests → re-assessed **MEETS** → **2 GEN to the recipient** |
| `pool_2` | [EQ 1474477](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1474477) | same facts as above; every coded term passes | DOES_NOT_MEET | `area` (LLM: not Rakhine) | recipient dismisses early |

The same M7.7 earthquake pays the Mandalay pool and is refused by the Rakhine pool: the coded checks are identical, only
the validators' judgement of the area condition differs.

## Balances

| Account | Before | After | Arithmetic |
|---|---|---|---|
| donor-1 | 100.00 | 83.00 | −10 −5 −2 |
| donor-2 | 100.00 | 92.00 | −5 −3 (the 0.05 GEN donation came back) |
| recipient | 1.00 | **7.00** | +4 (Myanmar) +2 (POLO-26) |
| contract | 0 | 19.00 | pool_0 11 + pool_1 6 + pool_2 2 |

Views after the run: `was_paid(pool_0, EQ, 1474477) = true`, `was_paid(pool_0, EQ, 1474479) = false`.

## Every transaction

All ACCEPTED by validator consensus with contract execution SUCCESS.

| Who | Call | GEN | Status | Execution | Returned | Tx |
|---|---|---|---|---|---|---|
| donor-1 | `create_pool("Central Myanmar earthquake response", "0xb1eEAF03DD62b9890dB2393Da58e05C632779, "EQ", "MMR", "Orange", "7", 1000000, "The earthquake struck the Mandalay or S, 4 GEN, "2025-01-01", "2026-12-31")` | 10 | ACCEPTED | SUCCESS | pool_0 | [`0x2acc3490…4b28af`](https://explorer-studio.genlayer.com/tx/0x2acc3490ad432a293956c3216358aa0f679f347a80c4df4a16e478c6774b28af) |
| donor-2 | `donate("pool_0")` | 5 | ACCEPTED | SUCCESS | donated | [`0x8ea5edb7…3ea1d2`](https://explorer-studio.genlayer.com/tx/0x8ea5edb79b42e792707b9ebe8775fbaa7a92559473f5cb30737c3f0f8f3ea1d2) |
| donor-2 | `donate("pool_0")` | 0.05 | ACCEPTED | SUCCESS | REFUNDED: A donation must be at least 0.1 GEN | [`0xeb072c2e…25f7c9`](https://explorer-studio.genlayer.com/tx/0xeb072c2e0b9ef91b8a75b209e72f048753cd53ad73d567c003dd5b624825f7c9) |
| donor-1 | `create_pool("Mexico Pacific hurricane fund", "0xb1eEAF03DD62b9890dB2393Da58e05C632779, "TC", "MEX", "Red", "180", 0, "", 2 GEN, "2026-06-01", "2026-10-04")` | 5 | ACCEPTED | SUCCESS | pool_1 | [`0xa27bdf39…62c4e7`](https://explorer-studio.genlayer.com/tx/0xa27bdf3988dee3b4ee3602d05bb15b6234f29777afe89f04242c8e825762c4e7) |
| donor-2 | `donate("pool_1")` | 3 | ACCEPTED | SUCCESS | donated | [`0x1e74ef68…3eaacd`](https://explorer-studio.genlayer.com/tx/0x1e74ef68901dbe1fe87d233f0c55c8695e3d14f53a3bd8b65206b4f6053eaacd) |
| donor-1 | `create_pool("Rakhine coast earthquake response", "0xb1eEAF03DD62b9890dB2393Da58e05C632779, "EQ", "MMR", "Orange", "6", 0, "The earthquake struck Rakhine State on , 1 GEN, "2025-01-01", "2026-12-31")` | 2 | ACCEPTED | SUCCESS | pool_2 | [`0x0c101d57…a5e690`](https://explorer-studio.genlayer.com/tx/0x0c101d57973535f7887b8982b8929174731b77d419d61f887ed1f2fd9aa5e690) |
| recipient | `trigger("pool_0", "EQ", "1474479")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0x954539f7…c92bf9`](https://explorer-studio.genlayer.com/tx/0x954539f736cf001629ac5fabe8b0d1da09fcf36dee230e785babf0616fc92bf9) |
| recipient | `resolve("pool_0")` |  | ACCEPTED | SUCCESS | dismissed | [`0x9eb7a599…8fa1ba`](https://explorer-studio.genlayer.com/tx/0x9eb7a5998f90ab1563216c3d81c3679af273862b059fb92ee9b8edb8408fa1ba) |
| donor-2 | `trigger("pool_0", "EQ", "1477002")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0xdedc24d7…6266cd`](https://explorer-studio.genlayer.com/tx/0xdedc24d77225729929a4e29d1397153578e7695843d5dbf04bb64799e56266cd) |
| recipient | `trigger("pool_0", "EQ", "1474477")` |  | ACCEPTED | SUCCESS | MEETS | [`0x0bd593a7…c8287c`](https://explorer-studio.genlayer.com/tx/0x0bd593a76e05ed9643116798d818e620b03e924b89ad86b419bb1d4cfbc8287c) |
| donor-1 | `resolve("pool_0")` |  | ACCEPTED | SUCCESS | paid | [`0x3c7ab556…c1eb66`](https://explorer-studio.genlayer.com/tx/0x3c7ab556629a7ff7da252ae8e90a9f2b8abcbe4752f3aec4b9884a0e3fc1eb66) |
| donor-2 | `trigger("pool_1", "EQ", "1474477")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0x60bcd9e6…2c9fa7`](https://explorer-studio.genlayer.com/tx/0x60bcd9e64a6cb886d0c930889629369d288582068d9f835a95a253b00f2c9fa7) |
| recipient | `resolve("pool_1")` |  | ACCEPTED | SUCCESS | dismissed | [`0x2c9a060c…5b291b`](https://explorer-studio.genlayer.com/tx/0x2c9a060cbb70a01301b1241e3d96442cd74f52b136e20b479c65854a4c5b291b) |
| recipient | `trigger("pool_1", "TC", "1001325")` |  | ACCEPTED | SUCCESS | MEETS | [`0x0f52a5a2…e9f059`](https://explorer-studio.genlayer.com/tx/0x0f52a5a25e447fcf74aeb43e9ab0f6809e54053a365c67a9b440b3ae8ae9f059) |
| donor-2 | `contest("pool_1")` |  | ACCEPTED | SUCCESS | MEETS | [`0x86733b88…68a07f`](https://explorer-studio.genlayer.com/tx/0x86733b88addbedcd446a57409dff4a894e2c8fd5bb49ad5b22cd61196668a07f) |
| donor-2 | `resolve("pool_1")` |  | ACCEPTED | SUCCESS | paid | [`0x2fc99246…97ca33`](https://explorer-studio.genlayer.com/tx/0x2fc99246abf21f673066f31f396060443909d240b6b5ff1d838858b5ca97ca33) |
| recipient | `trigger("pool_2", "EQ", "1474477")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0xa94badf4…36848a`](https://explorer-studio.genlayer.com/tx/0xa94badf4558948b7227ccc46a80c553407a000f8bc6fd0838f53bd1d2a36848a) |
| recipient | `resolve("pool_2")` |  | ACCEPTED | SUCCESS | dismissed | [`0x4fd9f753…6db6dd`](https://explorer-studio.genlayer.com/tx/0x4fd9f7532bb188ac2ae1775dc447e7acf03787766b3bf8dde96be0b6a76db6dd) |

## A forward-looking pool

The pools above prove the mechanism on past disasters. Real use is the other way round: the money waits for a disaster
that has not happened yet. `pool_3` is a labelled DEMO of that, for the long-expected North Anatolian Fault earthquake
near Istanbul:

| Term | Value |
|---|---|
| Name | DEMO · Istanbul / Marmara earthquake response |
| Hazard, country, alert | EQ · TUR · Red |
| Magnitude, exposure | M ≥ 7 (GDACS and USGS within 0.3) · ≥ 1,000,000 people in MMI VII+ shaking |
| Area (LLM) | *"The earthquake struck the Marmara region of Türkiye, affecting Istanbul, Kocaeli, Sakarya, Yalova, Tekirdağ or Bursa province."* |
| Coverage | 2026-10-04 → 2036-10-04 |
| Payout | 5 GEN per qualifying event, to the demo responder wallet `0xb1eEAF03DD62b9890dB2393Da58e05C632779e7d` |
| Funding | donor-1 20 GEN ([`0x9e4ce431…912465`](https://explorer-studio.genlayer.com/tx/0x9e4ce431bdb8d40cc586862dde0df3f6b06f5329d9525237d3ca1911aa912465)), donor-2 10 GEN ([`0xac78846d…c34c86`](https://explorer-studio.genlayer.com/tx/0xac78846df2e5efcfe36e9042da1bde4d430195dfa3b2de5cc4f9f39f5ee34c86)) |

GDACS alert levels already weigh exposure and vulnerability, which is why a Red-alert term separates disasters that
overwhelm local capacity from strong but well-absorbed earthquakes. For scale: the 2023 Kahramanmaraş earthquake is GDACS
[EQ 1357372](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1357372), Red, M7.8 (USGS M7.8), about 3.7 million
people exposed. It would not trigger `pool_3` (it predates the coverage and struck south-east Türkiye, not Marmara); a
pool written for that region before February 2023 would have paid within the hour.

The responder wallet is a throwaway demo address. ReliefTrigger does not represent any real organisation.

## Wallet test from the app

Triggered from the live app with MetaMask (wallet `0x4F80B5c475fcEd34fc9A07FfCcF39E1Adc1406bf`), picking Hurricane
POLO-26 from the "Recent GDACS alerts" panel and triggering the Rakhine earthquake pool (`pool_2`):
[`0xe6001787…1cd1aa6`](https://explorer-studio.genlayer.com/tx/0xe600178704082dad5a86b4afc935d195add91cae1247c66a2b9a066b61cd1aa6),
FINALIZED, execution SUCCESS. Validators read TC 1001325 (Red, MEX, 287 km/h) and returned `DOES_NOT_MEET` with reason
code `hazard`: a cyclone cannot pay an earthquake pool. The claim pays nothing, so the next trigger on `pool_2`
supersedes it.

## Close and reclaim

`pool_1`'s coverage ends on 2026-10-04 (UTC), so it can be closed from 2026-10-05. Then donor-1 (5 of 8 GEN donated) and
donor-2 (3 of 8) reclaim their pro-rata shares of the 6 GEN left: 3.75 and 2.25 GEN.

```shell
node scripts/demo.mjs <contract> close pool_1 <donor-1 key> <donor-2 key>
```

The pro-rata arithmetic, closing before the end date and reclaiming twice are covered by the direct-mode tests.
