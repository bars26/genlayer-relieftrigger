"""Direct-mode tests for the ReliefTrigger contract."""

import json

import pytest

from tests.direct.conftest import to_hex

CONTRACT_PATH = "contracts/relief_trigger.py"
GEN = 10**18

GDACS_RE = r"^https://www\.gdacs\.org/gdacsapi/api/events/geteventdata\?eventtype=EQ&eventid=1474477$"
USGS_RE = r"^https://earthquake\.usgs\.gov/fdsnws/event/1/query\?format=geojson&eventid=us7000pn9s$"


def _gdacs(alert="Red", iso3="MMR", mag=7.7, date="2025-03-28T06:20:54", shakepop="17235221", etype="EQ"):
    return {
        "properties": {
            "eventtype": etype,
            "eventid": 1474477,
            "alertlevel": alert,
            "iso3": iso3,
            "fromdate": date,
            "affectedcountries": [{"iso2": "MM", "iso3": iso3, "countryname": "Myanmar"}],
            "severitydata": {"severity": mag, "severitytext": f"Magnitude {mag}M, Depth:10km", "severityunit": "M"},
            "htmldescription": f"{alert} M {mag} Earthquake in Myanmar at: 28 Mar 2025 06:20:54.",
            "earthquakedetails": {"shakepop": shakepop},
            "source": "NEIC",
            "sourceid": "us7000pn9s",
        }
    }


def _usgs(mag=7.7, place="2025 Mandalay, Burma (Myanmar) Earthquake"):
    return {"type": "Feature", "properties": {"mag": mag, "place": place}}


def _mock_json(direct_vm, pattern, body, status=200):
    direct_vm.mock_web(
        pattern,
        {
            "method": "GET",
            "response": {
                "status": status,
                "headers": {"Content-Type": b"application/json"},
                "body": json.dumps(body).encode() if body is not None else b"not found",
            },
        },
    )


def _setup(direct_vm, gdacs=None, usgs=None, gdacs_status=200, usgs_status=200, verdict="MEETS"):
    direct_vm.clear_mocks()
    _mock_json(direct_vm, GDACS_RE, _gdacs() if gdacs is None else gdacs, gdacs_status)
    _mock_json(direct_vm, USGS_RE, _usgs() if usgs is None else usgs, usgs_status)
    direct_vm.mock_llm(r".*", json.dumps({"verdict": verdict}))


def _one(who, label="Responder"):
    return json.dumps([{"address": to_hex(who), "percent": 100, "label": label}])


def _create(direct_vm, direct_deploy, creator, beneficiary, amount=10 * GEN, **terms):
    direct_vm.sender = creator
    contract = direct_deploy(CONTRACT_PATH)
    args = dict(
        name="Myanmar earthquake response",
        recipients=_one(beneficiary),
        hazards="EQ",
        countries="MMR",
        min_alert="Orange",
        thresholds="EQ:7",
        min_exposed=1_000_000,
        area_terms="",
        payout=4 * GEN,
        coverage_start="2025-01-01",
        coverage_end="2026-12-31",
    )
    args.update(terms)
    direct_vm.value = amount
    pool_id = contract.create_pool(*args.values())
    direct_vm.value = 0
    return contract, pool_id


def _trigger(direct_vm, contract, pool_id, who, **setup):
    _setup(direct_vm, **setup)
    direct_vm.sender = who
    return contract.trigger(pool_id, "EQ", "1474477")


def _expire_claim_window(contract, pool_id):
    contract.pools[pool_id].claim_at = "2000-01-01T00:00:00+00:00"


# --- creating and funding ---------------------------------------------------


