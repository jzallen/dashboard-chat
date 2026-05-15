"""Contract assertions CA-1..CA-9 from the DESIGN handoff.

These are higher-order invariants that the DESIGN wave committed to. The
27 BDD scenarios in `discuss/acceptance-criteria.md` are still authoritative
for per-story behavior; the contract assertions are the cross-cutting
invariants CI must enforce on every change.

Source: `docs/feature/failure-simulation-consolidation/design/handoff-design-to-distill.md`,
section "Contract assertions (CI-enforceable rules)".

  CA-1 — Manifest-vs-source drift
  CA-2 — Schema validation at module load
  CA-3 — Composition-root probe invariant
  CA-4 — Verdict cache stability per process
  CA-5 — Audit-event JSON conformance
  CA-6 — Correlation-id propagation across actor boundary
  CA-7 — Inspection-probe conditional registration
  CA-8 — Legacy variable honors via deprecation warning
  CA-9 — Production behavior independent of legacy flag value

Note: many of these have a per-story acceptance scenario that ALSO covers
them. This file holds the *invariant-level* tests — the ones that close
the loop on the design contract regardless of which story drove the change.

All tests RED until DELIVER lands the registry.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from driver import FailureSimulationDriver, SEMVER_REGEX

pytestmark = [
    pytest.mark.contract_assertion,
    pytest.mark.real_io,
]


# ─────────────────────────── CA-1 ───────────────────────────


@pytest.mark.mr_1
@pytest.mark.error_path
def test_ca_1_manifest_vs_source_drift_check_catches_unregistered_knob(
    requires_shared_failure_simulation: None,
    driver: FailureSimulationDriver,
) -> None:
    """Every knob-name pattern in production source under ``ui-state/`` and
    ``agent/`` corresponds to a manifest entry. The drift check would catch a
    knob added to source without manifest registration.

    A wire token matches a manifest entry via either:
      (a) the canonical name kebab→snake'd form, or
      (b) for entries carrying ``eventDistinguisher``, the canonical name with
          that suffix stripped, kebab→snake'd (ADR-038 §"Naming scheme").
    """
    canonical = set(driver.manifest_canonical_names())
    src = driver.read_manifest_source() if (
        driver.registry_dir / "manifest.ts"
    ).is_file() else ""
    # Canonical names whose entry carries `eventDistinguisher` render to
    # `__<canonical-without-the-suffix>__` per ADR-038. Extract the stripped
    # forms so they participate in the canonical match. The eventDistinguisher
    # field's value IS the suffix that gets stripped.
    distinguisher_entries = re.findall(
        r"name:\s*['\"]([a-z][a-z0-9-]*[a-z0-9])['\"][^}]*?eventDistinguisher:\s*['\"]([^'\"]+)['\"]",
        src,
        re.DOTALL,
    )
    distinguisher_stripped_canonicals = {
        name[: -(len(suffix) + 1)]  # strip "-<suffix>"
        for name, suffix in distinguisher_entries
        if name.endswith("-" + suffix)
    }

    grep_hits = driver.grep_production_source_for_knob_patterns()
    # Tail-of-line identifier extraction per transport kind.
    def _normalize_header(token: str) -> str:
        # X-Force-Create-Session-Failure -> force-create-session-failure
        return token[len("X-"):].lower() if token.startswith("X-") else token.lower()

    for kind, matches in grep_hits.items():
        for hit in matches:
            # Each hit has shape "ui-state/index.ts:217". Re-extract the
            # token at that line and normalize.
            file_part, _, _line_part = hit.partition(":")
            file_path = driver.repo_root / file_part
            if not file_path.exists():
                continue
            line_text = file_path.read_text(encoding="utf-8").splitlines()[
                int(_line_part) - 1
            ]
            if kind == "header":
                tokens = re.findall(r"X-Force-[A-Za-z][A-Za-z0-9-]*", line_text)
                for t in tokens:
                    normalized = _normalize_header(t)
                    assert (
                        normalized in canonical
                    ), (
                        f"header {t} at {hit} normalizes to {normalized}, "
                        f"which is not in the manifest: {canonical}"
                    )
            elif kind == "event":
                tokens = re.findall(r"__(?:force|expire)_[a-z][a-z0-9_]*__", line_text)
                for t in tokens:
                    stripped_kebab = t.strip("_").replace("_", "-")
                    assert (
                        # Canonical name kebab→snake-derived match.
                        stripped_kebab in canonical
                        # eventDistinguisher case (ADR-038 §"Naming scheme").
                        or stripped_kebab in distinguisher_stripped_canonicals
                    ), (
                        f"event {t} at {hit} not in manifest. "
                        f"canonical={canonical}, "
                        f"distinguisher_stripped={distinguisher_stripped_canonicals}"
                    )


# ─────────────────────────── CA-2 ───────────────────────────


@pytest.mark.mr_1
@pytest.mark.error_path
def test_ca_2_schema_validation_rejects_a_known_bad_entry(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """A known-bad entry (empty rationale OR omitted
    ``contractTestAlternativeConsidered``) is rejected; a known-good entry
    is accepted. This is the Zod schema's contract.
    """
    bad = {
        "name": "force-test-failure",
        "transport": "header",
        "target": "test",
        "owningService": "ui-state",
        "gate": {"dev": "permit", "ci": "permit", "staging": "deny", "production": "deny"},
        "rationale": "",
        "contractTestAlternativeConsidered": False,
    }
    good = dict(bad, rationale="test rationale referencing US-TEST")
    script = (
        "import { ManifestEntrySchema } from '@dashboard-chat/shared-failure-simulation';\n"
        f"const bad = {json.dumps(bad)};\n"
        f"const good = {json.dumps(good)};\n"
        "process.stdout.write(JSON.stringify({__verdict: {\n"
        "  badSuccess: ManifestEntrySchema.safeParse(bad).success,\n"
        "  goodSuccess: ManifestEntrySchema.safeParse(good).success,\n"
        "}}) + '\\n');\n"
    )
    run = driver.run_registry_script(script, env={"ENVIRONMENT": "dev"})
    payload = next((e for e in run.events if "__verdict" in e), None)
    assert payload is not None, run.stderr
    assert payload["__verdict"]["badSuccess"] is False
    assert payload["__verdict"]["goodSuccess"] is True


# ─────────────────────────── CA-3 ───────────────────────────


@pytest.mark.mr_2
@pytest.mark.happy_path
def test_ca_3_first_failure_simulation_event_is_a_gate_event(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """For a fresh process, the FIRST ``failure-simulation.*`` event on
    stdout is a gate event (enabled or disabled). The composition root
    calls ``probe()`` before any route or actor is bound.
    """
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "// First fired event from probe.\n"
        "probe(process.env, 'ui-state');\n"
        "const h = new Headers([['X-Force-Create-Session-Failure', 'transient']]);\n"
        "shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers: h, serviceName: 'ui-state', correlationId: 'req-ca3-001',\n"
        "});\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    fs_events = [
        e
        for e in run.events
        if isinstance(e.get("event.name"), str)
        and e["event.name"].startswith("failure-simulation.")
    ]
    assert fs_events, "expected at least one failure-simulation event"
    first_event_name = fs_events[0]["event.name"]
    assert first_event_name.startswith("failure-simulation.gate."), (
        f"first failure-simulation event must be a gate event; got "
        f"{first_event_name!r}"
    )


# ─────────────────────────── CA-4 ───────────────────────────


@pytest.mark.mr_2
@pytest.mark.boundary
def test_ca_4_verdict_cache_is_stable_within_one_process_lifetime(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """Mutating ``process.env`` AFTER ``probe()`` does not change subsequent
    ``shouldInject`` verdicts within the same process — the gate is
    evaluated once and cached.
    """
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const h = new Headers([['X-Force-Create-Session-Failure', 'transient']]);\n"
        "const firstResult = shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers: h, serviceName: 'ui-state', correlationId: 'req-ca4-001',\n"
        "});\n"
        "// Adversarial mutation of process.env mid-process.\n"
        "process.env.ENVIRONMENT = 'production';\n"
        "process.env.FAILURE_SIMULATION_ENABLED = 'false';\n"
        "const secondResult = shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers: h, serviceName: 'ui-state', correlationId: 'req-ca4-002',\n"
        "});\n"
        "process.stdout.write(JSON.stringify({__verdict: {\n"
        "  firstResult, secondResult,\n"
        "}}) + '\\n');\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    payload = next((e for e in run.events if "__verdict" in e), None)
    assert payload is not None, run.stderr
    assert payload["__verdict"]["firstResult"] is True
    assert payload["__verdict"]["secondResult"] is True, (
        "verdict cache must be stable; mid-process env mutation must not "
        "alter the cached verdict"
    )


# ─────────────────────────── CA-5 ───────────────────────────


@pytest.mark.mr_3
@pytest.mark.happy_path
def test_ca_5_every_audit_event_is_a_single_line_of_valid_json(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """Every audit event is one line of valid JSON on stdout and matches the
    ADR-037 envelope shape — every event has ``event.name``,
    ``service.name``, ``timestamp``, ``environment.tier``.
    """
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const h = new Headers([['X-Force-Create-Session-Failure', 'transient']]);\n"
        "shouldInject(KNOB.forceCreateSessionFailure, {\n"
        "  headers: h, serviceName: 'ui-state', correlationId: 'req-ca5-001',\n"
        "});\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    # Re-parse stdout line by line; every failure-simulation.* line must be
    # valid JSON in isolation, AND no audit event spans multiple lines.
    fs_lines = [
        line
        for line in run.stdout.splitlines()
        if '"failure-simulation.' in line
    ]
    assert fs_lines, "expected at least one failure-simulation.* JSON line"
    for line in fs_lines:
        parsed = json.loads(line)  # must not raise
        assert isinstance(parsed, dict)
        assert isinstance(parsed.get("event.name"), str)
        assert parsed["event.name"].startswith("failure-simulation.")
        assert "service.name" in parsed
        assert "timestamp" in parsed
        assert "environment.tier" in parsed


# ─────────────────────────── CA-6 ───────────────────────────


@pytest.mark.mr_3
@pytest.mark.happy_path
def test_ca_6_correlation_id_propagates_across_the_actor_boundary(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """A knob fired from inside an actor whose ``input`` carries a
    correlation id emits an audit event whose ``correlation_id`` field
    matches the originating value.
    """
    script = (
        "import { probe, shouldInject, KNOB } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const actorInput = { correlationId: 'req-ca6-9001',\n"
        "  requestHeaders: new Headers([['X-Force-Create-Session-Failure', 'transient']])\n"
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
    assert fired[0]["correlation_id"] == "req-ca6-9001"


# ─────────────────────────── CA-7 ───────────────────────────


@pytest.mark.mr_2
@pytest.mark.needs_compose_stack
@pytest.mark.error_path
@pytest.mark.parametrize(
    "debug_path",
    [
        "/debug/last-request-scope",
        "/debug/request-log",
        "/debug/request-log/clear",
    ],
)
def test_ca_7_inspection_probe_returns_404_not_403_when_gate_is_disabled(
    requires_compose_stack: None,
    driver: FailureSimulationDriver,
    debug_path: str,
) -> None:
    """The agent's ``/debug/*`` inspection-probe routes are NOT registered
    when the gate verdict is disabled. Probing them returns HTTP 404 (route
    absent), not HTTP 403 (route present but denied).

    Requires the compose stack to be running with a staging-equivalent
    environment for the agent service.
    """
    if debug_path.endswith("/clear"):
        probe = driver.post(debug_path, base=driver.agent_url, json_body={})
    else:
        probe = driver.get(debug_path, base=driver.agent_url)
    assert probe.status == 404, (
        f"expected 404 at {debug_path} when gate is disabled, got {probe.status}. "
        f"The contract is conditional registration (route absent), not denial."
    )


# ─────────────────────────── CA-8 ───────────────────────────


@pytest.mark.mr_5
@pytest.mark.boundary
def test_ca_8_legacy_variable_honored_with_deprecation_event(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """When only ``NWAVE_HARNESS_KNOBS=true`` is present (legacy) and
    ``FAILURE_SIMULATION_ENABLED`` is unset, the gate verdict is enabled
    (backwards-compatible) AND a single
    ``failure-simulation.config.deprecated`` event is emitted at startup.
    """
    run = driver.probe_in_subprocess(
        environment="dev",
        nwave_harness_knobs="true",
    )
    gate_enabled = [
        e for e in run.events if e.get("event.name") == "failure-simulation.gate.enabled"
    ]
    deprecation = [
        e for e in run.events if e.get("event.name") == "failure-simulation.config.deprecated"
    ]
    assert len(gate_enabled) == 1
    assert gate_enabled[0]["gate.flag"] == "true"
    assert len(deprecation) == 1
    entry = deprecation[0]
    assert entry["env.legacy"] == "NWAVE_HARNESS_KNOBS"
    assert entry["env.replacement"] == "FAILURE_SIMULATION_ENABLED"
    assert SEMVER_REGEX.match(entry.get("removal.target_release", ""))


# ─────────────────────────── CA-9 ───────────────────────────


@pytest.mark.mr_2
@pytest.mark.error_path
@pytest.mark.parametrize("legacy_value", ["true", "false", None])
@pytest.mark.parametrize("primary_value", ["true", "false", None])
def test_ca_9_production_verdict_is_disabled_regardless_of_flag_values(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
    legacy_value: str | None,
    primary_value: str | None,
) -> None:
    """The full 3x3 matrix: every combination of legacy and primary flag
    values under ``ENVIRONMENT=production`` produces the same verdict —
    ``disabled``, reason ``environment_tier_denies``.
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
    assert verdict["gate.reason"] == "environment_tier_denies"
