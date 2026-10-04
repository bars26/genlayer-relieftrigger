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


def _create(direct_vm, direct_deploy, creator, beneficiary, amount=10 * GEN, **terms):
    direct_vm.sender = creator
    contract = direct_deploy(CONTRACT_PATH)
    args = dict(
        name="Myanmar earthquake response",
        recipient=to_hex(beneficiary),
        hazards="EQ",
        countries="MMR",
        min_alert="Orange",
        min_severity="7",
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
        ({"min_severity": "-3"}, "min_severity must be a positive number"),
        ({"payout": 0}, "payout must be positive"),
        ({"payout": 11 * GEN}, "payout must be positive and no more than the initial funding"),
        ({"coverage_start": "2026-02-01", "coverage_end": "2026-01-01"}, "coverage_start must not be after"),
        ({"coverage_end": "2020-01-01", "coverage_start": "2019-01-01"}, "coverage_end is already in the past"),
        ({"recipient": "not-an-address"}, "recipient must be a wallet address"),
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
        ({"hazards": "TC"}, {}, "hazard"),
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


def test_only_one_pending_claim(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    with direct_vm.expect_revert("Only an open pool without a pending claim can be triggered"):
        contract.trigger(pool_id, "EQ", "1474477")


# --- resolving ------------------------------------------------------------------


def test_payout_waits_for_window_unless_a_donor_waives(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_charlie)
    for who in (direct_charlie, direct_bob):  # a stranger and the recipient cannot rush a payout
        direct_vm.sender = who
        with direct_vm.expect_revert("The contest window is still open"):
            contract.resolve(pool_id)
    direct_vm.sender = direct_alice  # a donor accepts the claim
    assert contract.resolve(pool_id) == "paid"
    pool = contract.get_pool(pool_id)
    assert pool.state == "open"
    assert int(pool.balance) == 6 * GEN and int(pool.total_paid) == 4 * GEN
    assert contract.was_paid(pool_id, "EQ", "1474477") is True
    assert contract.get_history(pool_id)[-1] == {**contract.get_history(pool_id)[-1], "event": "paid", "amount": str(4 * GEN)}


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
    with direct_vm.expect_revert("The contest window is still open"):
        contract.resolve(pool_id)
    direct_vm.sender = direct_bob
    assert contract.resolve(pool_id) == "dismissed"
    pool = contract.get_pool(pool_id)
    assert pool.state == "open" and int(pool.balance) == 10 * GEN


# --- contesting ---------------------------------------------------------------


def test_contest_reassesses_once(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob, area_terms="central Myanmar")
    assert _trigger(direct_vm, contract, pool_id, direct_charlie, verdict="UNCLEAR") == "UNCLEAR"
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only a donor or the recipient can contest"):
        contract.contest(pool_id)
    _setup(direct_vm, verdict="MEETS")
    direct_vm.sender = direct_bob  # the recipient asks for a second opinion
    assert contract.contest(pool_id) == "MEETS"
    with direct_vm.expect_revert("A claim can only be contested once"):
        contract.contest(pool_id)
    direct_vm.sender = direct_charlie  # after a contest anyone can resolve
    assert contract.resolve(pool_id) == "paid"


def test_contest_window_closes(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pool_id = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    _trigger(direct_vm, contract, pool_id, direct_bob)
    _expire_claim_window(contract, pool_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The contest window has closed"):
        contract.contest(pool_id)


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
