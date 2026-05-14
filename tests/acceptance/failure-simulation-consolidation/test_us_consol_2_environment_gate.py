"""US-CONSOL-2 — Environment-tiered gate replaces single-boolean switch.

Olivia (operator) cannot accidentally enable the failure-simulation surface
in staging or production by flipping a single env var. The gate AND-composes
``ENVIRONMENT in {dev, ci}`` with ``FAILURE_SIMULATION_ENABLED=true`` (ADR-035).
The deprecated ``NWAVE_HARNESS_KNOBS`` remains readable for one release.

Scenarios in this file (Group A — directly exercise the registry's API):

  Scenario 1 — Production deployments reject every knob invocation
  Scenario 2 — Staging deployments reject every knob invocation by default
  Scenario 3 — Dev and CI environments permit knob invocation
  Scenario 4 — Unset ENVIRONMENT defaults to production-restrictive
  Scenario 5 — Inspection-probe endpoints are absent (404), not denied (403)
  Scenario 6 — Gate verdict is logged exactly once at startup
  Scenario 7 — Production behavior is independent of deprecated flag values

Public API exercised: ``probe``, ``shouldInject``, ``registerInspectionRoutes``.

All tests RED until DELIVER MR-2 lands the gate + composition root.
"""

from __future__ import annotations

import pytest

from driver import FailureSimulationDriver

pytestmark = [
    pytest.mark.group_a,
    pytest.mark.us_consol_2,
    pytest.mark.mr_2,
]


# ─────────────────────────── Scenario 1 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.real_io
def test_production_rejects_every_knob_invocation_even_with_legacy_flag_set(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """With ``ENVIRONMENT=production`` AND ``NWAVE_HARNESS_KNOBS=true`` (the
    worst-case misconfiguration), every knob fires no-op and the registry
    emits ``failure-simulation.rejected`` with reason ``environment_tier_denies``.

    Per US-CONSOL-2 Scenario 1.
    """
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const headers = new Headers();\n"
        "headers.set('X-Force-Create-Session-Failure', 'transient');\n"
        "const result = shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers, serviceName: 'ui-state', correlationId: 'req-prod-001',\n"
        "});\n"
        "process.stdout.write(JSON.stringify({__verdict: {fired: result}}) + '\\n');\n"
    )
    run = driver.run_registry_script(
        script,
        env={
            "ENVIRONMENT": "production",
            "NWAVE_HARNESS_KNOBS": "true",
        },
    )
    fired_events = [
        e for e in run.events if e.get("event.name") == "failure-simulation.fired"
    ]
    rejected_events = [
        e for e in run.events if e.get("event.name") == "failure-simulation.rejected"
    ]
    assert fired_events == [], (
        f"production must not fire any knob, got {fired_events}"
    )
    assert len(rejected_events) == 1
    assert rejected_events[0].get("reason") == "environment_tier_denies"
    fired_payload = next((e for e in run.events if "__verdict" in e), None)
    assert fired_payload and fired_payload["__verdict"]["fired"] is False


# ─────────────────────────── Scenario 2 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.real_io
def test_staging_rejects_every_knob_invocation_by_default(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """With ``ENVIRONMENT=staging`` and no defense-in-depth flag set, knobs
    fire no-op and the gate decision is logged as
    ``failure-simulation.gate.disabled`` at startup.

    Per US-CONSOL-2 Scenario 2.
    """
    run = driver.probe_in_subprocess(environment="staging")
    gate_events = [
        e for e in run.events
        if e.get("event.name") == "failure-simulation.gate.disabled"
    ]
    assert len(gate_events) == 1, (
        f"expected one gate.disabled startup event, got: {run.events}"
    )
    assert gate_events[0].get("gate.tier") == "staging"


# ─────────────────────────── Scenario 3 ───────────────────────────


@pytest.mark.happy_path
@pytest.mark.real_io
@pytest.mark.parametrize("environment_tier", ["dev", "ci"])
def test_dev_and_ci_environments_permit_knob_invocation(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
    environment_tier: str,
) -> None:
    """With ``ENVIRONMENT in {dev, ci}`` AND ``FAILURE_SIMULATION_ENABLED=true``,
    a request carrying a manifest-registered knob fires the knob and a
    ``failure-simulation.fired`` audit entry is emitted.

    Per US-CONSOL-2 Scenario 3.
    """
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const headers = new Headers();\n"
        "headers.set('X-Force-Create-Session-Failure', 'transient');\n"
        "const result = shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers, serviceName: 'ui-state', correlationId: 'req-permit-001',\n"
        "});\n"
        "process.stdout.write(JSON.stringify({__verdict: {fired: result}}) + '\\n');\n"
    )
    run = driver.run_registry_script(
        script,
        env={
            "ENVIRONMENT": environment_tier,
            "FAILURE_SIMULATION_ENABLED": "true",
        },
    )
    fired_events = [
        e for e in run.events if e.get("event.name") == "failure-simulation.fired"
    ]
    assert len(fired_events) == 1, f"expected one fired event, got: {run.events}"
    fired_payload = next((e for e in run.events if "__verdict" in e), None)
    assert fired_payload and fired_payload["__verdict"]["fired"] is True


