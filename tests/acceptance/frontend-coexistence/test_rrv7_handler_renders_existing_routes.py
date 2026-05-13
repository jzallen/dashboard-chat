"""The RRv7 SSR handler renders existing (library-mode) routes — walking skeleton.

The simplest end-to-end probe: a browser request to `/` reaches
`web-ssr` via nginx, the RRv7 request handler matches the library-mode
route, and the response is a 200 text/html shell — a well-formed HTML5
document with `<div id="root">` plus the client `<Scripts>` bootstrap.
No `loader` runs server-side; the response is structurally what nginx's
pre-MR-0 `try_files index.html` produced.

This is the one scenario tagged `@walking_skeleton` per the nw-distill
skill mandate. DELIVER's first action in phase 01 (MR-0 plumbing) is
to remove the skip from this scenario and turn it GREEN.

Feature file (SSOT): `docs/feature/frontend-coexistence/distill/rrv7-handler-renders-existing-routes.feature`.
"""

from __future__ import annotations

import pytest

from driver import FrontendCoexistenceDriver

pytestmark = [
    pytest.mark.skip(
        reason="DISTILL: pending DELIVER phase 01 (MR-0 plumbing) per roadmap.json — walking skeleton is the first scenario DELIVER unpends",
    ),
    pytest.mark.real_io,
    pytest.mark.walking_skeleton,
    pytest.mark.slice_1,
    pytest.mark.needs_compose_stack,
]


def test_rrv7_handler_serves_html_shell_for_root_request(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """`/` returns a 200 text/html shell that bootstraps the SPA.

    Asserts:
      1. HTTP 200 + Content-Type contains text/html.
      2. Body is a well-formed HTML5 document (`<html>` root, `<body>`).
      3. Body contains the SPA mount point (`<div id="root">`).
      4. Body contains a `<script>` referencing the client bundle.
      5. Body does NOT contain a server-side error page or stack trace.
    """
    probe = driver.get("/")
    assert probe.status == 200, (
        f"expected 200 OK from `/` but got {probe.status}; body head: {probe.body[:500]!r}"
    )
    assert "text/html" in probe.content_type.lower(), (
        f"expected text/html Content-Type but got {probe.content_type!r}"
    )
    assert driver.response_is_html_shell(probe), (
        f"response body is not a well-formed HTML shell with #root + client script; "
        f"body head: {probe.body[:500]!r}"
    )
