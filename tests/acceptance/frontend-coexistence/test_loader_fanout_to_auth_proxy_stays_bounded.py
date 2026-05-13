"""Auth-proxy request volume stays within 10% of pre-MR-0 baseline — Slice 4 / MR-3.

Encodes Praxis review-by-system-designer.md F-2 + §5 fan-out scenario.
Every SSR'd route causes web-ssr to call auth-proxy once per server
request via `uiStateClient(request)`. Under a 50% framework-mode
migration profile, the auth-proxy QPS MUST stay within ≤ 10% above the
pre-MR-0 baseline.

DESIGN did not specify a baseline number; DELIVER measures it during
Slice-4 execution. DISTILL fixes the 10% ceiling per DI-5.

Feature file (SSOT): `docs/feature/frontend-coexistence/distill/loader-fanout-to-auth-proxy-stays-bounded.feature`.
"""

from __future__ import annotations

import pytest

from driver import FrontendCoexistenceDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.slice_4,
    pytest.mark.needs_compose_stack,
    pytest.mark.slow,
]


def test_50_percent_framework_mode_migration_keeps_auth_proxy_qps_within_10_percent(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """A 50% framework-mode migration profile produces ≤ 10% auth-proxy QPS increase vs the pre-MR-0 baseline.

    Live-stack QPS measurement is operator-driven (not deterministic in CI).
    Strategy C (DI-1): the scenario verifies that DELIVER recorded a
    PASS/FAIL ceiling statement in baseline-metrics.md; until that artifact
    exists (lands in step 04-03 per roadmap.json), the test skips cleanly.

    DISTILL fixes the 10% ceiling; DELIVER provides the workload generator
    and the auth-proxy access-log counter when the operator runs the
    measurement against the live stack.
    """
    baseline_path = driver.repo_root / "docs/feature/frontend-coexistence/deliver/baseline-metrics.md"
    if not baseline_path.exists():
        pytest.skip(
            "baseline-metrics.md not yet recorded (step 04-03 lands it). "
            "The 50% migration QPS measurement is operator-driven; see baseline-metrics.md "
            "for the methodology DELIVER uses to verify the 110% ceiling."
        )
    text = baseline_path.read_text(encoding="utf-8")
    pass_marker_present = "PASS" in text and "110%" in text
    fail_marker_present = "FAIL" in text and "110%" in text
    assert pass_marker_present or fail_marker_present, (
        "baseline-metrics.md does not contain a PASS/FAIL ceiling statement. "
        "DELIVER must record whether the post-50%-migration profile is within 110% of baseline."
    )
    assert not fail_marker_present, (
        "baseline-metrics.md records FAIL on the 110% ceiling — the post-50%-migration "
        "auth-proxy QPS exceeds the bound. Investigate before merging."
    )


def test_baseline_qps_is_recorded_as_a_slice4_artifact(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """The pre-MR-0 auth-proxy baseline QPS measurement is recorded under deliver/ for future regression checks."""
    baseline_path = driver.repo_root / "docs/feature/frontend-coexistence/deliver/baseline-metrics.md"
    if not baseline_path.exists():
        pytest.fail(
            f"baseline-metrics.md not present at {baseline_path.relative_to(driver.repo_root)}. "
            f"DELIVER's Slice-4 records the pre-MR-0 auth-proxy QPS baseline there "
            f"as the reference for future migration-profile-change regression checks."
        )
    text = baseline_path.read_text(encoding="utf-8")
    # The contract is presence of a baseline QPS measurement with units.
    assert "QPS" in text or "qps" in text or "requests per second" in text.lower(), (
        f"baseline-metrics.md does not contain a recognizable QPS measurement. "
        f"Expected: a recorded number with units (QPS / requests per second)."
    )
