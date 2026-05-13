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

import os

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


def test_two_sequential_requests_to_same_route_produce_byte_equivalent_html(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """Two requests for the same (route, bearer) under `--scale web-ssr=2` produce byte-equivalent bodies.

    Precondition: the compose stack is up with `--scale web-ssr=2`. DELIVER
    provides the harness for bringing the stack up under that scale; the
    suite-level `requires_compose_stack` only verifies reachability.

    DELIVER may strip volatile headers (Request-Id, Date, etc.) before the
    byte-equivalence comparison; the contract is on the response body.
    """
    pytest.fail(
        "scale-up precondition is DELIVER's job. Contract: with --scale web-ssr=2 "
        "and a stable (route, bearer) pair, two sequential responses are byte-equivalent "
        "bodies. Volatile headers (Request-Id, Date) MAY differ; the body MUST NOT."
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