# ─────────────────────────── Scenario 4 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.real_io
def test_unset_environment_defaults_to_production_restrictive_gate(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """When no ``ENVIRONMENT`` value is set, the gate defaults to the most
    restrictive tier and emits a startup warning that
    ``ENVIRONMENT unset — defaulting to production-restrictive gate``.

    Per US-CONSOL-2 Scenario 4.
    """
    run = driver.probe_in_subprocess(environment=None)
    gate_disabled = [
        e for e in run.events
        if e.get("event.name") == "failure-simulation.gate.disabled"
    ]
    assert len(gate_disabled) == 1
    verdict = gate_disabled[0]
    assert verdict.get("gate.tier") == "unset"
    assert verdict.get("gate.reason") == "environment_tier_denies"


# ─────────────────────────── Scenario 5 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.needs_compose_stack
@pytest.mark.real_io
@pytest.mark.parametrize(
    "debug_path",
    [
        "/debug/last-request-scope",
        "/debug/request-log",
    ],
)
def test_inspection_probe_endpoints_are_absent_outside_dev_or_ci(
    requires_compose_stack: None,
    driver: FailureSimulationDriver,
    debug_path: str,
) -> None:
    """When the agent is started under ``ENVIRONMENT=staging`` or
    ``ENVIRONMENT=production``, the ``/debug/*`` inspection-probe routes are
    not registered at all — requests return 404 (route absent), not 403
    (route present but denied).

    This scenario requires the compose stack to be running with a
    staging-equivalent environment. The driver checks the response shape;
    DELIVER's MR-2 wires the conditional registration.

    Per US-CONSOL-2 Scenario 5 and CA-7.
    """
    probe = driver.get(debug_path, base=driver.agent_url)
    # The contract is: 404 (route absent), not 403 (route present but denied).
    assert probe.status == 404, (
        f"expected 404 (route absent) at {debug_path} when gate is disabled; "
        f"got {probe.status}. A 403 indicates the route is registered then "
        f"denied — the contract is conditional registration, not denial."
    )


# ─────────────────────────── Scenario 6 ───────────────────────────


@pytest.mark.happy_path
@pytest.mark.real_io
def test_gate_verdict_is_logged_exactly_once_at_startup(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """`probe()` is called once at the composition root. A second call (e.g.
    in tests) would emit a second event; production code calls it once. The
    test asserts the single-emission contract for one process.

    Per US-CONSOL-2 Scenario 6 and CA-3.
    """
    run = driver.probe_in_subprocess(
        environment="dev", failure_simulation_enabled="true"
    )
    gate_events = [
        e
        for e in run.events
        if e.get("event.name", "").startswith("failure-simulation.gate.")
    ]
    assert len(gate_events) == 1, (
        f"expected exactly one gate event per process, got {len(gate_events)}: "
        f"{gate_events}"
    )
    assert gate_events[0]["event.name"] == "failure-simulation.gate.enabled"


# ─────────────────────────── Scenario 7 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.real_io
@pytest.mark.parametrize("legacy_value", ["true", "false", None])
@pytest.mark.parametrize("primary_value", ["true", "false"])
def test_production_behavior_is_independent_of_legacy_flag_value(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
    legacy_value: str | None,
    primary_value: str,
) -> None:
    """With ``ENVIRONMENT=production``, the verdict is ``disabled`` and the
    reason is ``environment_tier_denies`` regardless of either flag's value.

    Per US-CONSOL-2 Scenario 7 and CA-9 — the production-safety matrix.
    """
    run = driver.probe_in_subprocess(
        environment="production",
        failure_simulation_enabled=primary_value,
        nwave_harness_knobs=legacy_value,
    )
    gate_events = [
        e
        for e in run.events
        if e.get("event.name", "").startswith("failure-simulation.gate.")
    ]
    assert len(gate_events) == 1
    verdict = gate_events[0]
    assert verdict["event.name"] == "failure-simulation.gate.disabled"
    assert verdict.get("gate.reason") == "environment_tier_denies"
    assert verdict.get("gate.tier") == "production"
