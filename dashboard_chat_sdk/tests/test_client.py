"""Unit tests for the SDK that don't require a running backend.

The compose-runnable smoke test lives in scripts/sdk-smoke-test.py.
"""

from __future__ import annotations

import httpx
import pytest

from dashboard_chat_sdk import Client, __version__
from dashboard_chat_sdk._generated.api.projects import (
    create_project_api_projects_post,
    list_projects_api_projects_get,
)
from dashboard_chat_sdk._generated.models.project_create import ProjectCreate


def test_version_matches_pyproject() -> None:
    """v0.1.0 ships in this leaf per acceptance — guard against accidental bumps."""
    assert __version__ == "0.1.0"


def test_client_default_base_url_points_at_auth_proxy() -> None:
    c = Client(token="t")
    assert c.raw._base_url == "http://localhost:3000"


def test_client_injects_bearer_token_into_request() -> None:
    """The Client wrapper hands tokens to the generated AuthenticatedClient,
    which adds them as `Authorization: Bearer <token>` to every request."""
    c = Client(token="abc123", base_url="http://example.test")
    httpx_client = c.raw.get_httpx_client()
    assert httpx_client.headers.get("Authorization") == "Bearer abc123"


def test_client_context_manager_closes_underlying_httpx_client() -> None:
    with Client(token="t") as c:
        httpx_client = c.raw.get_httpx_client()
        assert isinstance(httpx_client, httpx.Client)
    # After __exit__, the underlying client is closed.
    assert httpx_client.is_closed


def test_create_project_request_kwargs_target_correct_path() -> None:
    """Smoke-check that codegen wired up the project endpoint as expected."""
    kwargs = create_project_api_projects_post._get_kwargs(  # type: ignore[attr-defined]
        body=ProjectCreate(name="sdk-test"),
    )
    assert kwargs["method"] == "post"
    assert kwargs["url"] == "/api/projects"
    assert kwargs["json"] == {"name": "sdk-test"}


def test_list_projects_request_kwargs_target_correct_path() -> None:
    kwargs = list_projects_api_projects_get._get_kwargs()  # type: ignore[attr-defined]
    assert kwargs["method"] == "get"
    assert kwargs["url"] == "/api/projects"


def test_project_create_round_trips_via_attrs_dict() -> None:
    src = ProjectCreate(name="sdk-test", description="hi")
    payload = src.to_dict()
    assert payload == {"name": "sdk-test", "description": "hi"}
    rebuilt = ProjectCreate.from_dict(payload)
    assert rebuilt.name == "sdk-test"
    assert rebuilt.description == "hi"


def test_project_create_omits_unset_fields() -> None:
    """Unset optional fields stay out of the JSON payload — the backend treats
    missing fields as defaults, so emitting nulls would be wrong."""
    payload = ProjectCreate(name="sdk-test").to_dict()
    assert payload == {"name": "sdk-test"}


@pytest.mark.parametrize(
    "token,expected",
    [
        ("dev-token-static", "Bearer dev-token-static"),
        ("eyJhbGciOiJSUzI1NiIs...", "Bearer eyJhbGciOiJSUzI1NiIs..."),
    ],
)
def test_client_bearer_format_works_for_all_token_shapes(token: str, expected: str) -> None:
    """Same shape works for dev-token-static, PATs, and M2M access_tokens —
    auth-proxy resolves all three to identity headers downstream."""
    c = Client(token=token)
    assert c.raw.get_httpx_client().headers.get("Authorization") == expected
