# Reproduction log

Live run of `scripts/demo.mjs` on GenLayer Studio, 2026-10-04, against contract
[`0x94015e773191C26E8504e1af30463d1BFBE2311B`](https://explorer-studio.genlayer.com/address/0x94015e773191C26E8504e1af30463d1BFBE2311B).
The deployed code is byte-identical to `contracts/relief_trigger.py` (`node scripts/verify-code.mjs 0x94015e773191C26E8504e1af30463d1BFBE2311B` prints
`identical (23998 bytes)`). The raw run, with every hash, is in [`demo-run.json`](demo-run.json).

Accounts (throwaway, funded from the Studio faucet):

| Role | Address |
|---|---|
| donor-1 | `0x049D0ebeE12127ac0342F2D8f469DD64E0213D6B` |
| donor-2 | `0xac1970b0e4Bb2aFb5f1E1d7422D16532E1424ee8` |
| recipient (the responder) | `0x9286D4eb4Ce3469cE9D5a1Ff8B1DAd9D2e82074E` |

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
| `pool_0` | [EQ 1477002](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1477002) | Red · MMR · 2025-04-13 · M5.5 · USGS M5.3 | DOES_NOT_MEET | `severity` (5.5 < 7) | recipient dismisses early |
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
| donor-1 | `create_pool("Central Myanmar earthquake response", "0x9286D4eb4Ce3469cE9D5a1Ff8B1DAd9D2e820, "EQ", "MMR", "Orange", "7", 1000000, "The earthquake struck the Mandalay or S, 4 GEN, "2025-01-01", "2026-12-31")` | 10 | ACCEPTED | SUCCESS | pool_0 | [`0x3b6fabad…332905`](https://explorer-studio.genlayer.com/tx/0x3b6fabada56a148ffdaa61bcf0fea1b41ebbb972a995055eb74c5863bb332905) |
| donor-2 | `donate("pool_0")` | 5 | ACCEPTED | SUCCESS | donated | [`0x8701e8ef…7fbca4`](https://explorer-studio.genlayer.com/tx/0x8701e8efe10e55c5813381b805c5069a0c9e6fa7c1e0494355cc3552f27fbca4) |
| donor-2 | `donate("pool_0")` | 0.05 | ACCEPTED | SUCCESS | REFUNDED: A donation must be at least 0.1 GEN | [`0x5d9ce42a…4c1113`](https://explorer-studio.genlayer.com/tx/0x5d9ce42ab51068f323c189a0ad2ecdc298c2ada0f806c89c157a88d9e14c1113) |
| donor-1 | `create_pool("Mexico Pacific hurricane fund", "0x9286D4eb4Ce3469cE9D5a1Ff8B1DAd9D2e820, "TC", "MEX", "Red", "180", 0, "", 2 GEN, "2026-06-01", "2026-10-04")` | 5 | ACCEPTED | SUCCESS | pool_1 | [`0x3386c492…f09da5`](https://explorer-studio.genlayer.com/tx/0x3386c492cf3277c1a1bb11b30a497fafb36a18ad6cb69a1aca8e3e70b1f09da5) |
| donor-2 | `donate("pool_1")` | 3 | ACCEPTED | SUCCESS | donated | [`0xeb1ff9e0…e9eb5d`](https://explorer-studio.genlayer.com/tx/0xeb1ff9e07fdd6f742df6c7c9bc28607343249c66c18cbc9b1e273bce92e9eb5d) |
| donor-1 | `create_pool("Rakhine coast earthquake response", "0x9286D4eb4Ce3469cE9D5a1Ff8B1DAd9D2e820, "EQ", "MMR", "Orange", "6", 0, "The earthquake struck Rakhine State on , 1 GEN, "2025-01-01", "2026-12-31")` | 2 | ACCEPTED | SUCCESS | pool_2 | [`0xa9ba9a68…5bb165`](https://explorer-studio.genlayer.com/tx/0xa9ba9a683787da520799f81cddb758216e51ed00b13857b6166408e0295bb165) |
| recipient | `trigger("pool_0", "EQ", "1474479")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0xd34dd074…167753`](https://explorer-studio.genlayer.com/tx/0xd34dd0748442377cb50bb1f93c6d43684164c94424dc07f36c6dd4af17167753) |
| recipient | `resolve("pool_0")` |  | ACCEPTED | SUCCESS | dismissed | [`0x38cdcbc2…e8875c`](https://explorer-studio.genlayer.com/tx/0x38cdcbc25ddef1f1bb4068bc82bcb0f9180ce45ee9f8ef3f24f3644ee7e8875c) |
| donor-2 | `trigger("pool_0", "EQ", "1477002")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0x73aef46c…90c571`](https://explorer-studio.genlayer.com/tx/0x73aef46c4f6d36d0f5e79d69ee7a9c385fcd71c7980d69677e14489a7f90c571) |
| recipient | `resolve("pool_0")` |  | ACCEPTED | SUCCESS | dismissed | [`0xb139136d…8b84c7`](https://explorer-studio.genlayer.com/tx/0xb139136d9c9daabda18ca6662d6312953178254e5e38991989e2cf3c308b84c7) |
| recipient | `trigger("pool_0", "EQ", "1474477")` |  | ACCEPTED | SUCCESS | MEETS | [`0x3e0b1466…761d1d`](https://explorer-studio.genlayer.com/tx/0x3e0b146679668eb7d4abdfa2c194b146c4ce1ebf19c5739e97f9e95c0c761d1d) |
| donor-1 | `resolve("pool_0")` |  | ACCEPTED | SUCCESS | paid | [`0x46309e77…5ecca9`](https://explorer-studio.genlayer.com/tx/0x46309e776e9836603a242155fac57eeb3fbd80fd3408cb73c23639504a5ecca9) |
| donor-2 | `trigger("pool_1", "EQ", "1474477")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0xf04eaf48…300dcb`](https://explorer-studio.genlayer.com/tx/0xf04eaf487d1b2a69798a5abdb0d4ebd3018b72c67f4fdf0ee4010f4e3e300dcb) |
| recipient | `resolve("pool_1")` |  | ACCEPTED | SUCCESS | dismissed | [`0xb140f3cf…133f7a`](https://explorer-studio.genlayer.com/tx/0xb140f3cf67b023d3e47297fa3b82cb86a53ec6cf8ef9ca7998e7d68d03133f7a) |
| recipient | `trigger("pool_1", "TC", "1001325")` |  | ACCEPTED | SUCCESS | MEETS | [`0x9d2dee4d…22d6ed`](https://explorer-studio.genlayer.com/tx/0x9d2dee4d4772e64bc6e381ff8676dc382b0a8b9e09e80481440481eff222d6ed) |
| donor-2 | `contest("pool_1")` |  | ACCEPTED | SUCCESS | MEETS | [`0xf914c755…2b5409`](https://explorer-studio.genlayer.com/tx/0xf914c75503f158deedc5703b5f1370bcb12990f581d2933235f6aae58c2b5409) |
| donor-2 | `resolve("pool_1")` |  | ACCEPTED | SUCCESS | paid | [`0xa738de4d…54a4d6`](https://explorer-studio.genlayer.com/tx/0xa738de4d2e106a5a454f2202226465ab5a5490f6dbb0b7ccb817ee014754a4d6) |
| recipient | `trigger("pool_2", "EQ", "1474477")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0x1f42fecc…837c56`](https://explorer-studio.genlayer.com/tx/0x1f42fecc119706f57a03837d40acd45fed6e406b38ff7fcb7b5b5ce24f837c56) |
| recipient | `resolve("pool_2")` |  | ACCEPTED | SUCCESS | dismissed | [`0xf867f157…fe99dd`](https://explorer-studio.genlayer.com/tx/0xf867f157f8187e82ea13aba1690acd19150ce5e1c0dfaa278ad54703f9fe99dd) |

## Close and reclaim

`pool_1`'s coverage ends on 2026-10-04 (UTC), so it can be closed from 2026-10-05. Then donor-1 (5 of 8 GEN donated) and
donor-2 (3 of 8) reclaim their pro-rata shares of the 6 GEN left: 3.75 and 2.25 GEN.

```shell
node scripts/demo.mjs <contract> close pool_1 <donor-1 key> <donor-2 key>
```

The pro-rata arithmetic, closing before the end date and reclaiming twice are covered by the direct-mode tests.
