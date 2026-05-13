"""Chat / SSE clientLoader-only opt-out — Slice 3 / MR-2.

Scenarios from `docs/feature/frontend-coexistence/distill/chat-route-bypasses-ssr-via-clientloader.feature`.

DWD-3: chat-bearing routes do NOT export a server `loader`. They MAY
export a `clientLoader` (browser-only). The ADR-015 nginx rule routing
`/api/channels/:id/presentation-state` directly to `agent` remains
byte-unchanged.
"""

from __future__ import annotations

import re

import pytest

from driver import FrontendCoexistenceDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.slice_3,
]


# ───────────────────────────── DWD-3: no server loader on chat-bearing routes ─────────────────────────────


@pytest.mark.needs_repo_post_mr0_state
def test_no_chat_bearing_route_exports_server_loader(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """Any route module that imports `ChatView` MUST NOT export a server `loader`."""
    # Find every .tsx route file in frontend/app/routes/ that imports ChatView.
    chat_route_files: list[str] = []
    for match in driver.grep_repo(
        r"import\s+.*\bChatView\b",
        paths=["frontend/app/routes"],
    ):
        path, _line_no, _line = match
        chat_route_files.append(str(path))
    # If MR-2 has not landed yet OR the chat route module simply does not exist
    # yet, the scenario is N/A — we'd expect at least one such file post-Slice-2
    # if any chat-bearing route was migrated. The scenario asserts the negative:
    # IF such files exist, none of them export a `loader`.
    if not chat_route_files:
        pytest.skip(
            "no route module imports ChatView yet — DWD-3 invariant is vacuously true. "
            "Re-enable when DELIVER migrates a chat-bearing route family to a "
            "route module under `frontend/app/routes/`."
        )
    offenders: list[str] = []
    for relpath in chat_route_files:
        source = driver.read_repo_text(relpath)
        if re.search(r"^export\s+(async\s+)?function\s+loader\b", source, re.MULTILINE):
            offenders.append(relpath)
    assert not offenders, (
        f"chat-bearing route module(s) export a server `loader` (violates DWD-3): "
        f"{offenders!r}"
    )


@pytest.mark.needs_compose_stack
def test_chat_route_ssr_response_is_html_shell_no_client_loader_output(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """A chat-bearing route's SSR response is an HTML shell — no clientLoader output server-side."""
    # The chat route under test is at `/chat/<channelId>`. DELIVER may parameterize.
    probe = driver.get("/chat/test-channel-id")
    assert probe.status == 200, f"expected 200, got {probe.status}"
    assert "text/html" in probe.content_type.lower(), (
        f"chat route Content-Type was {probe.content_type!r}; expected text/html shell"
    )
    # Body must be a library-mode shell — no clientLoader-derived content can appear
    # server-side. The strict contract is: no `dehydratedState` marker, no `useLoaderData`
    # serialization. DELIVER may inject a clientLoader marker that only appears post-hydration
    # (validated by a browser-level test); the SSR pass must be marker-free.
    assert "dehydratedState" not in probe.body, (
        "chat-bearing route's SSR response contains `dehydratedState` — implies a "
        "server loader ran, which violates DWD-3."
    )


# ───────────────────────────── ADR-015: presentation-state rule preserved ─────────────────────────────


@pytest.mark.needs_compose_stack
def test_presentation_state_rule_reaches_agent_directly(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """`/api/channels/:id/presentation-state` reaches `agent` directly per ADR-015 (preserved unchanged)."""
    probe = driver.get(
        "/api/channels/test-channel-id/presentation-state",
        accept="text/event-stream",
    )
    # Acceptable: SSE response (Content-Type text/event-stream), or agent's auth-failure
    # response (401/403). Unacceptable: text/html from web-ssr.
    assert "text/html" not in probe.content_type.lower(), (
        f"`/api/channels/:id/presentation-state` was served as text/html — "
        f"ADR-015 rule appears to have been clobbered. Content-Type: {probe.content_type!r}"
    )


@pytest.mark.needs_repo_post_mr0_state
def test_no_route_loader_fetches_presentation_state_directly(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """No `loader` export in `frontend/app/routes/*.tsx` fetches `/api/channels/.../presentation-state`."""
    # The check is structural: any loader making a server-side fetch to a URL containing
    # `/api/channels/` ... `/presentation-state` is a violation. The agent-direct nginx rule
    # is for client SSE consumers (per ADR-015), NOT for server-side prefetch.
    # Server-side presentation-state, if ever needed, routes through auth-proxy (ADR-031 §7).
    matches = driver.grep_repo(
        r"presentation-state",
        paths=["frontend/app/routes"],
    )
    # Allow the string to appear inside a `clientLoader` body (browser-only), but
    # NOT inside a server `loader` body. The check is approximate; if any match
    # exists, DELIVER must verify the context.
    offenders: list[str] = []
    for path, line_no, line in matches:
        # Pull the source and see if the line is inside a server `loader` block.
        source = driver.read_repo_text(str(path))
        # Find the start of the `export ... function loader` block, if any.
        loader_match = re.search(
            r"^export\s+(async\s+)?function\s+loader\b",
            source,
            re.MULTILINE,
        )
        if loader_match:
            # Coarse: if there's any `loader` export AND the line in question is
            # within the file, mark as suspect. DELIVER refines with proper AST
            # analysis if needed.
            offenders.append(f"{path}:{line_no}: {line.strip()}")
    if offenders:
        pytest.fail(
            f"found references to presentation-state inside route modules that "
            f"ALSO export a server `loader` — verify these are inside `clientLoader`, "
            f"not `loader`: {offenders!r}"
        )


# ───────────────────────────── Optional ESLint rule (DELIVER may add) ─────────────────────────────


@pytest.mark.skip(
    reason=(
        "DELIVER-deferred per DD-15: optional ESLint rule "
        "`no-loader-with-chat-import` not shipped in MR-2. DESIGN DWD-3 "
        "§How-to-apply item 3 named the rule as optional; DELIVER opts not "
        "to ship it. The contract scenario remains in the .feature SSOT as "
        "a placeholder for a future MR. See deliver/wave-decisions.md DD-15."
    ),
)
@pytest.mark.needs_repo_post_mr0_state
def test_optional_eslint_rule_flags_loader_co_located_with_chat_import(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """The optional `no-loader-with-chat-import` ESLint rule, if present, flags violations.

    The rule itself is optional per DESIGN (DWD-3 §"How to apply" item 3).
    When the rule is configured in `frontend/.eslintrc.*`, this scenario
    verifies it does what it says. When the rule is absent, the scenario
    skips.
    """
    # Look for the rule registration in the lint config.
    candidates = [
        "frontend/.eslintrc.js",
        "frontend/.eslintrc.cjs",
        "frontend/.eslintrc.json",
        "frontend/eslint.config.js",
        "frontend/eslint.config.mjs",
    ]
    rule_configured = False
    for relpath in candidates:
        if driver.path_exists(relpath):
            text = driver.read_repo_text(relpath)
            if "no-loader-with-chat-import" in text:
                rule_configured = True
                break
    if not rule_configured:
        pytest.skip(
            "optional rule `no-loader-with-chat-import` not configured — DESIGN "
            "deferred this. Re-enable scenario if DELIVER adds the rule."
        )
    # If the rule IS configured, DELIVER provides a fixture that runs eslint
    # against a known-violating test fixture and asserts the rule fires. DISTILL
    # fixes the contract; DELIVER fixes the harness.
    pytest.fail(
        "rule is configured; DELIVER provides the eslint-runner fixture. "
        "Contract: running `eslint` against a fixture that exports `loader` "
        "+ imports `ChatView` reports the rule at the loader line."
    )