def test_create_pool_records_terms_and_funding(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    pool = contract.get_pool(pool_id)
    assert pool_id == "pool_0"
    assert (pool.state, pool.hazards, pool.countries, pool.min_alert) == ("open", "EQ", "MMR", "ORANGE")
    assert int(pool.balance) == 10 * GEN and int(pool.total_donated) == 10 * GEN
    assert contract.get_contribution(pool_id, to_hex(direct_alice)) == str(10 * GEN)
    assert [e["event"] for e in contract.get_history(pool_id)] == ["created"]


@pytest.mark.parametrize(
    "terms, reason",
    [
        ({"hazards": "XX"}, "hazards must be a comma list"),
        ({"countries": "Myanmar"}, "countries must be a comma list of ISO3"),
        ({"min_alert": "purple"}, "min_alert must be Green, Orange or Red"),
        ({"thresholds": "EQ:-3"}, "thresholds must look like EQ:7, TC:180, WF:10000"),
        ({"thresholds": "FL:3"}, "thresholds must look like EQ:7, TC:180, WF:10000"),
        ({"thresholds": "WF:10000"}, "thresholds may only name the pool's own hazards (WF is not one of them)"),
        ({"payout": 0}, "payout must be positive"),
        ({"payout": 11 * GEN}, "payout must be positive and no more than the initial funding"),
        ({"coverage_start": "2026-02-01", "coverage_end": "2026-01-01"}, "coverage_start must not be after"),
        ({"coverage_end": "2020-01-01", "coverage_start": "2019-01-01"}, "coverage_end is already in the past"),
        ({"recipients": "not-json"}, "recipients must be a JSON list"),
        ({"recipients": "[]"}, "recipients must list 1 to 5 wallets"),
        ({"recipients": json.dumps([{"address": "0x" + "11" * 20, "percent": 60}, {"address": "0x" + "22" * 20, "percent": 30}])},
         "recipient percents must add up to 100"),
        ({"recipients": json.dumps([{"address": "0x" + "11" * 20, "percent": 50}, {"address": "0x" + "11" * 20, "percent": 50}])},
         "each recipient wallet can appear only once"),
        ({"recipients": json.dumps([{"address": "nope", "percent": 100}])}, "each recipient needs a wallet address"),
        ({"recipients": json.dumps([{"address": "0x" + f"{i:02x}" * 20, "percent": 10} for i in range(1, 7)])},
         "recipients must list 1 to 5 wallets"),
        ({"name": ""}, "name is required"),
    ],
)
def test_invalid_pool_terms_are_refunded(direct_vm, direct_deploy, direct_alice, direct_bob, terms, reason):
    contract, result = _create(direct_vm, direct_deploy, direct_alice, direct_bob, **terms)
    assert result.startswith(f"REFUNDED: {reason}")
    assert contract.list_pools() == []


def test_pool_needs_at_least_one_gen(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, result = _create(direct_vm, direct_deploy, direct_alice, direct_bob, amount=GEN - 1, payout=GEN // 2)
    assert result.startswith("REFUNDED: A pool must start with at least 1 GEN")


def test_donations_accumulate_per_donor(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_charlie
    direct_vm.value = 2 * GEN
    assert contract.donate(pool_id) == "donated"
    direct_vm.value = 3 * GEN
    assert contract.donate(pool_id) == "donated"
    direct_vm.value = GEN // 100
    assert contract.donate(pool_id).startswith("REFUNDED: A donation must be at least 0.1 GEN")
    direct_vm.value = 0
    pool = contract.get_pool(pool_id)
    assert int(pool.balance) == 15 * GEN
    assert contract.get_contribution(pool_id, to_hex(direct_charlie)) == str(5 * GEN)
    assert len(json.loads(pool.donors_json)) == 2


# --- triggering ---------------------------------------------------------------


def test_qualifying_event_meets(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert _trigger(direct_vm, contract, pool_id, direct_charlie) == "MEETS"
    pool = contract.get_pool(pool_id)
    assert (pool.state, pool.claim_event, pool.claim_code) == ("pending", "EQ:1474477", "met")
    facts = json.loads(pool.claim_facts_json)
    assert facts["countries"] == ["MMR"] and facts["usgs_mag"] == 7.7 and facts["exposed"] == 17235221


@pytest.mark.parametrize(
    "terms, setup, code",
    [
        ({"hazards": "TC", "thresholds": ""}, {}, "hazard"),
        ({"countries": "NPL"}, {}, "country"),
        ({"min_alert": "Red"}, {"gdacs": _gdacs(alert="Orange")}, "alert"),
        ({"coverage_start": "2025-06-01"}, {}, "date"),
        ({}, {"gdacs": _gdacs(mag=6.4), "usgs": _usgs(mag=6.4)}, "severity"),
        ({}, {"gdacs": _gdacs(shakepop="900000")}, "exposure"),
        ({}, {"usgs": _usgs(mag=6.9)}, "sources_disagree"),
    ],
)
def test_terms_are_enforced_in_code(direct_vm, direct_deploy, direct_alice, direct_bob, terms, setup, code):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, **terms)
    # The model would say MEETS; code must decide before it is ever asked.
    assert _trigger(direct_vm, contract, pool_id, direct_bob, verdict="MEETS", **setup) == "DOES_NOT_MEET"
    assert contract.get_pool(pool_id).claim_code == code


def test_unreachable_sources_are_unclear(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert _trigger(direct_vm, contract, pool_id, direct_bob, usgs_status=503) == "UNCLEAR"
    assert contract.get_pool(pool_id).claim_code == "usgs_unreachable"


def test_gdacs_unreachable_is_unclear(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert _trigger(direct_vm, contract, pool_id, direct_bob, gdacs_status=404) == "UNCLEAR"
    assert contract.get_pool(pool_id).claim_code == "gdacs_unreachable"


@pytest.mark.parametrize("verdict", ["MEETS", "DOES_NOT_MEET", "UNCLEAR"])
def test_area_condition_goes_to_the_model(direct_vm, direct_deploy, direct_alice, direct_bob, verdict):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob,
                                area_terms="Mandalay or Sagaing region of central Myanmar")
    assert _trigger(direct_vm, contract, pool_id, direct_bob, verdict=verdict) == verdict
    assert contract.get_pool(pool_id).claim_code == "area"


def test_non_enum_llm_verdict_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, area_terms="central Myanmar")
    _setup(direct_vm, verdict="yes")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("LLM verdict must be one of MEETS, DOES_NOT_MEET, UNCLEAR"):
        contract.trigger(pool_id, "EQ", "1474477")
    assert contract.get_pool(pool_id).state == "open"


def test_trigger_input_validation(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("event must be a GDACS event type"):
        contract.trigger(pool_id, "EQ", "1474477; drop")
    with direct_vm.expect_revert("event must be a GDACS event type"):
        contract.trigger(pool_id, "QUAKE", "1474477")


def test_pending_qualifying_claim_blocks_new_triggers(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    with direct_vm.expect_revert("A qualifying claim is pending; resolve it first"):
        contract.trigger(pool_id, "EQ", "1474477")


def test_non_qualifying_claim_is_superseded(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    # A stranger parks a failing claim on the pool...
    assert _trigger(direct_vm, contract, pool_id, direct_charlie, gdacs=_gdacs(mag=6.0), usgs=_usgs(mag=6.0)) == "DOES_NOT_MEET"
    # ...and the real disaster replaces it at once, without waiting for the window.
    assert _trigger(direct_vm, contract, pool_id, direct_bob) == "MEETS"
    events = [(e["event"], e.get("code")) for e in contract.get_history(pool_id)]
    assert events[-2:] == [("superseded", "severity"), ("triggered", "met")]
    assert contract.get_pool(pool_id).claim_by.as_hex.lower() == to_hex(direct_bob).lower()


def test_closed_pool_cannot_be_triggered(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    contract.pools[pool_id].coverage_end = "2000-01-01"
    contract.close(pool_id)
    with direct_vm.expect_revert("This pool is closed"):
        contract.trigger(pool_id, "EQ", "1474477")


# --- resolving and early release ----------------------------------------------

# A fourth account that only appears after a claim is opened.
LATECOMER = b"\xd4" * 20


def _donate(direct_vm, contract, pool_id, who, amount):
    direct_vm.sender = who
    direct_vm.value = amount
    result = contract.donate(pool_id)
    direct_vm.value = 0
    return result


def test_payout_waits_for_window_or_donor_majority(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_charlie)
    for who in (direct_charlie, direct_bob):  # a stranger and the recipient cannot rush a payout
        direct_vm.sender = who
        with direct_vm.expect_revert("an early payout needs approval from donors holding more than half"):
            contract.resolve(pool_id)
    direct_vm.sender = direct_alice  # the only pre-claim donor holds 100% of the say
    assert contract.approve_release(pool_id) == "paid"
    pool = contract.get_pool(pool_id)
    assert pool.state == "open"
    assert int(pool.balance) == 6 * GEN and int(pool.total_paid) == 4 * GEN
    assert contract.was_paid(pool_id, "EQ", "1474477") is True
    assert [h["event"] for h in contract.get_history(pool_id)[-2:]] == ["approved", "paid"]


def test_minority_donor_cannot_release_a_payout(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)  # alice 10 GEN
    _donate(direct_vm, contract, pool_id, direct_charlie, 5 * GEN)  # charlie 5 GEN, before the claim
    _trigger(direct_vm, contract, pool_id, direct_bob)
    pool = contract.get_pool(pool_id)
    assert int(pool.claim_weight_total) == 15 * GEN
    direct_vm.sender = direct_charlie
    assert contract.approve_release(pool_id) == "approved"  # 5 of 15: not a majority
    with direct_vm.expect_revert("You have already approved this release"):
        contract.approve_release(pool_id)
    with direct_vm.expect_revert("an early payout needs approval from donors holding more than half"):
        contract.resolve(pool_id)
    assert contract.get_pool(pool_id).state == "pending"
    direct_vm.sender = direct_alice
    assert contract.approve_release(pool_id) == "paid"  # 15 of 15


def test_late_donation_gives_no_say_in_the_open_claim(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, amount=2 * GEN, payout=GEN)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    # A newcomer donates far more than everyone else while the claim is pending...
    assert _donate(direct_vm, contract, pool_id, LATECOMER, 100 * GEN) == "donated"
    assert contract.claim_weight(pool_id, to_hex(LATECOMER)) == "0"
    # ...and still cannot release the payout, contest it, or resolve it early.
    with direct_vm.expect_revert("Only a donor who donated before this claim can approve its release"):
        contract.approve_release(pool_id)
    with direct_vm.expect_revert("Only a donor who donated before this claim can contest a payout"):
        contract.contest(pool_id)
    with direct_vm.expect_revert("an early payout needs approval"):
        contract.resolve(pool_id)
    assert int(contract.get_pool(pool_id).claim_weight_total) == 2 * GEN


def test_recipient_donations_give_no_say(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _donate(direct_vm, contract, pool_id, direct_bob, 50 * GEN)  # the beneficiary buys "weight" before the claim
    _trigger(direct_vm, contract, pool_id, direct_bob)
    assert int(contract.get_pool(pool_id).claim_weight_total) == 10 * GEN
    assert contract.claim_weight(pool_id, to_hex(direct_bob)) == "0"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only a donor who donated before this claim can approve its release"):
        contract.approve_release(pool_id)
    with direct_vm.expect_revert("Only a donor who donated before this claim can contest a payout"):
        contract.contest(pool_id)


def test_same_event_cannot_be_paid_twice(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    _expire_claim_window(contract, pool_id)
    contract.resolve(pool_id)
    with direct_vm.expect_revert("This event has already been paid from this pool"):
        contract.trigger(pool_id, "EQ", "1474477")


def test_payout_is_capped_by_the_balance(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, amount=3 * GEN, payout=3 * GEN)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    _expire_claim_window(contract, pool_id)
    contract.resolve(pool_id)
    assert int(contract.get_pool(pool_id).balance) == 0
    with direct_vm.expect_revert("The pool has no funds left"):
        contract.trigger(pool_id, "EQ", "1474478")


def test_failed_claim_is_dismissed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, countries="NPL")
    _trigger(direct_vm, contract, pool_id, direct_charlie)
    direct_vm.sender = direct_alice  # a donor cannot dismiss early, only the recipient
    with direct_vm.expect_revert("only a recipient can dismiss early"):
        contract.resolve(pool_id)
    with direct_vm.expect_revert("Only a pending claim that meets the terms can be released"):
        contract.approve_release(pool_id)
    direct_vm.sender = direct_bob
    assert contract.resolve(pool_id) == "dismissed"
    pool = contract.get_pool(pool_id)
    assert pool.state == "open" and int(pool.balance) == 10 * GEN


# --- contesting ---------------------------------------------------------------


def test_recipient_cannot_contest_a_payout(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only a donor who donated before this claim can contest a payout"):
        contract.contest(pool_id)


def test_donor_cannot_contest_a_dismissal(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, countries="NPL")
    _trigger(direct_vm, contract, pool_id, direct_charlie)
    for who in (direct_alice, direct_charlie):
        direct_vm.sender = who
        with direct_vm.expect_revert("Only a recipient can contest a claim that does not pay"):
            contract.contest(pool_id)


def test_recipient_contest_restarts_the_window_for_donors(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, area_terms="central Myanmar")
    assert _trigger(direct_vm, contract, pool_id, direct_charlie, verdict="UNCLEAR") == "UNCLEAR"
    # The recipient contests and the re-assessment flips the claim to a payout...
    _setup(direct_vm, verdict="MEETS")
    direct_vm.sender = direct_bob
    assert contract.contest(pool_id) == "MEETS"
    pool = contract.get_pool(pool_id)
    assert pool.recipient_contested and not pool.donor_contested
    # ...which does not open a shortcut: nobody can resolve the new payout early,
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("an early payout needs approval"):
        contract.resolve(pool_id)
    # the recipient cannot contest again, and the donors can still answer.
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only a donor who donated before this claim can contest a payout"):
        contract.contest(pool_id)
    _setup(direct_vm, verdict="DOES_NOT_MEET")
    direct_vm.sender = direct_alice
    assert contract.contest(pool_id) == "DOES_NOT_MEET"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("The recipients have already contested this claim"):
        contract.contest(pool_id)
    _expire_claim_window(contract, pool_id)
    direct_vm.sender = direct_charlie  # after the last window anyone settles
    assert contract.resolve(pool_id) == "dismissed"


def test_donors_contest_once_and_a_contest_clears_approvals(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _donate(direct_vm, contract, pool_id, direct_charlie, 5 * GEN)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    direct_vm.sender = direct_charlie
    assert contract.approve_release(pool_id) == "approved"
    _setup(direct_vm, verdict="MEETS")
    direct_vm.sender = direct_alice
    assert contract.contest(pool_id) == "MEETS"
    pool = contract.get_pool(pool_id)
    assert int(pool.approval_weight) == 0 and pool.approvals_json == "[]"
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Donors have already contested this claim"):
        contract.contest(pool_id)


def test_contest_window_closes(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    _expire_claim_window(contract, pool_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The contest window has closed"):
        contract.contest(pool_id)


def test_get_pools_reads_the_registry_in_one_call(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, first = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    direct_vm.value = 2 * GEN
    second = contract.create_pool("Second pool", _one(direct_bob), "TC", "MEX", "Red", "", 0, "", GEN, "2025-01-01", "2026-12-31")
    direct_vm.value = 0
    pools = contract.get_pools(0, 200)
    assert [p.id for p in pools] == [first, second]
    assert [p.id for p in contract.get_pools(1, 5)] == [second]
    assert contract.get_pools(5, 5) == []


# --- closing and reclaiming ---------------------------------------------------


def test_close_and_pro_rata_reclaim(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, amount=6 * GEN, payout=3 * GEN)
    direct_vm.sender = direct_charlie
    direct_vm.value = 3 * GEN
    contract.donate(pool_id)
    direct_vm.value = 0
    _trigger(direct_vm, contract, pool_id, direct_bob)
    _expire_claim_window(contract, pool_id)
    contract.resolve(pool_id)  # 3 GEN paid, 6 GEN left of 9 donated

    with direct_vm.expect_revert("Coverage has not ended yet"):
        contract.close(pool_id)
    contract.pools[pool_id].coverage_end = "2000-01-01"
    contract.close(pool_id)
    with direct_vm.expect_revert("Only a pending claim can be resolved"):
        contract.resolve(pool_id)

    direct_vm.sender = direct_alice
    assert contract.reclaim(pool_id) == str(4 * GEN)  # 6/9 of the 6 GEN left
    with direct_vm.expect_revert("Already reclaimed"):
        contract.reclaim(pool_id)
    direct_vm.sender = direct_charlie
    assert contract.reclaim(pool_id) == str(2 * GEN)  # 3/9 of the 6 GEN left
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only donors can reclaim"):
        contract.reclaim(pool_id)
    pool = contract.get_pool(pool_id)
    assert pool.state == "closed" and int(pool.balance) == 0
    direct_vm.sender = direct_charlie
    direct_vm.value = GEN
    assert contract.donate(pool_id).startswith("REFUNDED: This pool's coverage has ended")


def test_cannot_close_with_a_pending_claim(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    contract.pools[pool_id].coverage_end = "2000-01-01"
    with direct_vm.expect_revert("Resolve the pending claim first"):
        contract.close(pool_id)


def test_views(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert contract.list_pools() == ["pool_0"]
    assert contract.get_contribution(pool_id, to_hex(direct_bob)) == "0"
    assert contract.was_paid(pool_id, "EQ", "1474477") is False
    assert contract.contest_window_seconds() == 600
    with direct_vm.expect_revert("No pool with id pool_9"):
        contract.get_pool("pool_9")


def test_last_reclaim_takes_the_rounding_remainder(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, amount=GEN, payout=GEN)
    direct_vm.sender = direct_charlie
    direct_vm.value = 2 * GEN
    contract.donate(pool_id)
    direct_vm.value = 0
    contract.pools[pool_id].coverage_end = "2000-01-01"
    contract.close(pool_id)  # 3 GEN shared 1:2, which does not divide evenly in wei below
    contract.pools[pool_id].closing_balance = 3 * GEN - 1
    contract.pools[pool_id].balance = 3 * GEN - 1
    direct_vm.sender = direct_alice
    first = int(contract.reclaim(pool_id))
    direct_vm.sender = direct_charlie
    last = int(contract.reclaim(pool_id))
    assert first == (3 * GEN - 1) // 3
    assert first + last == 3 * GEN - 1 and int(contract.get_pool(pool_id).balance) == 0



# --- v3: per-hazard thresholds, split payouts, explained rulings -------------

WF_RE = r"^https://www\.gdacs\.org/gdacsapi/api/events/geteventdata\?eventtype=WF&eventid=1030410$"
FUND_A, FUND_B, FUND_C = "0x" + "a1" * 20, "0x" + "b2" * 20, "0x" + "c3" * 20
SPLIT = json.dumps([
    {"address": FUND_A, "percent": 50, "label": "Reforestation"},
    {"address": FUND_B, "percent": 30, "label": "Wildlife care"},
    {"address": FUND_C, "percent": 20, "label": "Displaced families"},
])


def _wildfire(ha=19294.0, iso3="ESP", alert="Orange", date="2026-08-10T00:00:00"):
    return {
        "properties": {
            "eventtype": "WF", "eventid": 1030410, "alertlevel": alert, "iso3": iso3, "fromdate": date,
            "affectedcountries": [{"iso3": iso3}],
            "severitydata": {"severity": ha, "severitytext": f"Orange impact for forestfire in {ha:.0f} ha", "severityunit": "ha"},
            "htmldescription": f"{alert} Forest fires in Spain from: 10 Aug 2026",
        }
    }


def _wf_pool(direct_vm, direct_deploy, creator, **terms):
    args = dict(recipients=SPLIT, hazards="WF", countries="ESP,FRA,GRC,ITA,PRT,TUR", min_alert="Orange",
                thresholds="WF:10000", min_exposed=0, payout=5 * GEN, coverage_start="2026-06-01", coverage_end="2027-12-31")
    args.update(terms)
    return _create(direct_vm, direct_deploy, creator, creator, **args)


def _wf_trigger(direct_vm, contract, pool_id, who, **wf):
    direct_vm.clear_mocks()
    _mock_json(direct_vm, WF_RE, _wildfire(**wf))
    direct_vm.mock_llm(r".*", json.dumps({"verdict": "MEETS"}))
    direct_vm.sender = who
    return contract.trigger(pool_id, "WF", "1030410")


def test_thresholds_are_stored_per_hazard(direct_vm, direct_deploy, direct_alice):
    contract, pool_id = _wf_pool(direct_vm, direct_deploy, direct_alice, hazards="EQ,WF", thresholds="eq:7; WF:10000")
    assert json.loads(contract.get_pool(pool_id).thresholds_json) == {"EQ": 7.0, "WF": 10000.0}


@pytest.mark.parametrize("ha, verdict, code", [(19294.0, "MEETS", "met"), (9999.0, "DOES_NOT_MEET", "severity"), (1568.0, "DOES_NOT_MEET", "severity")])
def test_wildfire_burned_area_threshold(direct_vm, direct_deploy, direct_alice, direct_bob, ha, verdict, code):
    contract, pool_id = _wf_pool(direct_vm, direct_deploy, direct_alice)
    assert _wf_trigger(direct_vm, contract, pool_id, direct_bob, ha=ha) == verdict
    pool = contract.get_pool(pool_id)
    assert pool.claim_code == code
    assert json.loads(pool.claim_facts_json)["severity"] == ha
    if code == "severity":
        assert f"{ha:,.0f} ha. The pool's burned area (ha) threshold is 10,000 ha." in pool.claim_why


def test_wildfire_without_threshold_ignores_area(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _wf_pool(direct_vm, direct_deploy, direct_alice, thresholds="")
    assert _wf_trigger(direct_vm, contract, pool_id, direct_bob, ha=50.0) == "MEETS"


def test_payout_is_split_between_recipients(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _wf_pool(direct_vm, direct_deploy, direct_alice, payout=5 * GEN - 1)
    _wf_trigger(direct_vm, contract, pool_id, direct_bob)
    _expire_claim_window(contract, pool_id)
    assert contract.resolve(pool_id) == "paid"
    paid = contract.get_history(pool_id)[-1]
    shares = [int(v) for _, v in paid["split"]]
    # 50/30/20 of an odd amount: the first recipient takes the rounding remainder.
    assert shares == [(5 * GEN - 1) - (5 * GEN - 1) * 30 // 100 - (5 * GEN - 1) * 20 // 100, (5 * GEN - 1) * 30 // 100, (5 * GEN - 1) * 20 // 100]
    assert sum(shares) == 5 * GEN - 1 and [a for a, _ in paid["split"]] == [FUND_A[:10], FUND_B[:10], FUND_C[:10]]
    assert int(contract.get_pool(pool_id).balance) == 10 * GEN - (5 * GEN - 1)
    assert json.loads(contract.get_pool(pool_id).recipients_json)[1] == {"address": FUND_B, "percent": 30, "label": "Wildlife care"}


def test_every_recipient_is_excluded_from_donor_say(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    recipients = json.dumps([{"address": "0x" + direct_bob.hex(), "percent": 60}, {"address": "0x" + direct_charlie.hex(), "percent": 40}])
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, recipients=recipients)
    _donate(direct_vm, contract, pool_id, direct_charlie, 50 * GEN)  # the second recipient buys "weight" before the claim
    _trigger(direct_vm, contract, pool_id, direct_bob)
    assert contract.claim_weight(pool_id, to_hex(direct_charlie)) == "0"
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only a donor who donated before this claim can approve its release"):
        contract.approve_release(pool_id)
    with direct_vm.expect_revert("Only a donor who donated before this claim can contest a payout"):
        contract.contest(pool_id)


def test_any_recipient_can_answer_a_refusal_once(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    recipients = json.dumps([{"address": "0x" + direct_bob.hex(), "percent": 60}, {"address": "0x" + direct_charlie.hex(), "percent": 40}])
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, recipients=recipients)
    _trigger(direct_vm, contract, pool_id, direct_bob, gdacs=_gdacs(mag=6.4), usgs=_usgs(mag=6.4))
    direct_vm.sender = direct_charlie  # the second recipient may contest
    assert contract.contest(pool_id) == "DOES_NOT_MEET"
    direct_vm.sender = direct_bob  # the recipients' side contests once, whichever wallet
    with direct_vm.expect_revert("The recipients have already contested this claim"):
        contract.contest(pool_id)
    direct_vm.sender = direct_charlie
    assert contract.resolve(pool_id) == "dismissed"  # and any recipient may dismiss early


@pytest.mark.parametrize("setup, code, phrase", [
    ({}, "met", "EQ 1474477: GDACS RED alert in MMR, starting 2025-03-28, M7.7 (threshold M7), USGS M7.7 agrees. Every coded term is met."),
    ({"gdacs": _gdacs(mag=6.4), "usgs": _usgs(mag=6.4)}, "severity", "The pool's magnitude threshold is M7."),
    ({"gdacs": _gdacs(shakepop="900000")}, "exposure", "900,000 people were exposed to strong shaking; the pool needs 1,000,000."),
    ({"usgs": _usgs(mag=6.9)}, "sources_disagree", "GDACS reports M7.7 but USGS reports M6.9"),
    ({"gdacs_status": 404}, "gdacs_unreachable", "GDACS could not be read for EQ 1474477"),
])
def test_every_ruling_explains_itself(direct_vm, direct_deploy, direct_alice, direct_bob, setup, code, phrase):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_bob, **setup)
    pool = contract.get_pool(pool_id)
    assert pool.claim_code == code and phrase in pool.claim_why


def test_area_ruling_explains_the_model_answer(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, area_terms="Rakhine State")
    _trigger(direct_vm, contract, pool_id, direct_bob, verdict="DOES_NOT_MEET")
    why = contract.get_pool(pool_id).claim_why
    assert why.endswith("Every coded term is met; validators judged that the event did not strike the area the donors described.")
    _setup(direct_vm, verdict="DOES_NOT_MEET")
    direct_vm.sender = direct_bob
    contract.resolve(pool_id)
    assert contract.get_history(pool_id)[-1]["why"] == why[:300]
