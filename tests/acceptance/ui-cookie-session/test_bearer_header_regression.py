"""An existing header-based client still authenticates unchanged.

Gherkin: "An existing header-based client still authenticates unchanged".

Decisions: D9 (frontend/ untouched), D3 (header path preserved). This locks the
back-compat contract: the cookie migration must not regress the header path that
frontend/, PATs, and M2M clients depend on.

REGRESSION GUARD (not pending): green now AND after C1–C4. Today an authenticated
request with a Bearer header → 200; after the migration the header path is still
honoured first (D3), so still 200.

The dev sign-in body token stands in for "a token held by an existing header-based
client" — it is a real, verifiable user JWT exercised purely via the header, with
NO cookie present, which is exactly how frontend/ continues to operate.
"""

from __future__ import annotations

import pytest
from driver import CookieSessionDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.regression,
]


def test_header_only_request_still_authorizes(
    signed_in,
    driver: CookieSessionDriver,
) -> None:
    token = driver.body_token(signed_in)

    # Header credential only, NO cookie — the existing header-based client's path.
    result = driver.authed_probe(bearer=token)

    assert result.status == 200, (
        f"header-only authenticated request was {result.status}, expected 200 — "
        "the Bearer header path must keep working unchanged (D3/D9)"
    )
