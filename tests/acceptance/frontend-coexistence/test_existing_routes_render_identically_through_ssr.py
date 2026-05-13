"""Existing routes render identically through SSR — Slice 1 / MR-0 invariants.

After MR-0 lands, every pre-MR-0 route renders the same way it did
before from the browser's perspective. This module asserts:

  - the five existing nginx rules continue to route to their pre-MR-0
    upstreams (`/api/*`, `/worker/*`, `/api/channels/:id/presentation-state`,
    `/health`, `/assets/*`),
  - the catch-all proxies to `web-ssr`,
  - `ui-presentation/` is dissolved + the five scaffold files are
    addressable at their new location under `frontend/app/routes/`,
  - `App.tsx` is deleted, `<BrowserRouter>` is no longer imported in
    source, and `main.tsx` is the RRv7 `<HydratedRouter>` hydration entry,
  - the DOM fingerprint post-hydration is structurally equivalent pre/post
    MR-0 for the entry routes (deferred — see DI-2).

The compose-topology +1 container-count delta (web-ssr alongside the
six pre-MR-0 services) is asserted in
`test_compose_topology_gains_one_service.py`.

Feature file (SSOT): `docs/feature/frontend-coexistence/distill/existing-routes-render-identically-through-ssr.feature`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from driver import FrontendCoexistenceDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.slice_1,
]


# ───────────────────────────── §3.1 — visual parity ─────────────────────────────


@pytest.mark.needs_compose_stack
def test_api_rule_routes_to_auth_proxy_not_web_ssr(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """A request to `/api/...` is routed by nginx to auth-proxy, not web-ssr."""
    probe = driver.get("/api/v1/health")
    # The response either succeeds (auth-proxy answered) or is auth-proxy's 401/403
    # — what it MUST NOT be is web-ssr's RRv7 HTML response.
    assert "text/html" not in probe.content_type.lower(), (
        f"`/api/v1/health` was served as text/html — looks like nginx routed it "
        f"to web-ssr instead of auth-proxy. Content-Type: {probe.content_type!r}"
    )


@pytest.mark.needs_compose_stack
def test_worker_rule_routes_to_agent_not_web_ssr(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """A request to `/worker/...` is routed by nginx to agent, not web-ssr."""
    probe = driver.get("/worker/chat/health")
    assert "text/html" not in probe.content_type.lower(), (
        f"`/worker/chat/health` was served as text/html — looks like nginx routed "
        f"it to web-ssr instead of agent. Content-Type: {probe.content_type!r}"
    )


@pytest.mark.needs_compose_stack
def test_presentation_state_rule_routes_directly_to_agent(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """ADR-015's nginx rule: `/api/channels/:id/presentation-state` reaches agent directly."""
    probe = driver.get(
        "/api/channels/test-channel-id/presentation-state",
        accept="text/event-stream",
    )
    # Either an SSE stream (`text/event-stream`) or agent's auth-failure response —
    # but NOT a text/html SSR response from web-ssr.
    assert "text/html" not in probe.content_type.lower(), (
        f"presentation-state was served as text/html — ADR-015 rule appears broken. "
        f"Content-Type: {probe.content_type!r}"
    )


