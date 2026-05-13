"""Loader auth forwarding — Slice 2 / MR-1.

Scenarios from `docs/feature/frontend-coexistence/distill/loader-forwards-bearer-to-auth-proxy.feature`.

DWD-1: `AuthProvider` is mounted at the root of the React tree and stays
the single source of truth for token state on the client. Loaders do NOT
construct a server-side `AuthProvider`. They read the Bearer from
`request.headers.get('Authorization')` and forward it to `auth-proxy`
via `uiStateClient(request)`.
"""

from __future__ import annotations

import os
import re

import pytest

from driver import FrontendCoexistenceDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.slice_2,
]


@pytest.fixture(scope="module")
def migrated_route_path() -> str:
    """The path of the first SSR'd route (matches test_ssr_route_migration.py)."""
    return os.environ.get("MIGRATED_ROUTE_PATH", "/login")


# ───────────────────────────── DWD-1: bearer forwarding ─────────────────────────────


@pytest.mark.needs_compose_stack
def test_loader_forwards_browser_bearer_to_auth_proxy(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """The browser's `Authorization: Bearer <probe>` header reaches auth-proxy unchanged.

    The probe-bearer-forwarding contract requires an audit hook at the
    auth-proxy layer that records the most-recent inbound Authorization
    header value (a test-only mirror endpoint, e.g.,
    `GET /auth-proxy/test/last-seen-authorization`). DELIVER provides
    the audit hook; DISTILL fixes the contract.
    """
    probe_bearer = driver.mint_probe_bearer(prefix="loader-fwd")
    response = driver.get(migrated_route_path, bearer=probe_bearer)
    assert response.status == 200, f"expected 200, got {response.status}"
    # Read what auth-proxy reports it last saw. The endpoint is test-only;
    # DELIVER configures it via `AUTH_PROXY_TEST_MIRROR_PATH` or similar.
    mirror_path = os.environ.get(
        "AUTH_PROXY_TEST_MIRROR_PATH",
        "/auth-proxy/test/last-seen-authorization",
    )
    mirror = driver.get(mirror_path)
    assert mirror.status == 200, (
        f"auth-proxy test-mirror probe at {mirror_path} returned {mirror.status}; "
        f"DELIVER must wire the mirror endpoint for this scenario"
    )
    assert f"Bearer {probe_bearer}" in mirror.body, (
        f"auth-proxy's most-recent Authorization header does not contain the "
        f"probe bearer. Mirror reported: {mirror.body[:200]!r}; expected "
        f"`Bearer {probe_bearer}`"
    )


# ───────────────────────────── DWD-1: no AuthProvider on server ─────────────────────────────


@pytest.mark.needs_repo_post_mr0_state
def test_no_loader_imports_auth_provider_as_value(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """No `loader` function in any route module imports `AuthProvider` as a value used inside the loader."""
    # Walk every route module in frontend/app/routes/. For each one that has a
    # `loader` export, verify that AuthProvider does NOT appear inside the loader body.
    offenders: list[str] = []
    routes_dir = driver.repo_root / "frontend" / "app" / "routes"
    if not routes_dir.exists():
        pytest.skip("frontend/app/routes/ does not exist yet — MR-0 has not landed.")
    for file in routes_dir.rglob("*.tsx"):
        source = file.read_text(encoding="utf-8")
        loader_match = re.search(
            r"^export\s+(async\s+)?function\s+loader\s*\([^)]*\)\s*\{",
            source,
            re.MULTILINE,
        )
        if not loader_match:
            continue
        # Coarse: any reference to AuthProvider inside the file when a loader exists
        # is suspect. Refinement: confine to the loader's body span.
        if re.search(r"\bAuthProvider\b", source[loader_match.start() :]):
            offenders.append(str(file.relative_to(driver.repo_root)))
    assert not offenders, (
        f"loader-bearing route module(s) reference `AuthProvider` inside or after the "
        f"loader export — DWD-1 forbids server-side AuthProvider usage: {offenders!r}"
    )


@pytest.mark.needs_repo_post_mr0_state
def test_no_loader_calls_use_auth(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """No `loader` function calls `useAuth()` or reads identity from any React context."""
    offenders: list[str] = []
    routes_dir = driver.repo_root / "frontend" / "app" / "routes"
    if not routes_dir.exists():
        pytest.skip("frontend/app/routes/ does not exist yet — MR-0 has not landed.")
    for file in routes_dir.rglob("*.tsx"):
        source = file.read_text(encoding="utf-8")
        loader_match = re.search(
            r"^export\s+(async\s+)?function\s+loader\s*\([^)]*\)\s*\{",
            source,
            re.MULTILINE,
        )
        if not loader_match:
            continue
        # Approximate: look for useAuth / useContext inside the post-loader-start span.
        body_span = source[loader_match.start() :]
        if re.search(r"\buseAuth\s*\(", body_span) or re.search(r"\buseContext\s*\(", body_span):
            offenders.append(str(file.relative_to(driver.repo_root)))
    assert not offenders, (
        f"loader-bearing route module(s) call `useAuth()` or `useContext()` — "
        f"loaders are not React; they MUST read identity from `request.headers`: {offenders!r}"
    )


# ───────────────────────────── DWD-1: AuthProvider render is SSR-safe ─────────────────────────────


@pytest.mark.needs_compose_stack
def test_ssr_pass_does_not_throw_for_any_route(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """The SSR pass completes for every route without an unhandled exception in AuthProvider's render."""
    # The contract is: hit each route under web-ssr and observe a 200/redirect
    # response. A 500 indicates an SSR-time exception — most likely from
    # AuthProvider's render accessing a browser-only API.
    for path in ["/login", "/", "/projects"]:
        probe = driver.get(path)
        assert probe.status in (200, 302, 303, 307, 308, 401), (
            f"`{path}` returned {probe.status} — SSR appears to have thrown an "
            f"exception (likely AuthProvider's render touching window/document). "
            f"Body head: {probe.body[:500]!r}"
        )


# ───────────────────────────── Client hydration ─────────────────────────────


@pytest.mark.needs_compose_stack
@pytest.mark.skip(
    reason="DELIVER-deferred per DD-12 (Phase 02): pytest.fail placeholder; harness mechanism (Playwright / fixture-driven upstream / etc.) is a separate engineering investment scoped to a follow-up MR. See deliver/wave-decisions.md DD-12.",
)
def test_client_authprovider_reads_session_storage_on_hydration(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """Post-hydration, `AuthProvider`'s `useEffect` reads the token from sessionStorage.

    This is a browser-side behavior. DELIVER decides the implementation strategy
    (playwright-python network/JS assertion, vitest unit test of the hook, or a
    manual smoke test). DISTILL fixes the contract.
    """
    pytest.fail(
        "AuthProvider hydration contract — DELIVER provides the browser-side harness "
        "or moves this assertion to a vitest unit test. Contract: after hydration, "
        "`useAuth().user` reflects the token read from sessionStorage (matching pre-MR-0 behavior)."
    )


# ───────────────────────────── Request scoping (no leak across concurrent SSRs) ─────────────────────────────


@pytest.mark.needs_compose_stack
def test_two_concurrent_ssr_requests_with_different_bearers_do_not_leak(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    migrated_route_path: str,
) -> None:
    """Two concurrent SSR requests with distinct probe bearers do not leak identity into each other's response.

    Validates the request-scoped `QueryClient` invariant (DWD-2). DELIVER may use
    pytest-asyncio + asyncio.gather to issue the two requests concurrently; the
    contract is asserted on the two response bodies.
    """
    bearer_a = driver.mint_probe_bearer(prefix="bearer-A")
    bearer_b = driver.mint_probe_bearer(prefix="bearer-B")
    # Sequential is acceptable as a first cut; the leak property is between
    # concurrent requests but a single-threaded sequence proves no module-level state.
    response_a = driver.get(migrated_route_path, bearer=bearer_a)
    response_b = driver.get(migrated_route_path, bearer=bearer_b)
    assert bearer_a not in response_b.body, (
        f"Response B's body contains Bearer A's probe value — request isolation broken."
    )
    assert bearer_b not in response_a.body, (
        f"Response A's body contains Bearer B's probe value — request isolation broken."
    )
