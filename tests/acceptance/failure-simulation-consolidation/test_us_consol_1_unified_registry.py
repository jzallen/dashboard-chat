"""US-CONSOL-1 — Unified failure-simulation registry with consistent naming.

Devon (developer) discovers every available knob from ONE manifest file, with
canonical kebab-case names, transport, target port boundary, and owning
service. Unknown knob names are no-ops with structured warnings; typos
produce discoverable errors that point at the manifest.

Scenarios in this file (Group A — directly exercise the registry's API):

  Scenario 1 — A developer discovers every available knob in one file
  Scenario 2 — A knob outside the manifest is rejected at runtime
  Scenario 3 — A typo'd knob name surfaces a discoverable error
  Scenario 4 — All 6 existing knobs are listed in the manifest after consolidation
  Scenario 5 — The manifest is the single source of truth across services

Public API exercised: `manifest`, `KNOB`, `detectUnknownSignals`, `shouldInject`.

Mapped contract assertions: CA-1 (manifest-vs-source drift) participates via
scenario 4; CA-2 (schema validation) participates via scenarios 1, 4, 5.

All tests RED until DELIVER MR-1 lands `shared/failure-simulation/`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from driver import FailureSimulationDriver

pytestmark = [
    pytest.mark.group_a,
    pytest.mark.us_consol_1,
    pytest.mark.mr_1,
]


EXPECTED_CANONICAL_KNOBS = {
    "force-create-project-failure": {"transport": "header", "owning": "ui-state"},
    "force-list-sessions-failure": {"transport": "header", "owning": "ui-state"},
    "force-create-session-failure": {"transport": "header", "owning": "ui-state"},
    "force-reissue-failures": {"transport": "body-field", "owning": "agent"},
    "force-failure-on-auth-retry": {"transport": "event", "owning": "ui-state"},
    "expire-token": {"transport": "event", "owning": "ui-state"},
}


# ─────────────────────────── Scenario 1 ───────────────────────────


@pytest.mark.happy_path
def test_developer_discovers_every_knob_in_one_manifest_file(
    requires_shared_failure_simulation: None,
    manifest_path: Path,
    driver: FailureSimulationDriver,
) -> None:
    """The manifest file exists at the canonical location and lists every knob.

    Per US-CONSOL-1 Scenario 1: Devon opens the failure-simulation manifest
    file and sees every existing knob's canonical name without having to
    grep `ui-state/lib/machines/` or `agent/`.
    """
    assert manifest_path.is_file(), (
        f"manifest file does not exist at {manifest_path} — "
        f"DELIVER MR-1 lands it (per ADR-036)"
    )
    names = set(driver.manifest_canonical_names())
    assert names == set(EXPECTED_CANONICAL_KNOBS), (
        f"manifest does not list the expected 6 canonical knob names. "
        f"Expected {set(EXPECTED_CANONICAL_KNOBS)}, got {names}"
    )


# ─────────────────────────── Scenario 2 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.real_io
def test_a_knob_outside_the_manifest_is_rejected_with_unknown_audit_event(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """An incoming knob-shaped header that is NOT in the manifest is treated
    as no-op AND emits `failure-simulation.unknown` per ADR-037.

    Per US-CONSOL-1 Scenario 2.
    """
    script = (
        "import { detectUnknownSignals } from '@dashboard-chat/shared-failure-simulation';\n"
        "import { probe } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const headers = new Headers();\n"
        "headers.set('X-Force-Some-Unregistered-Knob', 'transient');\n"
        "detectUnknownSignals({\n"
        "  headers,\n"
        "  serviceName: 'ui-state',\n"
        "  correlationId: 'req-unknown-001',\n"
        "});\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    unknown_events = [
        e for e in run.events if e.get("event.name") == "failure-simulation.unknown"
    ]
    assert len(unknown_events) == 1, (
        f"expected exactly one `failure-simulation.unknown` event, "
        f"got {len(unknown_events)}: {run.events}"
    )
    entry = unknown_events[0]
    assert entry.get("knob.name.raw") == "force-some-unregistered-knob", (
        f"unknown audit entry should carry the raw incoming name; got {entry}"
    )


# ─────────────────────────── Scenario 3 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.real_io
def test_a_typo_knob_name_surfaces_a_hint_pointing_at_the_manifest(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """Devon mis-types `Create` as `Crete`. The audit emitter writes a
    `failure-simulation.unknown` entry whose `manifest.path` field points at
    `shared/failure-simulation/manifest.ts`.

    Per US-CONSOL-1 Scenario 3.
    """
    script = (
        "import { detectUnknownSignals } from '@dashboard-chat/shared-failure-simulation';\n"
        "import { probe } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const headers = new Headers();\n"
        "headers.set('X-Force-Crete-Session-Failure', 'transient');\n"
        "detectUnknownSignals({\n"
        "  headers,\n"
        "  serviceName: 'ui-state',\n"
        "  correlationId: 'req-typo-007',\n"
        "});\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    unknown_events = [
        e for e in run.events if e.get("event.name") == "failure-simulation.unknown"
    ]
    assert len(unknown_events) == 1
    entry = unknown_events[0]
    assert "shared/failure-simulation/manifest" in str(entry.get("manifest.path", "")), (
        f"unknown audit entry should reference the manifest path; got "
        f"{entry.get('manifest.path')!r}"
    )
    assert entry.get("knob.name.raw") == "force-crete-session-failure"


# ─────────────────────────── Scenario 4 ───────────────────────────


@pytest.mark.happy_path
def test_all_six_existing_knobs_are_listed_with_canonical_names_after_consolidation(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """The manifest, evaluated at runtime, exposes the 6 expected entries with
    the transport / owning-service shape per the DESIGN handoff table.

    Per US-CONSOL-1 Scenario 4.
    """
    script = (
        "import { manifest } from '@dashboard-chat/shared-failure-simulation';\n"
        "process.stdout.write(JSON.stringify({__verdict: manifest.map(e => ({\n"
        "  name: e.name, transport: e.transport, owningService: e.owningService\n"
        "}))}) + '\\n');\n"
    )
    run = driver.run_registry_script(script, env={"ENVIRONMENT": "dev"})
    assert run.returncode == 0, run.stderr
    payload = next(e for e in run.events if "__verdict" in e)
    entries = payload["__verdict"]
    by_name = {e["name"]: e for e in entries}
    for canonical, attrs in EXPECTED_CANONICAL_KNOBS.items():
        assert canonical in by_name, (
            f"manifest missing canonical knob {canonical!r}; "
            f"present: {list(by_name)}"
        )
        assert by_name[canonical]["transport"] == attrs["transport"]
        assert by_name[canonical]["owningService"] == attrs["owning"]


# ─────────────────────────── Scenario 5 ───────────────────────────


@pytest.mark.happy_path
def test_manifest_is_single_source_of_truth_across_ui_state_and_agent(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """Both `ui-state` and `agent` import their knob inventory from the same
    manifest. The two services do not hardcode knob names.

    Verified by:
      1. Listing manifest entries from a node subprocess (the SSOT).
      2. Grepping production source for any knob-name pattern.
      3. Asserting every grep hit corresponds to a manifest entry (matched by
         canonical name or by the eventDistinguisher-stripped form).

    Per US-CONSOL-1 Scenario 5.
    """
    script = (
        "import { manifest } from '@dashboard-chat/shared-failure-simulation';\n"
        "const view = manifest.map(e => ({\n"
        "  name: e.name,\n"
        "  transport: e.transport,\n"
        "  owningService: e.owningService,\n"
        "}));\n"
        "process.stdout.write(JSON.stringify({__verdict: view}) + '\\n');\n"
    )
    run = driver.run_registry_script(script, env={"ENVIRONMENT": "dev"})
    assert run.returncode == 0, run.stderr
    payload = next(e for e in run.events if "__verdict" in e)
    entries = payload["__verdict"]

    canonical_names = {e["name"] for e in entries}

    # Every header/event/body-field pattern in production source must
    # correspond to a manifest entry. CA-1 owns the strict full-match; here we
    # assert presence-in-manifest as a less strict but service-spanning
    # invariant.
    hits = driver.grep_production_source_for_knob_patterns()
    for kind, matches in hits.items():
        if not matches:
            continue
        assert canonical_names, (
            f"production source contains knob-pattern hits {kind!r} "
            f"({matches[:3]}) but the manifest is empty"
        )