@pytest.mark.needs_compose_stack
def test_health_rule_routes_to_auth_proxy(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """`/health` is routed by nginx to auth-proxy."""
    probe = driver.get("/health")
    assert probe.status == 200, (
        f"`/health` returned {probe.status}; auth-proxy should answer with 200"
    )
    assert "text/html" not in probe.content_type.lower(), (
        f"`/health` was served as text/html — looks like web-ssr answered. "
        f"Content-Type: {probe.content_type!r}"
    )


@pytest.mark.needs_compose_stack
def test_catch_all_route_proxies_to_web_ssr(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """An unmatched path (e.g., `/login`, `/projects/anything`) reaches web-ssr."""
    for path in ["/login", "/projects/some-project-id", "/some-unmatched-path"]:
        probe = driver.get(path)
        assert probe.status == 200, (
            f"`{path}` returned {probe.status}; web-ssr should answer with 200 "
            f"(library-mode shell or RRv7 404 render)"
        )
        assert "text/html" in probe.content_type.lower(), (
            f"`{path}` was not served as text/html — Content-Type: {probe.content_type!r}"
        )


@pytest.mark.needs_compose_stack
def test_dom_fingerprint_pre_post_mr0_matches(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """DOM fingerprint reduced to HTML-shape assertion at MR-0 per DD-1.

    The walking-skeleton scenario (`test_rrv7_handler_serves_html_shell_for_root_request`)
    already asserts the structural shape of the SSR response at `/` via
    `driver.response_is_html_shell(probe)`. This scenario is the entry-route variant
    of that assertion — at MR-0 every route is library-mode, so the SSR'd HTML
    for `/` is structurally equivalent to nginx's pre-MR-0 `try_files index.html`
    shell (well-formed HTML5, `<div id="root">`, `<script>` reference, no error page).

    DELIVER deferred the full DOM fingerprint to `e2e/` if/when a regression
    demands browser-level fidelity — see deliver/wave-decisions.md DD-1.
    """
    probe = driver.get("/")
    assert driver.response_is_html_shell(probe), (
        f"DOM-fingerprint (HTML-shape reduction) failed for /: response is not a "
        f"well-formed HTML shell. status={probe.status}, content_type={probe.content_type!r}, "
        f"body head: {probe.body[:500]!r}"
    )


# ───────────────────────────── §3.5 — ui-presentation/ dissolution ─────────────────────────────


@pytest.mark.needs_repo_post_mr0_state
def test_ui_presentation_directory_no_longer_exists(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """`ui-presentation/` is deleted from the repo working tree."""
    assert not driver.path_exists("ui-presentation"), (
        "`ui-presentation/` still exists — MR-0 should have deleted the directory "
        "after migrating its scaffold files into `frontend/app/routes/`."
    )


@pytest.mark.needs_repo_post_mr0_state
def test_no_repo_file_imports_from_ui_presentation_paths(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """No source file in the repo imports from a `ui-presentation/` path."""
    matches = driver.grep_repo(
        r"from\s+['\"][^'\"]*ui-presentation/",
        paths=["frontend", "agent", "auth-proxy", "ui-state", "shared", "worker", "backend"],
        exclude_paths=["docs", ".git", "node_modules"],
    )
    assert not matches, (
        f"found {len(matches)} import(s) from `ui-presentation/` paths after MR-0: "
        f"{matches[:5]!r}"
    )


@pytest.mark.needs_repo_post_mr0_state
def test_root_package_json_workspaces_no_longer_contains_ui_presentation(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """The root `package.json` "workspaces" array no longer contains `ui-presentation`."""
    pkg = json.loads(driver.read_repo_text("package.json"))
    workspaces = pkg.get("workspaces", [])
    assert "ui-presentation" not in workspaces, (
        f"root package.json `workspaces` still contains `ui-presentation`: {workspaces!r}"
    )


@pytest.mark.needs_repo_post_mr0_state
def test_five_scaffold_files_addressable_at_new_location(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """The five scaffold files moved from `ui-presentation/app/routes/` exist under `frontend/app/routes/`."""
    expected = [
        "frontend/app/routes/copy-variants.ts",
        "frontend/app/routes/expired-token-banner.tsx",
        "frontend/app/routes/expired-token-banner.test.tsx",
        "frontend/app/routes/recoverable-error.tsx",
        "frontend/app/routes/recoverable-error.test.tsx",
    ]
    missing = [p for p in expected if not driver.path_exists(p)]
    assert not missing, f"expected scaffold files missing after MR-0: {missing!r}"


# ───────────────────────────── §3.7 — App.tsx + BrowserRouter ─────────────────────────────


@pytest.mark.needs_repo_post_mr0_state
def test_app_tsx_file_no_longer_exists(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """`frontend/App.tsx` is deleted (DWD-6)."""
    assert not driver.path_exists("frontend/App.tsx"), (
        "`frontend/App.tsx` still exists — DWD-6 requires MR-0 to delete it; "
        "its providers move to `frontend/app/root.tsx` and its `<Routes>` declarations "
        "move to `frontend/app/routes.ts`."
    )


@pytest.mark.needs_repo_post_mr0_state
def test_no_source_file_imports_browser_router(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """No source file under `frontend/src/` or `frontend/app/` imports `BrowserRouter`.

    Test files (`*.test.tsx`, `*.spec.tsx`) MAY use `MemoryRouter` and are excluded
    from this assertion. `BrowserRouter` is incompatible with RRv7 framework mode.
    """
    matches = [
        (path, line_no, line)
        for path, line_no, line in driver.grep_repo(
            r"\bBrowserRouter\b",
            paths=["frontend/src", "frontend/app"],
        )
        if not (path.name.endswith(".test.tsx") or path.name.endswith(".spec.tsx"))
    ]
    assert not matches, (
        f"found {len(matches)} non-test source file(s) still importing `BrowserRouter`: "
        f"{matches[:5]!r}"
    )


@pytest.mark.needs_repo_post_mr0_state
def test_main_tsx_is_hydrated_router_entry(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """`frontend/main.tsx` imports `HydratedRouter` from `react-router/dom` and hydrates."""
    main = driver.read_repo_text("frontend/main.tsx")
    assert re.search(
        r"import\s+\{[^}]*HydratedRouter[^}]*\}\s+from\s+['\"]react-router/dom['\"]",
        main,
    ), (
        "`frontend/main.tsx` does not import `HydratedRouter` from `react-router/dom`. "
        "DWD-6 requires the RRv7 framework-mode hydration entry."
    )
    assert "hydrateRoot(document" in main, (
        "`frontend/main.tsx` does not call `hydrateRoot(document, ...)`."
    )
    assert "<HydratedRouter" in main, (
        "`frontend/main.tsx` does not render `<HydratedRouter />` inside its hydrate call."
    )


# Container-delta tests live in test_compose_topology_gains_one_service.py.
