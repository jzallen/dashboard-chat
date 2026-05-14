"""US-CONSOL-5 — Knob-sprawl friction: adding a 7th knob requires manifest registration.

Mechanism: a knob referenced in production code without a manifest entry is
treated as ``unknown`` at runtime AND fails a CI lint check. Manifest entries
require non-empty ``rationale`` and explicit
``contractTestAlternativeConsidered``.

Scenarios in this file (Group A — directly exercise the registry's API):

  Scenario 1 — A knob without a manifest entry fails CI
  Scenario 2 — A manifest entry requires a non-empty rationale
  Scenario 3 — A manifest entry requires explicit contract-test consideration
  Scenario 4 — A 7th knob lands as a normal MR with manifest, wiring, and scenario

Public API exercised: ``assertKnown``, manifest schema (Zod).

Mapped contract assertions: CA-1 (drift check), CA-2 (schema validation).

All tests RED until DELIVER MR-1 lands `assertKnown` and the schema.
"""

from __future__ import annotations

import json

import pytest

from driver import FailureSimulationDriver

pytestmark = [
    pytest.mark.group_a,
    pytest.mark.us_consol_5,
    pytest.mark.mr_1,
]


# ─────────────────────────── Scenario 1 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.real_io
def test_assert_known_rejects_a_knob_not_listed_in_the_manifest(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """``assertKnown(name)`` is the CI-lint helper that the drift check
    calls per matched knob-name pattern in production source. A name not in
    the manifest causes ``assertKnown`` to throw, which fails the CI check.

    Per US-CONSOL-5 Scenario 1 and CA-1.
    """
    script = (
        "import { assertKnown } from '@dashboard-chat/shared-failure-simulation';\n"
        "try {\n"
        "  assertKnown('force-list-projects-failure');\n"
        "  process.stdout.write(JSON.stringify({__verdict: {threw: false}}) + '\\n');\n"
        "} catch (err) {\n"
        "  process.stdout.write(JSON.stringify({__verdict: {threw: true, message: err.message}}) + '\\n');\n"
        "}\n"
    )
    run = driver.run_registry_script(script, env={"ENVIRONMENT": "dev"})
    payload = next((e for e in run.events if "__verdict" in e), None)
    assert payload is not None, run.stderr
    assert payload["__verdict"]["threw"] is True, (
        f"assertKnown should throw for an unregistered name; got {payload}"
    )


# ─────────────────────────── Scenario 2 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.real_io
def test_manifest_entry_with_empty_rationale_fails_schema_validation(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """A manifest entry with ``rationale: ""`` is rejected by the Zod
    schema at module load. The error message points at the empty field.

    Per US-CONSOL-5 Scenario 2 and CA-2.
    """
    bad_entry = {
        "name": "force-fictional-failure",
        "transport": "header",
        "target": "fictional",
        "owningService": "ui-state",
        "gate": {"dev": "permit", "ci": "permit", "staging": "deny", "production": "deny"},
        "rationale": "",
        "contractTestAlternativeConsidered": False,
    }
    script = (
        "import { ManifestEntrySchema } from '@dashboard-chat/shared-failure-simulation';\n"
        f"const candidate = {json.dumps(bad_entry)};\n"
        "const result = ManifestEntrySchema.safeParse(candidate);\n"
        "process.stdout.write(JSON.stringify({__verdict: {\n"
        "  success: result.success,\n"
        "  issuePaths: result.success ? [] : result.error.issues.map(i => i.path.join('.'))\n"
        "}}) + '\\n');\n"
    )
    run = driver.run_registry_script(script, env={"ENVIRONMENT": "dev"})
    payload = next((e for e in run.events if "__verdict" in e), None)
    assert payload is not None, run.stderr
    assert payload["__verdict"]["success"] is False
    assert "rationale" in payload["__verdict"]["issuePaths"], (
        f"schema must flag the empty rationale field; "
        f"got issuePaths={payload['__verdict']['issuePaths']}"
    )


# ─────────────────────────── Scenario 3 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.real_io
def test_manifest_entry_without_contract_test_consideration_fails_validation(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """A manifest entry that omits ``contractTestAlternativeConsidered`` is
    rejected. The field has no default — Devon must explicitly choose true
    or false.

    Per US-CONSOL-5 Scenario 3 and CA-2.
    """
    bad_entry = {
        "name": "force-fictional-failure",
        "transport": "header",
        "target": "fictional",
        "owningService": "ui-state",
        "gate": {"dev": "permit", "ci": "permit", "staging": "deny", "production": "deny"},
        "rationale": "fictional rationale for the scenario",
        # contractTestAlternativeConsidered intentionally omitted
    }
    script = (
        "import { ManifestEntrySchema } from '@dashboard-chat/shared-failure-simulation';\n"
        f"const candidate = {json.dumps(bad_entry)};\n"
        "const result = ManifestEntrySchema.safeParse(candidate);\n"
        "process.stdout.write(JSON.stringify({__verdict: {\n"
        "  success: result.success,\n"
        "  issuePaths: result.success ? [] : result.error.issues.map(i => i.path.join('.'))\n"
        "}}) + '\\n');\n"
    )
    run = driver.run_registry_script(script, env={"ENVIRONMENT": "dev"})
    payload = next((e for e in run.events if "__verdict" in e), None)
    assert payload is not None, run.stderr
    assert payload["__verdict"]["success"] is False
    assert "contractTestAlternativeConsidered" in payload["__verdict"]["issuePaths"]


# ─────────────────────────── Scenario 4 ───────────────────────────


@pytest.mark.happy_path
@pytest.mark.real_io
def test_a_seventh_knob_lands_as_a_normal_mr_with_manifest_wiring_and_scenario(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """A 7th knob ``force-list-projects-failure`` (hypothetical US-209) lands
    via three artifacts:

      1. A manifest entry with a non-empty rationale and an explicit
         ``contractTestAlternativeConsidered`` value.
      2. A production-side ``shouldInject`` call at the new port boundary.
      3. An acceptance scenario in the existing suite that exercises it.

    This test asserts that a fully-formed candidate entry passes schema
    validation — the schema is the "normal MR" smoke test.

    Per US-CONSOL-5 Scenario 4.
    """
    good_entry = {
        "name": "force-list-projects-failure",
        "transport": "header",
        "target": "listProjects",
        "owningService": "ui-state",
        "gate": {"dev": "permit", "ci": "permit", "staging": "deny", "production": "deny"},
        "rationale": (
            "US-209 (hypothetical) requires a deterministic 5xx on list-projects "
            "to validate the empty-state fallback under partial-failure."
        ),
        "contractTestAlternativeConsidered": False,
    }
    script = (
        "import { ManifestEntrySchema } from '@dashboard-chat/shared-failure-simulation';\n"
        f"const candidate = {json.dumps(good_entry)};\n"
        "const result = ManifestEntrySchema.safeParse(candidate);\n"
        "process.stdout.write(JSON.stringify({__verdict: {\n"
        "  success: result.success,\n"
        "  issues: result.success ? [] : result.error.issues\n"
        "}}) + '\\n');\n"
    )
    run = driver.run_registry_script(script, env={"ENVIRONMENT": "dev"})
    payload = next((e for e in run.events if "__verdict" in e), None)
    assert payload is not None, run.stderr
    assert payload["__verdict"]["success"] is True, (
        f"well-formed manifest entry should pass schema validation; "
        f"got issues={payload['__verdict'].get('issues')}"
    )
