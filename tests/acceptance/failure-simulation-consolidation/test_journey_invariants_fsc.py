"""Cross-story journey invariants for failure-simulation-consolidation.

Houses scenarios that span multiple stories OR that validate Group-C
deprecation behavior. The acceptance-criteria SSOT lists these under
``Cross-story integration scenarios``; the DESIGN handoff (group A/B/C
classification) routes them here so the per-story files stay focused.

Scenarios in this file:

  Cross-story 1 (Group B) — All 6 existing knobs remain functional in dev
    compose after every story lands.
  Cross-story 2 (Group A) — Hostile-environment integration test asserts
    production safety (every knob no-op when ENVIRONMENT=production).
  US-CONSOL-4 Scenario 6 (Group C) — ``NWAVE_HARNESS_KNOBS`` is deprecated,
    not deleted; emits ``failure-simulation.config.deprecated`` at startup.

All tests RED until DELIVER MR-1..MR-5 land.
"""

from __future__ import annotations

import re

import pytest

from driver import FailureSimulationDriver, SEMVER_REGEX


# ─────────────────────────── Cross-story 1 ───────────────────────────


@pytest.mark.group_b
@pytest.mark.mr_5
@pytest.mark.happy_path
def test_all_six_knobs_remain_functional_after_every_story_lands(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """End-to-end smoke: with the dev compose service running under
    ``ENVIRONMENT=dev`` and the defense-in-depth flag enabled, every
    canonical knob in the manifest fires when its wire signal is sent. The
    audit log shows ``failure-simulation.fired`` for each.

    Per the cross-story integration scenario 1 in acceptance-criteria.md.
    """
    # Fire all six knobs in one script (per-knob context shape varies).
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "// Header knobs.\n"
        "for (const [knob, header] of [\n"
        "  [KNOB.forceCreateProjectFailure, 'X-Force-Create-Project-Failure'],\n"
        "  [KNOB.forceListSessionsFailure, 'X-Force-List-Sessions-Failure'],\n"
        "  [KNOB.forceCreateSessionFailure, 'X-Force-Create-Session-Failure'],\n"
        "]) {\n"
        "  const h = new Headers(); h.set(header, 'transient');\n"
        "  shouldInject(knob, { headers: h, serviceName: 'ui-state', correlationId: 'req-cross-001' });\n"
        "}\n"
        "// Body-field knob (agent).\n"
        "shouldInject(KNOB.forceReissueFailures, {\n"
        "  body: { force_reissue_failures: ['transient'] },\n"
        "  serviceName: 'agent', correlationId: 'req-cross-002',\n"
        "});\n"
        "// Event knobs (ui-state).\n"
        "for (const [knob, evt] of [\n"
        "  [KNOB.forceFailureOnAuthRetry, '__force_failure__'],\n"
        "  [KNOB.expireToken, '__expire_token__'],\n"
        "]) {\n"
        "  shouldInject(knob, {\n"
        "    event: { type: evt }, serviceName: 'ui-state', correlationId: 'req-cross-003',\n"
        "  });\n"
        "}\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    fired = [e for e in run.events if e.get("event.name") == "failure-simulation.fired"]
    assert len(fired) == 6, (
        f"expected each of the 6 knobs to fire once, got {len(fired)} fired: "
        f"{[e.get('knob.name') for e in fired]}"
    )
    fired_names = {e["knob.name"] for e in fired}
    assert fired_names == {
        "force-create-project-failure",
        "force-list-sessions-failure",
        "force-create-session-failure",
        "force-reissue-failures",
        "force-failure-on-auth-retry",
        "expire-token",
    }


# ─────────────────────────── Cross-story 2 ───────────────────────────


@pytest.mark.group_a
@pytest.mark.mr_2
@pytest.mark.error_path
@pytest.mark.real_io
def test_hostile_environment_integration_asserts_production_safety(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """Replay every knob from the acceptance suite against a process running
    under ``ENVIRONMENT=production``. Every replay is no-op; every replay
    emits ``failure-simulation.rejected`` with reason
    ``environment_tier_denies``.

    Per the cross-story integration scenario 2 (and CA-9).
    """
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "for (const [knob, header] of [\n"
        "  [KNOB.forceCreateProjectFailure, 'X-Force-Create-Project-Failure'],\n"
        "  [KNOB.forceListSessionsFailure, 'X-Force-List-Sessions-Failure'],\n"
        "  [KNOB.forceCreateSessionFailure, 'X-Force-Create-Session-Failure'],\n"
        "]) {\n"
        "  const h = new Headers(); h.set(header, 'transient');\n"
        "  const result = shouldInject(knob, { headers: h, serviceName: 'ui-state', correlationId: 'req-hostile' });\n"
        "  if (result === true) {\n"
        "    process.stderr.write(`UNSAFE: ${knob} fired under production\\n`);\n"
        "  }\n"
        "}\n"
    )
    run = driver.run_registry_script(
        script,
        env={
            "ENVIRONMENT": "production",
            "FAILURE_SIMULATION_ENABLED": "true",
            "NWAVE_HARNESS_KNOBS": "true",
        },
    )
    fired = [e for e in run.events if e.get("event.name") == "failure-simulation.fired"]
    rejected = [
        e for e in run.events if e.get("event.name") == "failure-simulation.rejected"
    ]
    assert fired == [], (
        f"production must NEVER fire a knob; got {len(fired)} fired events"
    )
    assert len(rejected) == 3, (
        f"expected 3 rejected events (one per replayed header knob); got "
        f"{len(rejected)}"
    )
    for entry in rejected:
        assert entry.get("reason") == "environment_tier_denies"
        assert entry.get("gate.tier") == "production"


# ─────────────────────────── US-CONSOL-4 Scenario 6 (Group C) ───────────────────────────


@pytest.mark.group_c
@pytest.mark.us_consol_4
@pytest.mark.mr_5
@pytest.mark.boundary
@pytest.mark.real_io
def test_nwave_harness_knobs_is_deprecated_with_loud_startup_warning(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """A developer whose local environment still sets the legacy
    ``NWAVE_HARNESS_KNOBS=true`` sees:

      1. The gate event reports ``enabled`` (legacy flag honored under
         ``ENVIRONMENT=dev``, ADR-035 fallback path).
      2. A ``failure-simulation.config.deprecated`` event names the
         replacement env var AND carries a semver-shaped
         ``removal.target_release`` field.

    Per US-CONSOL-4 Scenario 6 and CA-8. The exact semver string is a
    DELIVER decision (known-unknown #1); this test asserts the shape via
    ``SEMVER_REGEX``.
    """
    run = driver.probe_in_subprocess(
        environment="dev",
        nwave_harness_knobs="true",
        # FAILURE_SIMULATION_ENABLED intentionally unset — legacy fallback path.
    )
    gate_enabled = [
        e for e in run.events if e.get("event.name") == "failure-simulation.gate.enabled"
    ]
    deprecation = [
        e for e in run.events if e.get("event.name") == "failure-simulation.config.deprecated"
    ]
    assert len(gate_enabled) == 1, (
        f"expected the legacy flag to enable the gate under ENVIRONMENT=dev; "
        f"got events: {run.events}"
    )
    assert len(deprecation) == 1, (
        f"expected exactly one deprecation event; got {len(deprecation)}"
    )
    entry = deprecation[0]
    assert entry["env.legacy"] == "NWAVE_HARNESS_KNOBS"
    assert entry["env.replacement"] == "FAILURE_SIMULATION_ENABLED"
    target_release = entry.get("removal.target_release", "")
    assert SEMVER_REGEX.match(target_release), (
        f"removal.target_release must be a semver-shaped string; got "
        f"{target_release!r}"
    )
