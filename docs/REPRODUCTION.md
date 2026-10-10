# Reproduction log

Live run of `scripts/demo.mjs` on GenLayer Studio, 2026-10-09/10 (UTC), against contract
[`0xe4748A37243C79A7e72B1423E4DcDDb69f3DE4Ab`](https://explorer-studio.genlayer.com/address/0xe4748A37243C79A7e72B1423E4DcDDb69f3DE4Ab). The deployed code is byte-identical to `contracts/relief_trigger.py`
(`node scripts/verify-code.mjs 0xe4748A37243C79A7e72B1423E4DcDDb69f3DE4Ab` prints `identical (30474 bytes)`). The raw run, with every hash, is in
[`demo-run.json`](demo-run.json).

This deployment adds the donor-majority release and side-specific contests requested in review; earlier deployments
(`0x6C4f01974d6059c1aA9Bfb0Bb9B353981e58f1B4` and before) used the previous rules and are superseded.

Accounts (throwaway, funded from the Studio faucet):

| Role | Address |
|---|---|
| donor-1 | `0xFEd27A839CC8C294da224a9ad7A86aBcc6FE209A` |
| donor-2 | `0x11893435C1487e4435Be855db6289972ab00e52e` |
| recipient (the responder) | `0x3139d8B50C7B3425Ec28EAf8ef139C55A29c6AAD` |

## Pools

| Pool | Terms | Funding before any claim |
|---|---|---|
| `pool_0` Central Myanmar earthquake response | EQ · MMR · Orange+ · M ≥ 7 · ≥ 1,000,000 exposed · area: *"The earthquake struck the Mandalay or Sagaing Region of central Myanmar."* · payout 4 GEN | donor-1 10, donor-2 5 (a 0.05 GEN donation was refunded) |
| `pool_1` Mexico Pacific hurricane fund | TC · MEX · Red · wind ≥ 180 km/h · events 2026-06-01 → 2026-10-09 · payout 2 GEN | donor-1 5, donor-2 3 |
| `pool_2` Rakhine coast earthquake response | EQ · MMR · Orange+ · M ≥ 6 · area: *"Rakhine State on Myanmar's western coast."* · payout 1 GEN | donor-1 2 |
| `pool_3` DEMO · Istanbul / Marmara earthquake response | EQ · TUR · Red · M ≥ 7 · ≥ 1,000,000 exposed · Marmara area condition · 2026 → 2036 · payout 5 GEN | donor-1 20, donor-2 10 |
| `pool_4` DEMO · European wildfire recovery | WF · ESP, FRA, GRC, ITA, PRT, TUR · Red · payout 3 GEN | donor-1 15, donor-2 5 |

## Claims, rulings and who released them

| Pool | GDACS event | What validators read | Verdict | How it ended |
|---|---|---|---|---|
| `pool_0` | [EQ 1474479](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1474479) | Red · MMR · M6.7 · USGS M6.7 | DOES_NOT_MEET (`severity`) | the recipient dismissed it early (only it can) |
| `pool_0` | [EQ 1477002](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1477002) | Red · MMR · M5.5 · USGS M5.3 | DOES_NOT_MEET (`severity`) | superseded by the next trigger |
| `pool_0` | [EQ 1474477](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1474477) | Red · MMR · M7.7 · USGS M7.7 · 17,235,221 exposed | **MEETS** (`area`) | see the governance walk-through below: released by donors holding 15 of 15 GEN → **4 GEN to the recipient** |
| `pool_1` | [EQ 1474477](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1474477) | an earthquake on a cyclone pool | DOES_NOT_MEET (`hazard`) | dismissed by the recipient |
| `pool_1` | [TC 1001325](https://www.gdacs.org/report.aspx?eventtype=TC&eventid=1001325) POLO-26 | Red · MEX · 287 km/h | **MEETS** (`met`) | donor-2 contested (re-assessed MEETS, window restarted); donor-1 (5 of 8 GEN) approved → **2 GEN to the recipient** |
| `pool_2` | [EQ 1474477](https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1474477) | every coded term passes | DOES_NOT_MEET (`area`) | the recipient dismissed it |
| `pool_4` | [WF 1029628](https://www.gdacs.org/report.aspx?eventtype=WF&eventid=1029628) France, July 2026 | Red · FRA · 47,910 ha | **MEETS** (`met`) | donor-1 (15 of 20 GEN) approved → **3 GEN to the recipient** |

## Governance walk-through on `pool_0` (the protections from the review, live)

Once the M7.7 claim was open, the snapshot gave donor-1 a say of 10 GEN and donor-2 5 GEN (15 GEN in total; the recipient
none):

1. The **recipient** tried to approve the release of its own payout: refused.
2. The **recipient** tried to contest the payout: refused (contests of a payout belong to donors).
3. donor-2 then **donated another 20 GEN** while the claim was pending, and approved: the approval counted only the
   5 GEN donated before the claim (5 of 15, not a majority).
4. The recipient tried to **resolve** with that minority approval: refused.
5. donor-1 approved (15 of 15): the payout was released at once.

On `pool_1`, donor-2's contest restarted the window and a second donor contest was refused; on `pool_2`, a donor's
attempt to contest a dismissal was refused. Every refusal is a recorded transaction:

| Who | Call | Contract message | Tx |
|---|---|---|---|
| recipient | `approve_release` on `pool_0` | Only a donor who donated before this claim can approve its release | [`0xe5799d55…d542be`](https://explorer-studio.genlayer.com/tx/0xe5799d554d61d3c38cd3858636352e18f3f9be35f240b34f40618d5b58d542be) |
| recipient | `contest` on `pool_0` | Only a donor who donated before this claim can contest a payout | [`0xbbca8741…3d4f73`](https://explorer-studio.genlayer.com/tx/0xbbca874183757a88fcc5e8b0f3ad488c02a415bbb657ee96b989cf38153d4f73) |
| recipient | `resolve` on `pool_0` | The contest window is still open; an early payout needs approval from donors holding more than half of the pre-claim donations | [`0x1891232b…cf4d61`](https://explorer-studio.genlayer.com/tx/0x1891232b6d64f67936dc8fcdd1883668297cff4d6b15a9090e550b4840cf4d61) |
| donor-2 | `contest` on `pool_1` | Donors have already contested this claim | [`0xc2ecb581…001667`](https://explorer-studio.genlayer.com/tx/0xc2ecb581363d97a5443fbf4ffee33c5b0b50fe98bdd571974ea8882b4e001667) |
| donor-1 | `contest` on `pool_2` | Only the recipient can contest a claim that does not pay | [`0x3f012207…7e8b67`](https://explorer-studio.genlayer.com/tx/0x3f0122070b4aa1af77e7b2dec371d9d4f2a42a75348b9e27d698174a817e8b67) |

## Close and pro-rata reclaim

`pool_1` (Mexico) covered events until 2026-10-09; on 2026-10-10 (UTC) it was closed with 6 GEN left of 8 GEN donated (donor-1 5,
donor-2 3), and each donor reclaimed their pro-rata share: donor-1 5/8 of 6 = 3.75 GEN, donor-2 the rest, 2.25 GEN (the
last reclaimer also takes any rounding remainder). The pool's balance is 0 and the contract holds 80 GEN, the four other pools.

| Step | Tx | Amount |
|---|---|---|
| donor-1 `close` | [`0x5cdefee0…fe8e25`](https://explorer-studio.genlayer.com/tx/0x5cdefee031ba525df74578ff9b525b834aeb5027af419cbeff6afce32ffe8e25) |  |
| donor-1 `reclaim` | [`0x66fb5e70…ab0adc`](https://explorer-studio.genlayer.com/tx/0x66fb5e7049c1c5082cfa998d0051efec75f39612764bce2f3efba3d571ab0adc) | 3750000000000000000 |
| donor-2 `reclaim` | [`0x8224fe93…40c1de`](https://explorer-studio.genlayer.com/tx/0x8224fe93d725c0c3d822ba46970f2616a859f5583a7a22aacb8f1e183340c1de) | 2250000000000000000 |

## Balances

| Account | Before | After |
|---|---|---|
| recipient | 1.00 | **10.00** (+4 Myanmar, +2 POLO-26, +3 France wildfire) |
| contract | 0 | **86.00** after the claims (pool_0 31 + pool_1 6 + pool_2 2 + pool_3 30 + pool_4 17), then 80.00 after pool_1 was closed and reclaimed |

## Every transaction

| Who | Call | GEN | Status | Execution | Returned | Tx |
|---|---|---|---|---|---|---|
| donor-1 | `create_pool("Central Myanmar earthquake response", "0x3139d8B50C7B3425Ec28EAf8ef139C55A29c6, "EQ", "MMR", "Orange", "7", 1000000, "The earthquake struck the Mandalay or S, 4 GEN, "2025-01-01", "2026-12-31")` | 10 | ACCEPTED | SUCCESS | pool_0 | [`0x51f3fc13…c7b10d`](https://explorer-studio.genlayer.com/tx/0x51f3fc13f34a9493634f6dfbe0fccd1316356c78a3f8ea7ce3284da579c7b10d) |
| donor-2 | `donate("pool_0")` | 5 | ACCEPTED | SUCCESS | donated | [`0xd0213823…1ec77e`](https://explorer-studio.genlayer.com/tx/0xd02138235b4a585d1fe8c93a74089a7a618d5952fa33b9939058ba7ddb1ec77e) |
| donor-2 | `donate("pool_0")` | 0.05 | ACCEPTED | SUCCESS | REFUNDED: A donation must be at least 0.1 GEN | [`0xd528c937…a19dc6`](https://explorer-studio.genlayer.com/tx/0xd528c93729660d5badd13172c325ea9706edc7f2279ff39c34cfa130aca19dc6) |
| donor-1 | `create_pool("Mexico Pacific hurricane fund", "0x3139d8B50C7B3425Ec28EAf8ef139C55A29c6, "TC", "MEX", "Red", "180", 0, "", 2 GEN, "2026-06-01", "2026-10-09")` | 5 | ACCEPTED | SUCCESS | pool_1 | [`0x6bde1f56…87cdbf`](https://explorer-studio.genlayer.com/tx/0x6bde1f56a7c0bf5b3740e8c691f173a390da04a07f9596a2768491d0be87cdbf) |
| donor-2 | `donate("pool_1")` | 3 | ACCEPTED | SUCCESS | donated | [`0x1dc2cb9e…df2462`](https://explorer-studio.genlayer.com/tx/0x1dc2cb9ed52a41a144f5e16c706782a4fb792bae19bfef96c0b35dfccbdf2462) |
| donor-1 | `create_pool("Rakhine coast earthquake response", "0x3139d8B50C7B3425Ec28EAf8ef139C55A29c6, "EQ", "MMR", "Orange", "6", 0, "The earthquake struck Rakhine State on , 1 GEN, "2025-01-01", "2026-12-31")` | 2 | ACCEPTED | SUCCESS | pool_2 | [`0x8a9f8046…5305bf`](https://explorer-studio.genlayer.com/tx/0x8a9f804601fd3f7a45fd883e316dcee54d84d044cc86f38e117e0188585305bf) |
| recipient | `trigger("pool_0", "EQ", "1474479")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0xe2b32dfb…828683`](https://explorer-studio.genlayer.com/tx/0xe2b32dfbd4569f54fa4bf1fa6fc9a2b2a9dc8c69d7d410a139f3a8d582828683) |
| recipient | `resolve("pool_0")` |  | ACCEPTED | SUCCESS | dismissed | [`0xc038d61e…bac169`](https://explorer-studio.genlayer.com/tx/0xc038d61e0b549117d20f2d1ee45754341f2272fcdcd59c1d8cdd15b530bac169) |
| donor-2 | `trigger("pool_0", "EQ", "1477002")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0xfe0bbdd1…a33fca`](https://explorer-studio.genlayer.com/tx/0xfe0bbdd1d591a7ebbce1218f6f3c5b48c12c8423f9822fb35966a837f4a33fca) |
| recipient | `trigger("pool_0", "EQ", "1474477")` |  | ACCEPTED | SUCCESS | MEETS | [`0x81246dc7…b3e6a1`](https://explorer-studio.genlayer.com/tx/0x81246dc72414fea733e7b62699c7ca754e24b3be4335348815e154b71eb3e6a1) |
| recipient | `approve_release("pool_0")` |  | ACCEPTED | ERROR | refused: Only a donor who donated before this claim can approve its release | [`0xe5799d55…d542be`](https://explorer-studio.genlayer.com/tx/0xe5799d554d61d3c38cd3858636352e18f3f9be35f240b34f40618d5b58d542be) |
| recipient | `contest("pool_0")` |  | ACCEPTED | ERROR | refused: Only a donor who donated before this claim can contest a payout | [`0xbbca8741…3d4f73`](https://explorer-studio.genlayer.com/tx/0xbbca874183757a88fcc5e8b0f3ad488c02a415bbb657ee96b989cf38153d4f73) |
| donor-2 | `donate("pool_0")` | 20 | ACCEPTED | SUCCESS | donated | [`0x0250c880…2299ff`](https://explorer-studio.genlayer.com/tx/0x0250c880c533e62220e2db373a3d97db1d461bcec7367782ab94a7f17d2299ff) |
| donor-2 | `approve_release("pool_0")` |  | ACCEPTED | SUCCESS | approved | [`0x5eada37c…973166`](https://explorer-studio.genlayer.com/tx/0x5eada37cf84bc4d8c389db3355c03f46d102fed17e4ca0b8b0b05727af973166) |
| recipient | `resolve("pool_0")` |  | ACCEPTED | ERROR | refused: The contest window is still open; an early payout needs approval from donors holding more than half of the pre-claim donations | [`0x1891232b…cf4d61`](https://explorer-studio.genlayer.com/tx/0x1891232b6d64f67936dc8fcdd1883668297cff4d6b15a9090e550b4840cf4d61) |
| donor-1 | `approve_release("pool_0")` |  | ACCEPTED | SUCCESS | paid | [`0x0a57a7cc…5391cf`](https://explorer-studio.genlayer.com/tx/0x0a57a7cc010d30f9c7840811cd78e74bee3ad9b5e70e40e9d6c64963fe5391cf) |
| donor-2 | `trigger("pool_1", "EQ", "1474477")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0xb6bd9037…d15537`](https://explorer-studio.genlayer.com/tx/0xb6bd903796e55ee1457bbbd69ada96b033cc52912a6f53ed935b78542ad15537) |
| recipient | `resolve("pool_1")` |  | ACCEPTED | SUCCESS | dismissed | [`0x191d6feb…3569e3`](https://explorer-studio.genlayer.com/tx/0x191d6feb979d608be1aa2b221aa41af9b2d71b69f44797c6c65fd7f6aa3569e3) |
| recipient | `trigger("pool_1", "TC", "1001325")` |  | ACCEPTED | SUCCESS | MEETS | [`0x7923325b…bc5859`](https://explorer-studio.genlayer.com/tx/0x7923325babd76f357a1496693c3cf978495f9068ed775121e2d875748ebc5859) |
| donor-2 | `contest("pool_1")` |  | ACCEPTED | SUCCESS | MEETS | [`0x6b00aebe…3f51de`](https://explorer-studio.genlayer.com/tx/0x6b00aebeebfcd9afbee52208aecef0e91402a1cce5f3d35f5ff05161613f51de) |
| donor-2 | `contest("pool_1")` |  | ACCEPTED | ERROR | refused: Donors have already contested this claim | [`0xc2ecb581…001667`](https://explorer-studio.genlayer.com/tx/0xc2ecb581363d97a5443fbf4ffee33c5b0b50fe98bdd571974ea8882b4e001667) |
| donor-1 | `approve_release("pool_1")` |  | ACCEPTED | SUCCESS | paid | [`0x36f67b07…4ac5de`](https://explorer-studio.genlayer.com/tx/0x36f67b07dc34802aa039bf65e23077e64792c08b5e5f657b8baed09b1a4ac5de) |
| recipient | `trigger("pool_2", "EQ", "1474477")` |  | ACCEPTED | SUCCESS | DOES_NOT_MEET | [`0xd207115b…b520c2`](https://explorer-studio.genlayer.com/tx/0xd207115b3f03673efe7b2054b9fe5f2da53031c340c4180dc94a107fe6b520c2) |
| donor-1 | `contest("pool_2")` |  | ACCEPTED | ERROR | refused: Only the recipient can contest a claim that does not pay | [`0x3f012207…7e8b67`](https://explorer-studio.genlayer.com/tx/0x3f0122070b4aa1af77e7b2dec371d9d4f2a42a75348b9e27d698174a817e8b67) |
| recipient | `resolve("pool_2")` |  | ACCEPTED | SUCCESS | dismissed | [`0x9360220d…b7e120`](https://explorer-studio.genlayer.com/tx/0x9360220d5d604f81fbf7b472d40be9c7ff22a5387ab83ba4300f4d2e6ab7e120) |
| donor-1 | `create_pool("DEMO · Istanbul / Marmara earthquake re, "0x3139d8B50C7B3425Ec28EAf8ef139C55A29c6, "EQ", "TUR", "Red", "7", 1000000, "The earthquake struck the Marmara regio, 5 GEN, "2026-10-09", "2036-10-04")` | 20 | ACCEPTED | SUCCESS | pool_3 | [`0xde3fd2dd…d266f8`](https://explorer-studio.genlayer.com/tx/0xde3fd2dd582603c503fd91b04c4f618c7811ce31cb1d423a286ea59c58d266f8) |
| donor-2 | `donate("pool_3")` | 10 | ACCEPTED | SUCCESS | donated | [`0x801fc4c9…a90561`](https://explorer-studio.genlayer.com/tx/0x801fc4c9a3f997943e7c57019fdeba4cc2ceaf7a6fdea89a93ed4a37c3a90561) |
| donor-1 | `create_pool("DEMO · European wildfire recovery: refo, "0x3139d8B50C7B3425Ec28EAf8ef139C55A29c6, "WF", "ESP,FRA,GRC,ITA,PRT,TUR", "Red", "", 0, "", 3 GEN, "2026-06-01", "2027-12-31")` | 15 | ACCEPTED | SUCCESS | pool_4 | [`0x0e104279…7ec8d1`](https://explorer-studio.genlayer.com/tx/0x0e1042799c88dc0ec944f3e11c91450278812bf39601fdf489ca01162e7ec8d1) |
| donor-2 | `donate("pool_4")` | 5 | ACCEPTED | SUCCESS | donated | [`0xbb2d84fa…bdf490`](https://explorer-studio.genlayer.com/tx/0xbb2d84fac8cacb117e2c01bb4f51b20247a47b1665ee63f48a3a49e67fbdf490) |
| donor-2 | `trigger("pool_4", "WF", "1029628")` |  | ACCEPTED | SUCCESS | MEETS | [`0xaeb03198…3e7aae`](https://explorer-studio.genlayer.com/tx/0xaeb0319899ef6b8852cef080eab2ab236941fc304e0edaf19345dfe2ba3e7aae) |
| donor-1 | `approve_release("pool_4")` |  | ACCEPTED | SUCCESS | paid | [`0x5165b4db…8bf20d`](https://explorer-studio.genlayer.com/tx/0x5165b4db26534c1e5b037b4585418313be2ac0bace3fb51831f8a7a2db8bf20d) |
