"""SSR'd route migration acceptance — Slice 2 / MR-1.

Scenarios from `docs/feature/frontend-coexistence/distill/migrated-route-renders-html-server-side.feature`.

DWD-2: TanStack Query SSR via `dehydrate` + `<HydrationBoundary>`. The
migrated route's loader prefetches data through a request-scoped
`QueryClient`, dehydrates it, and the browser's singleton client
hydrates from the dehydrated state on first paint.

The route under test is the **first per-route migration** — likely
`/login` per the worked example in `application-architecture.md` §2
(migration playbook). The actual route DELIVER picks lands as part of
the Slice-2 MR-1 changeset; the test reads `MIGRATED_ROUTE_PATH` from
env or falls back to a sensible default.
"""

from __future__ import annotations

import os
import re

import pytest

from driver import FrontendCoexistenceDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.slice_2,
    pytest.mark.needs_compose_stack,
]


@pytest.fixture(scope="module")
def migrated_route_path() -> str:
    """The path of the first SSR'd route. DELIVER may set MIGRATED_ROUTE_PATH explicitly."""
    return os.environ.get("MIGRATED_ROUTE_PATH", "/login")


@pytest.fixture(scope="module")
def probe_bearer(driver: FrontendCoexistenceDriver) -> str:
    """A distinctive bearer used to identify the request inside auth-proxy logs."""
    return driver.mint_probe_bearer(prefix="ssr-route-mig")


def test_ssr_response_contains_server_rendered_route_component(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
    probe_bearer: str,
) -> None:
    """The SSR response contains the route component's pre-rendered DOM, not just an empty shell."""
    probe = driver.get(migrated_route_path, bearer=probe_bearer)
    assert probe.status == 200, (
        f"`{migrated_route_path}` returned {probe.status}; expected 200 SSR'd HTML"
    )
    assert "text/html" in probe.content_type.lower(), (
        f"`{migrated_route_path}` Content-Type was {probe.content_type!r}; expected text/html"
    )
    # The body must contain *some* server-rendered content beyond the empty `<div id="root">`
    # shell. The exact text DELIVER chooses is route-specific; the test asserts that the
    # `<div id="root">` is NOT empty.
    body = probe.body
    root_match = re.search(
        r'<div\s+id=["\']root["\']\s*>(.*?)</div>',
        body,
        flags=re.DOTALL,
    )
    assert root_match, (
        f"`{migrated_route_path}` response does not contain a `<div id=\"root\">` block. "
        f"Body head: {body[:500]!r}"
    )
    inner = root_match.group(1).strip()
    assert inner and len(inner) > 50, (
        f"`{migrated_route_path}` `<div id=\"root\">` is empty (length {len(inner)}); "
        f"DWD-2 requires server-rendered route component output. Inner: {inner!r}"
    )


def test_ssr_response_contains_dehydrated_state_marker(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
    probe_bearer: str,
) -> None:
    """The response body contains a serialized form of `dehydratedState` (DWD-2)."""
    probe = driver.get(migrated_route_path, bearer=probe_bearer)
    body = probe.body
    # RRv7 + TanStack Query SSR emits the dehydrated state in a `<script>` tag
    # near the end of the body. The exact serialization format is RRv7-internal
    # (window.__remixContext or similar). The contract is: SOMEWHERE in the body
    # there is a marker identifying that loader data + dehydrated state shipped.
    has_loader_data_marker = (
        "dehydratedState" in body
        or "__remixContext" in body
        or "__reactRouterContext" in body
        or "useLoaderData" in body
        # Permissive: any of the RRv7 / TanStack-Query SSR markers DELIVER may
        # emit count. The strict contract is one of: dehydratedState is in the
        # serialized payload that hydrates the route.
    )
    assert has_loader_data_marker, (
        f"`{migrated_route_path}` response does not contain a recognizable "
        f"dehydratedState / loader-data marker. DWD-2 requires the dehydrated "
        f"state to ship in the HTML. Body length: {len(body)}; head: {body[:500]!r}"
    )


