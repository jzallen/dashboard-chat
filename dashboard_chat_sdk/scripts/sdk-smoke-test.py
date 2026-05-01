"""End-to-end smoke test for dashboard_chat_sdk against a compose-dev stack.

Mirrors the FastAPI-emitted half of the flow in
`docs/guides/headless-tokens.md`:

    1. authenticate (dev-token-static — PAT/M2M minting is not yet covered
       by the SDK, see sibling beads H.4/H.5),
    2. create a project,
    3. list projects, assert the new one is present,
    4. list session events for an unknown session (asserts the SDK can call
       the replay endpoint and parse a 404 — the path is exercised even if
       no chat turn produced events).

Run from a clean checkout::

    docker compose up -d
    pip install -e ./dashboard_chat_sdk
    python dashboard_chat_sdk/scripts/sdk-smoke-test.py

Environment overrides::

    DASHBOARD_CHAT_BASE_URL  default: http://localhost:3000
    DASHBOARD_CHAT_TOKEN     default: dev-token-static
"""

from __future__ import annotations

import os
import sys
import uuid

from dashboard_chat_sdk import Client
from dashboard_chat_sdk._generated.api.projects import (
    create_project_api_projects_post,
    list_projects_api_projects_get,
)
from dashboard_chat_sdk._generated.api.session_replay import (
    list_session_events_api_sessions_session_id_events_get,
)
from dashboard_chat_sdk._generated.errors import UnexpectedStatus
from dashboard_chat_sdk._generated.models.project_create import ProjectCreate

BASE_URL = os.environ.get("DASHBOARD_CHAT_BASE_URL", "http://localhost:3000")
TOKEN = os.environ.get("DASHBOARD_CHAT_TOKEN", "dev-token-static")


def _step(label: str) -> None:
    print(f"==> {label}", flush=True)


def main() -> int:
    project_name = f"sdk-smoke-{uuid.uuid4().hex[:8]}"

    with Client(token=TOKEN, base_url=BASE_URL) as client:
        _step(f"creating project {project_name!r}")
        created = create_project_api_projects_post.sync(
            client=client.raw,
            body=ProjectCreate(name=project_name, description="created by sdk-smoke-test"),
        )
        if created is None:
            print("FAIL: create_project returned None", file=sys.stderr)
            return 1
        # The FastAPI handler returns dict; the codegen models that as `Any`,
        # so we read the id by key rather than by attribute.
        created_id = created.get("id") if isinstance(created, dict) else None
        if not isinstance(created_id, str):
            print(f"FAIL: create_project response missing id: {created!r}", file=sys.stderr)
            return 1
        print(f"    created id={created_id}")

        _step("listing projects")
        listing = list_projects_api_projects_get.sync(client=client.raw)
        if listing is None or not isinstance(listing, dict):
            print(f"FAIL: list_projects returned {listing!r}", file=sys.stderr)
            return 1
        items = listing.get("items") if isinstance(listing, dict) else None
        if not isinstance(items, list):
            print(f"FAIL: list_projects response missing items: {listing!r}", file=sys.stderr)
            return 1
        names = [p.get("name") for p in items if isinstance(p, dict)]
        if project_name not in names:
            print(
                f"FAIL: created project {project_name!r} not in listing {names!r}",
                file=sys.stderr,
            )
            return 1
        print(f"    listing contains {project_name!r} ({len(items)} total)")

        _step("listing events for an unknown session (expects 404)")
        try:
            list_session_events_api_sessions_session_id_events_get.sync(
                client=client.raw,
                session_id=str(uuid.uuid4()),
            )
        except UnexpectedStatus as exc:
            if exc.status_code != 404:
                print(
                    f"FAIL: unexpected status {exc.status_code} from session replay",
                    file=sys.stderr,
                )
                return 1
            print("    got 404 as expected")
        else:
            print("FAIL: session replay should have raised on unknown session", file=sys.stderr)
            return 1

    print("\nSDK smoke test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
