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
    pytest.mark.real_io,
    pytest.mark.slice_4,
    pytest.mark.needs_compose_stack,
]


@pytest.fixture(scope="module")
def migrated_route_path() -> str:
    return os.environ.get("LOADER_PROBE_PATH", "/_test/loader-probe")


def test_loader_responds_with_5xx_within_5_seconds_when_upstream_is_slow(
    requires_slow_mode_capable: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """A loader-backed route responds 500/504 within 5s when auth-proxy delays 10s.

    DD-16/DD-17/DD-18: the probe route at `/_test/loader-probe` exercises
    the loader -> uiStateClient -> auth-proxy path. With auth-proxy started
    under `SLOW_MODE_DELAY_MS=10000`, the loader's 5s AbortController
    surfaces as a 504 (DD-16). 5.5s budget includes 0.5s scheduling
    tolerance above the 5s implementation bound.
    """
    start = time.monotonic()
    probe = driver.get(migrated_route_path, timeout=8.0)
    elapsed = time.monotonic() - start
    assert probe.status in (500, 504), f"expected 500/504, got {probe.status}"
    assert elapsed <= 5.5, (
        f"loader hung for {elapsed:.2f}s; budget is 5s "
        f"(with 0.5s tolerance for network/process scheduling)"
    )


def test_loader_timeout_error_renders_through_error_boundary(
    requires_slow_mode_capable: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """The timeout-derived error response is rendered through the route's ErrorBoundary, not a Node stack trace."""
    probe = driver.get(migrated_route_path, timeout=8.0)
    body = probe.body
    lowered = body.lower()
    assert "<html" in lowered, f"response body is not HTML5 (no <html tag); first 500 chars: {body[:500]!r}"
    assert "<body" in lowered, f"response body is not HTML5 (no <body tag); first 500 chars: {body[:500]!r}"
    assert 'role="alert"' in body, (
        f"response body does not carry the ErrorBoundary's role=\"alert\" marker; "
        f"first 500 chars: {body[:500]!r}"
    )
    # Forbid the most-distinctive Node stack-trace markers. We deliberately
    # do NOT forbid the bare word "Error" since the ErrorBoundary surface
    # may include it as descriptive copy.
    forbidden_markers = ("at /app/", "at processTicksAndRejections", "\n    at ")
    assert all(marker not in body for marker in forbidden_markers), (
        f"response body contains a Node stack-trace marker; "
        f"forbidden markers: {forbidden_markers!r}; first 1000 chars: {body[:1000]!r}"
    )
