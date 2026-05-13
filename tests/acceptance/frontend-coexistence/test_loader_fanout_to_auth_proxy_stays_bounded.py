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
    pytest.mark.skip(
        reason="DISTILL: pending DELIVER phase 04 (Slice-4 / MR-3 — operational readiness) per roadmap.json",
    ),
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

    DELIVER's Slice-4 harness:
      1. Measures `auth-proxy` request rate under the pre-MR-0 topology
         serving a representative request mix (e.g., 60s of synthetic
         workload exercising the user-visible routes).
      2. Migrates 50% of routes to framework mode (adds `loader` exports
         that call `auth-proxy` once per server request).
      3. Replays the same request mix and measures the post-migration
         `auth-proxy` request rate.
      4. Asserts: post-migration rate <= pre-migration rate * 1.10.

    DISTILL fixes the 10% ceiling; DELIVER provides the workload generator
    and the auth-proxy access-log counter.
    """
    pytest.fail(
        "fan-out measurement is DELIVER's job. Contract: post-migration "
        "auth-proxy QPS <= pre-MR-0 baseline QPS * 1.10. Measurement window: "
        "60s of representative workload. Baseline recorded in "
        "docs/feature/frontend-coexistence/deliver/baseline-metrics.md."
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
