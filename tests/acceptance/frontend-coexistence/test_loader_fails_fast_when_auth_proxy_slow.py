"""A migrated route's loader fails fast when auth-proxy is slow — Slice 4 / MR-3.

Encodes Praxis review-by-system-designer.md §5 "Loader timeout handling".
Contract: a 10-second slow upstream MUST surface as a 5xx response within
5 seconds wall-clock — never a hung request. The error response is rendered
through the route's ErrorBoundary (HTML5), not a Node stack trace.

Feature file (SSOT): `docs/feature/frontend-coexistence/distill/loader-fails-fast-when-auth-proxy-slow.feature`.
"""

from __future__ import annotations

import os
import time

import pytest

from driver import FrontendCoexistenceDriver

pytestmark = [
    pytest.mark.skip(
        reason="DISTILL: pending DELIVER phase 04 (Slice-4 / MR-3 — operational readiness) per roadmap.json",
    ),
    pytest.mark.real_io,
    pytest.mark.slice_4,
    pytest.mark.needs_compose_stack,
]


@pytest.fixture(scope="module")
def migrated_route_path() -> str:
    return os.environ.get("MIGRATED_ROUTE_PATH", "/login")


def test_loader_responds_with_5xx_within_5_seconds_when_upstream_is_slow(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """A loader-backed route responds 500/504 within 5s when auth-proxy delays 10s.

    DELIVER provides the slow-upstream induction (compose-level network
    delay shim or auth-proxy `SLOW_MODE` env toggle) via the precondition
    fixture; DISTILL fixes the 5-second wall-clock budget as the contract.
    """
    pytest.fail(
        "slow-upstream induction is DELIVER's job. Contract: precondition is "
        "`auth-proxy /ui-state/.../projection` delays 10s; assertion is "
        "response.status in {500, 504} AND elapsed <= 5s."
    )
    # Reference implementation skeleton (DELIVER finalizes after wiring the
    # slow-mode toggle):
    #   start = time.monotonic()
    #   probe = driver.get(migrated_route_path, timeout=8.0)
    #   elapsed = time.monotonic() - start
    #   assert probe.status in (500, 504), f"expected 500/504, got {probe.status}"
    #   assert elapsed <= 5.0, f"loader hung for {elapsed:.2f}s; budget is 5s"


def test_loader_timeout_error_renders_through_error_boundary(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """The timeout-derived error response is rendered through the route's ErrorBoundary, not a Node stack trace."""
    pytest.fail(
        "slow-upstream induction is DELIVER's job. Contract: response body is "
        "well-formed HTML5 and matches the route's ErrorBoundary render (or the "
        "root-level ErrorBoundary fallback). Body MUST NOT contain Node stack-trace "
        "markers (e.g., `at /app/`, `at processTicksAndRejections`)."
    )
