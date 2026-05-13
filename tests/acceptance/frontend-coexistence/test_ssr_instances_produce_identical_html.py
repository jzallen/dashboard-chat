"""Two web-ssr instances behind nginx produce byte-equivalent SSR'd HTML — Slice 4 / MR-3.

Encodes Praxis review-by-system-designer.md §5 "Horizontal scale assertion".
Application-architecture.md §6.4 names web-ssr as horizontally scalable
(no session affinity, stateless handlers, request-scoped QueryClient).
This module verifies that property end-to-end: under
`docker compose up -d --scale web-ssr=2`, every instance produces
byte-equivalent SSR'd HTML for the same (route, bearer) pair.

Feature file (SSOT): `docs/feature/frontend-coexistence/distill/ssr-instances-produce-identical-html.feature`.
"""

from __future__ import annotations

import difflib
import os
import re

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


def _normalize(body: str) -> str:
    """Strip volatile substrings before byte-equivalence comparison.

    Removes: Request-Id references (inline or header-style), ISO-8601
    datestamps, and hash-suffixed asset URLs. The remainder is what the
    horizontal-scale property MUST hold on (§6.4 application-architecture).
    """
    normalized = re.sub(r'request-id["\s:=]+\S+', "", body, flags=re.IGNORECASE)
    normalized = re.sub(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\"'<>\s]*", "", normalized)
    normalized = re.sub(
        r"/assets/[\w./-]+-[a-f0-9]{8,}\.(js|css|tsx|ts)",
        r"/assets/NORMALIZED.\1",
        normalized,
    )
    return normalized


def test_two_sequential_requests_to_same_route_produce_byte_equivalent_html(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """Two requests for the same (route, bearer) under `--scale web-ssr=2` produce byte-equivalent bodies.

    Precondition: the compose stack is up with `--scale web-ssr=2`. DELIVER
    provides the harness for bringing the stack up under that scale; the
    suite-level `requires_compose_stack` only verifies reachability.

    Volatile substrings (Request-Id, Date, hash-suffixed asset URLs) are
    normalized out before comparison; the residual MUST be byte-equivalent.
    """
    bearer = driver.mint_probe_bearer(prefix="scale-stable")
    r1 = driver.get(migrated_route_path, bearer=bearer)
    r2 = driver.get(migrated_route_path, bearer=bearer)
    assert r1.status == 200, f"first probe returned {r1.status}; expected 200"
    assert r2.status == 200, f"second probe returned {r2.status}; expected 200"
    assert "text/html" in r1.content_type.lower(), (
        f"first probe content-type is {r1.content_type!r}; expected text/html"
    )
    normalized_a = _normalize(r1.body)
    normalized_b = _normalize(r2.body)
    if normalized_a != normalized_b:
        diff = "\n".join(
            difflib.unified_diff(
                normalized_a.splitlines(),
                normalized_b.splitlines(),
                fromfile="probe-1",
                tofile="probe-2",
                lineterm="",
                n=2,
            )
        )
        raise AssertionError(
            "byte-equivalence broken across two sequential probes with the same "
            f"(route, bearer); first 1000 chars of diff:\n{diff[:1000]}"
        )


def test_distinct_bearers_do_not_leak_across_instances(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """Distinct probe bearers' SSR responses do not contain each other's identity (no cross-bearer leak).

    Validates the request-scoped QueryClient invariant (DWD-2): no
    module-level state survives across requests, even when those requests
    hit different web-ssr instances under `--scale web-ssr=2`.
    """
    bearer_a = driver.mint_probe_bearer(prefix="scale-A")
    bearer_b = driver.mint_probe_bearer(prefix="scale-B")
    response_a = driver.get(migrated_route_path, bearer=bearer_a)
    response_b = driver.get(migrated_route_path, bearer=bearer_b)
    assert bearer_a not in response_b.body, (
        f"response B's body contains bearer A's probe value — instance state leaked"
    )
    assert bearer_b not in response_a.body, (
        f"response A's body contains bearer B's probe value — instance state leaked"
    )
