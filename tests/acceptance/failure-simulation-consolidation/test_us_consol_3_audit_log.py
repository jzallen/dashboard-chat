"""US-CONSOL-3 — Structured audit log of every failure-simulation invocation.

Devon (debugging a flaky scenario) and on-call (investigating a suspected
misfire) need a structured audit trail: ONE log entry per knob invocation,
with canonical name, transport, environment tier, verdict, correlation id,
and timestamp. ADR-037 fixes the JSON-line schema and the per-event payload.

Scenarios in this file (Group A — directly exercise the registry's API):

  Scenario 1 — A fired knob emits exactly one structured audit entry
  Scenario 2 — A rejected knob emits a distinct audit entry
  Scenario 3 — An unknown knob emits a warning audit entry
  Scenario 4 — Audit entries are absent for normal requests
  Scenario 5 — Audit entries cross the actor / worker boundary (correlation id)

Public API exercised: ``probe``, ``shouldInject``, ``detectUnknownSignals``,
audit emitter via stdout.

Mapped contract assertions: CA-5 (JSON conformance), CA-6 (correlation id
propagation across actor boundary).

All tests RED until DELIVER MR-3 lands the audit emitter.
"""

from __future__ import annotations

import pytest

from driver import FailureSimulationDriver

pytestmark = [
    pytest.mark.group_a,
    pytest.mark.us_consol_3,
    pytest.mark.mr_3,
    pytest.mark.real_io,
]


REQUIRED_ENVELOPE_FIELDS = {
    "event.name",
    "service.name",
    "timestamp",
    "environment.tier",
}


# ─────────────────────────── Scenario 1 ───────────────────────────


@pytest.mark.happy_path
def test_a_fired_knob_emits_exactly_one_structured_audit_entry(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """When the gate is enabled and a manifest-registered knob fires, exactly
    one JSON-line audit entry is emitted with name ``failure-simulation.fired``,
    carrying the canonical name, transport, environment tier, correlation id,
    and timestamp per ADR-037 envelope + per-event schema.

    Per US-CONSOL-3 Scenario 1 and CA-5.
    """
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const headers = new Headers();\n"
        "headers.set('X-Force-Create-Session-Failure', 'transient');\n"
        "shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers, serviceName: 'ui-state', correlationId: 'req-fired-001',\n"
        "});\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    fired = [e for e in run.events if e.get("event.name") == "failure-simulation.fired"]
    assert len(fired) == 1, f"expected one fired event, got: {run.events}"
    entry = fired[0]
    # Envelope fields.
    missing = REQUIRED_ENVELOPE_FIELDS - set(entry)
    assert not missing, f"envelope missing fields: {missing}"
    # Per-event payload.
    assert entry["knob.name"] == "force-create-session-failure"
    assert entry["knob.transport"] == "header"
    assert entry["target.port"] == "createSession"
    assert entry["owning.service"] == "ui-state"
    assert entry["correlation_id"] == "req-fired-001"


# ─────────────────────────── Scenario 2 ───────────────────────────


@pytest.mark.error_path
def test_a_rejected_knob_emits_a_distinct_audit_entry(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """When the gate is disabled (staging) and a request carries a knob
    header, the registry emits ``failure-simulation.rejected`` with the
    rejection reason and the gate tier.

    Per US-CONSOL-3 Scenario 2 and CA-5.
    """
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const headers = new Headers();\n"
        "headers.set('X-Force-Create-Session-Failure', 'transient');\n"
        "shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers, serviceName: 'ui-state', correlationId: 'req-rej-001',\n"
        "});\n"
    )
    run = driver.run_registry_script(script, env={"ENVIRONMENT": "staging"})
    rejected = [
        e for e in run.events if e.get("event.name") == "failure-simulation.rejected"
    ]
    assert len(rejected) == 1, f"expected one rejected event, got: {run.events}"
    entry = rejected[0]
    assert entry["knob.name"] == "force-create-session-failure"
    assert entry["reason"] == "environment_tier_denies"
    assert entry["gate.tier"] == "staging"


# ─────────────────────────── Scenario 3 ───────────────────────────


@pytest.mark.error_path
def test_an_unknown_knob_emits_a_warning_audit_entry_with_manifest_pointer(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """When the gate is enabled but the inbound knob name is not in the
    manifest, ``failure-simulation.unknown`` is emitted with the raw
    incoming name and a pointer to ``shared/failure-simulation/manifest.ts``.

    Per US-CONSOL-3 Scenario 3 and CA-5.
    """
    script = (
        "import { probe, detectUnknownSignals } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const headers = new Headers();\n"
        "headers.set('X-Force-Crete-Session-Failure', 'transient');\n"
        "detectUnknownSignals({\n"
        "  headers, serviceName: 'ui-state', correlationId: 'req-typo-013',\n"
        "});\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    unknown = [
        e for e in run.events if e.get("event.name") == "failure-simulation.unknown"
    ]
    assert len(unknown) == 1, f"expected one unknown event, got: {run.events}"
    entry = unknown[0]
    assert entry["knob.name.raw"] == "force-crete-session-failure"
    assert "shared/failure-simulation/manifest" in str(entry["manifest.path"])


# ─────────────────────────── Scenario 4 ───────────────────────────


@pytest.mark.happy_path
def test_audit_entries_are_absent_for_normal_requests(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """A normal request carrying no failure-simulation header, event, or body
    field produces ZERO ``failure-simulation.*`` audit entries (only the
    startup gate event from ``probe()``).

    Per US-CONSOL-3 Scenario 4 — audit is invocation-triggered, not
    request-triggered.
    """
    script = (
        "import { probe, shouldInject, KNOB, detectUnknownSignals } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const headers = new Headers();\n"
        "headers.set('Content-Type', 'application/json');\n"
        "shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers, serviceName: 'ui-state', correlationId: 'req-normal-001',\n"
        "});\n"
        "detectUnknownSignals({\n"
        "  headers, serviceName: 'ui-state', correlationId: 'req-normal-001',\n"
        "});\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    invocation_events = [
        e
        for e in run.events
        if e.get("event.name")
        in {
            "failure-simulation.fired",
            "failure-simulation.rejected",
            "failure-simulation.unknown",
        }
    ]
    assert invocation_events == [], (
        f"normal request must not emit invocation events; got "
        f"{invocation_events}"
    )


# ─────────────────────────── Scenario 5 ───────────────────────────


@pytest.mark.happy_path
def test_audit_entries_carry_correlation_id_across_actor_boundary(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """A knob fired from inside an XState actor (worker context) carries the
    originating HTTP request's correlation id in the audit envelope —
    provided the actor was spawned with ``input.correlationId`` per ADR-028.

    Per US-CONSOL-3 Scenario 5 and CA-6.
    """
    script = (
        "import { shouldInject, KNOB, probe } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "// Simulate an actor invocation: caller threads correlationId via\n"
        "// the actor's input parameter per ADR-028. The driver never reads\n"
        "// a global — the field is passed explicitly.\n"
        "const actorInput = {\n"
        "  correlationId: 'req-actor-9001',\n"
        "  requestHeaders: new Headers([['X-Force-Create-Session-Failure', 'transient']]),\n"
        "};\n"
        "shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers: actorInput.requestHeaders,\n"
        "  serviceName: 'ui-state',\n"
        "  correlationId: actorInput.correlationId,\n"
        "});\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    fired = [e for e in run.events if e.get("event.name") == "failure-simulation.fired"]
    assert len(fired) == 1
    assert fired[0]["correlation_id"] == "req-actor-9001"