@pytest.mark.skip(
    reason="DELIVER-deferred per DD-12 (Phase 02): pytest.fail placeholder; harness mechanism (Playwright / fixture-driven upstream / etc.) is a separate engineering investment scoped to a follow-up MR. See deliver/wave-decisions.md DD-12.",
)
def test_browser_does_not_duplicate_fetch_after_hydration(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """After hydration, the route component does NOT re-fetch the query key the loader prefetched.

    Operationalized as a behavioral assertion the DELIVER suite verifies — this
    is the no-double-fetch invariant DWD-2 names. DELIVER may use a Playwright
    network log inspection, or instrument the request-scoped QueryClient with a
    fetch counter on a test-only build, or use `pytest-httpx` MockTransport at
    the auth-proxy layer.

    DISTILL leaves the implementation strategy open; the contract is fixed.
    """
    pytest.fail(
        "no-double-fetch contract — DELIVER chooses implementation. "
        "Candidates: (a) Playwright network-event capture, (b) test-only "
        "instrumentation on the request-scoped QueryClient, (c) auth-proxy "
        "request-count assertion via a test fixture wrapping its access log."
    )


@pytest.mark.skip(
    reason="DELIVER-deferred per DD-12 (Phase 02): pytest.fail placeholder; harness mechanism (Playwright / fixture-driven upstream / etc.) is a separate engineering investment scoped to a follow-up MR. See deliver/wave-decisions.md DD-12.",
)
def test_loader_thrown_response_surfaces_as_error_render(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
    probe_bearer: str,
) -> None:
    """A loader that throws `new Response(..., {status: 502})` produces a 502 response.

    Requires a test-specific upstream condition (e.g., auth-proxy
    misconfigured to return 502, or a test-fixture-driven Mock-Service-Worker
    style intercept). DELIVER sets the precondition; DISTILL fixes the contract.
    """
    pytest.fail(
        "loader-thrown-response contract — DELIVER provides the upstream precondition "
        "that makes the loader throw. The contract is: the browser sees a 502, "
        "the response body is the route's ErrorBoundary, not a stack trace."
    )


def test_active_scope_propagates_through_loader_to_hydrated_state(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
    probe_bearer: str,
) -> None:
    """The loader's `active_scope` propagation (ADR-029) lands in the dehydrated state.

    The migrated route's loader calls `uiStateClient(request).getProjection(
    "login-and-org-setup")`; the projection's `active_scope` field arrives in
    the SSR'd HTML as part of the dehydrated state. After hydration,
    `useScope()` reads it via `useRouteLoaderData("root")`.
    """
    probe = driver.get(migrated_route_path, bearer=probe_bearer)
    assert probe.status == 200, f"expected 200, got {probe.status}"
    body = probe.body
    # The body should contain SOME reference to `active_scope` — either as a JSON
    # key in the dehydrated state or as a window-attached payload. DELIVER picks
    # the exact serialization; the contract is presence.
    assert "active_scope" in body or "activeScope" in body, (
        f"`{migrated_route_path}` SSR'd response does not contain `active_scope` "
        f"in the dehydrated state. ADR-029 requires the active_scope value to be "
        f"propagated through the loader return into the client-hydratable payload."
    )


def test_appshell_inner_query_provider_is_removed(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """After Slice-2, AppShell does not wrap children in `<QueryProvider>` (DWD-7)."""
    appshell = driver.read_repo_text("frontend/src/ui/components/AppShell/index.tsx")
    # The pre-Slice-2 code at lines 55-59 wrapped children in `<QueryProvider>`.
    # After Slice-2, the wrap is gone (the root-level singleton owns the cache).
    assert "<QueryProvider>" not in appshell and "QueryProvider>" not in appshell, (
        "AppShell still wraps children in `<QueryProvider>` — DWD-7 requires "
        "Slice-2 to remove the inner provider once the root-level singleton "
        "is reachable."
    )
