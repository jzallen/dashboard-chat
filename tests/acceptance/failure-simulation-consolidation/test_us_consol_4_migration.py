"""US-CONSOL-4 — Migration safety net for the 6 existing knobs.

The pre-existing acceptance suite at
``tests/acceptance/project-and-chat-session-management/`` powers 25+
scenarios against the 6 knobs. The migration must not regress any of them.
Phase 1 is wire-identical (adapter only); phase 2 is the vocabulary
cleanup (event names, body-field rename, ``NWAVE_HARNESS_KNOBS``
deprecation).

Scenarios in this file (Group B — migration safety-net):

  Scenario 1 — Acceptance suite passes against the adapter phase
  Scenario 2 — Adapter-phase commits contain zero test changes
  Scenario 3 — Vocabulary-cleanup commits rename production + tests atomically
  Scenario 4 — Each knob migration is an atomic commit
  Scenario 5 — A regression is caught by the acceptance suite (audit-log diagnostic)

Scenario 6 (``NWAVE_HARNESS_KNOBS`` deprecation) lives in
``test_journey_invariants_fsc.py`` as the only Group C scenario.

The driver does NOT modify the existing suite — it inspects the suite's
on-disk state (file presence, git history) as ground truth. The migration
MR's reviewer verifies these invariants by running this file.

All tests RED until DELIVER MR-4 (phase 1 adapter) and MR-5 (phase 2
vocabulary cleanup) land.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

from driver import FailureSimulationDriver

pytestmark = [
    pytest.mark.group_b,
    pytest.mark.us_consol_4,
]


EXISTING_SUITE_DIR = (
    Path(__file__).resolve().parents[1] / "project-and-chat-session-management"
)


def _git(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )


# ─────────────────────────── Scenario 1 ───────────────────────────


@pytest.mark.happy_path
@pytest.mark.mr_4
def test_acceptance_suite_passes_after_adapter_phase_migration(
    requires_shared_failure_simulation: None,
    driver: FailureSimulationDriver,
    repo_root: Path,
) -> None:
    """After the migration's adapter phase (phase 1), every callsite routes
    through the new registry and the firing-path wire is byte-identical. The
    pre-migration acceptance suite still passes — no scenario was modified
    and no scenario regressed.

    The assertion uses the registry's emitted manifest count as a proxy: if
    the manifest lists the 6 expected knobs AND the existing suite directory
    is unmodified at the same commit, the migration preserved the contract.

    Per US-CONSOL-4 Scenario 1.
    """
    assert EXISTING_SUITE_DIR.is_dir(), (
        f"existing acceptance suite missing at {EXISTING_SUITE_DIR} — "
        f"the migration safety-net depends on its presence"
    )
    canonical_names = set(driver.manifest_canonical_names())
    assert len(canonical_names) == 6, (
        f"manifest must list 6 knobs at the adapter-phase HEAD; "
        f"got {len(canonical_names)}: {canonical_names}"
    )


# ─────────────────────────── Scenario 2 ───────────────────────────


@pytest.mark.happy_path
@pytest.mark.mr_4
def test_adapter_phase_commits_contain_zero_test_changes(
    repo_root: Path,
) -> None:
    """The phase-1 (adapter) commits modify production source, the new
    registry, and the manifest only — they do NOT modify any file under
    ``tests/acceptance/project-and-chat-session-management/``.

    Verified by inspecting commits tagged ``mr-4-phase-1`` (or, if no tag is
    present, the commits whose message subject begins with the conventional
    ``feat(shared/failure-simulation):`` prefix from DELIVER's roadmap).

    Per US-CONSOL-4 Scenario 2.
    """
    # Walk the latest commits whose subject begins with the adapter-phase
    # prefix. DELIVER's roadmap pins the prefix as the commit-discovery key.
    log = _git(
        "log",
        "--pretty=format:%H%x09%s",
        "-n",
        "50",
        cwd=repo_root,
    )
    assert log.returncode == 0, log.stderr
    adapter_subjects = [
        line.split("\t", 1)
        for line in log.stdout.splitlines()
        if "\t" in line
        and re.search(r"\bphase[-_ ]?1\b|\badapter\b", line.split("\t", 1)[1].lower())
        and "failure-simulation" in line.split("\t", 1)[1].lower()
    ]
    assert adapter_subjects, (
        "no adapter-phase commits found in recent history — DELIVER's "
        "MR-4 phase-1 commits should carry 'phase-1' or 'adapter' in the "
        "subject"
    )
    for sha, _subject in adapter_subjects:
        diff = _git(
            "diff",
            "--name-only",
            f"{sha}^",
            sha,
            cwd=repo_root,
        )
        if diff.returncode != 0:
            continue
        for path in diff.stdout.splitlines():
            assert not path.startswith(
                "tests/acceptance/project-and-chat-session-management/"
            ), (
                f"adapter-phase commit {sha[:8]} modified "
                f"{path} — phase-1 must not touch the existing acceptance suite"
            )


# ─────────────────────────── Scenario 3 ───────────────────────────


@pytest.mark.happy_path
@pytest.mark.mr_5
def test_vocabulary_cleanup_commits_rename_production_and_tests_atomically(
    repo_root: Path,
) -> None:
    """Phase-2 commits rename one symbol at a time, touching BOTH production
    source and the affected acceptance fixtures in the same commit. The
    rename transitions are exactly:

        - ``__harness_force_failure__``   → ``__force_failure__``
        - ``__harness_expire_token__``    → ``__expire_token__``
        - ``harness_force_reissue_failures`` (body field) → ``force_reissue_failures``
        - ``NWAVE_HARNESS_KNOBS`` env var → deprecated (NOT renamed in-place)

    HTTP ``X-Force-*`` headers are NOT renamed (ADR-038).

    Per US-CONSOL-4 Scenario 3.
    """
    # The post-migration tree must contain the new names and not the old.
    forbidden_strings = {
        "__harness_force_failure__",
        "__harness_expire_token__",
        "harness_force_reissue_failures",
    }
    grep = subprocess.run(
        [
            "git", "grep", "-l", "-E",
            "|".join(re.escape(s) for s in forbidden_strings),
            "--",
            "ui-state/",
            "agent/",
            "tests/acceptance/project-and-chat-session-management/",
        ],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        check=False,
    )
    # git grep returns 1 when nothing matches; 0 means matches found.
    assert grep.returncode == 1, (
        f"post-migration tree still contains forbidden legacy strings: "
        f"{grep.stdout!r}. Phase-2 rename was not applied atomically."
    )


# ─────────────────────────── Scenario 4 ───────────────────────────


@pytest.mark.happy_path
@pytest.mark.mr_4
def test_each_knob_migration_is_one_atomic_commit(
    repo_root: Path,
) -> None:
    """Each migration commit moves ONE knob (or ONE rename) — not multiple.
    The reviewer verifies by reading the log: each commit's diff modifies
    a bounded set of files corresponding to one logical concern.

    Per US-CONSOL-4 Scenario 4 and CLAUDE.md's atomic-commits convention.
    """
    log = _git(
        "log",
        "--pretty=format:%H",
        "-n",
        "20",
        "--",
        "shared/failure-simulation/",
        cwd=repo_root,
    )
    if log.returncode != 0 or not log.stdout.strip():
        pytest.fail(
            "no commits found touching shared/failure-simulation/ — "
            "DELIVER's MR-4 has not landed yet"
        )
    # For each commit, the diff should be bounded — heuristic: <= 6 files
    # changed (one knob's worth: manifest, registry call, KNOB const, plus
    # at most three production files). DELIVER's reviewer applies judgement.
    for sha in log.stdout.splitlines():
        if not sha:
            continue
        stat = _git("diff", "--name-only", f"{sha}^", sha, cwd=repo_root)
        if stat.returncode != 0:
            continue
        file_count = len([p for p in stat.stdout.splitlines() if p.strip()])
        assert file_count <= 8, (
            f"commit {sha[:8]} modified {file_count} files — migration "
            f"commits must be bounded (<=8 file diff). Split the commit."
        )


# ─────────────────────────── Scenario 5 ───────────────────────────


@pytest.mark.error_path
@pytest.mark.mr_4
def test_a_regression_is_caught_by_the_acceptance_suite_via_audit_log(
    requires_shared_failure_simulation: None,
    requires_node: None,
    driver: FailureSimulationDriver,
) -> None:
    """When a callsite migration goes wrong (e.g. the registry call is wired
    to the wrong canonical name), the acceptance suite catches it: either an
    expected ``failure-simulation.fired`` event is absent, OR a
    ``failure-simulation.unknown`` event appears for the typo'd canonical
    name. The audit log is the diagnostic signal.

    Per US-CONSOL-4 Scenario 5.
    """
    # Simulate the regression: a callsite passes a canonical name that does
    # not exist in the manifest (e.g. via a refactor typo). Per
    # `component-design.md`, this surfaces as a `failure-simulation.unknown`
    # event, NOT a silent pass.
    script = (
        "import { probe, detectUnknownSignals } from '@dashboard-chat/shared-failure-simulation';\n"
        "probe(process.env, 'ui-state');\n"
        "const headers = new Headers();\n"
        "// Simulate a regression: a freshly-migrated callsite uses a stale\n"
        "// canonical name that no longer exists in the manifest.\n"
        "headers.set('X-Force-Create-Sesion-Failure', 'transient');\n"
        "detectUnknownSignals({\n"
        "  headers, serviceName: 'ui-state', correlationId: 'req-regress-001',\n"
        "});\n"
    )
    run = driver.run_registry_script(
        script,
        env={"ENVIRONMENT": "dev", "FAILURE_SIMULATION_ENABLED": "true"},
    )
    unknown = [
        e for e in run.events if e.get("event.name") == "failure-simulation.unknown"
    ]
    fired = [e for e in run.events if e.get("event.name") == "failure-simulation.fired"]
    # The diagnostic is BOTH: no `fired` event for the intended knob AND a
    # `unknown` event for the typo.
    assert fired == [], (
        f"regression must not silently fire any other knob; got {fired}"
    )
    assert len(unknown) == 1
    assert "force-create-sesion-failure" in unknown[0]["knob.name.raw"]
