"""Characterization tests — Seam 4: Organization controller.

Pins the CURRENT observable behavior of HTTPController.post_organization and
get_my_organization (L326-344). These tests must remain green after extraction
to `organization_controller.py`.

No existing coverage in test_http_controller.py — everything here is new.

Special attention: `get_my_organization` has THREE branches (L339-344):
  - Success(data) where data is not None  -> 200 envelope
  - Success(data) where data is None      -> bespoke 404 envelope (NOT via _error_response)
  - Failure(error)                         -> _error_response dispatch
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController
from app.use_cases.organization.exceptions import ExternalServiceError


@dataclass
class _Model:
    id: str
    name: str = "Org"

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# post_organization (L326-333)
# ---------------------------------------------------------------------------


class TestPostOrganizationCharacterization:
    @patch("app.controllers.http_controller.organization_use_cases")
    async def test_success_returns_201_with_envelope(self, mock_uc):
        mock_uc.create_organization = AsyncMock(
            return_value=Success(_Model("org-1", "Acme"))
        )
        body, status = await HTTPController.post_organization(
            "Acme", user="USER_SENTINEL"
        )
        assert status == 201
        assert body["data"]["type"] == "organizations"
        assert body["data"]["id"] == "org-1"
        assert body["data"]["attributes"]["name"] == "Acme"
        assert body["links"]["self"] == "/api/organizations/org-1"

    @patch("app.controllers.http_controller.organization_use_cases")
    async def test_forwards_name_and_user(self, mock_uc):
        mock_uc.create_organization = AsyncMock(
            return_value=Success(_Model("org-1", "X"))
        )
        await HTTPController.post_organization("X", user="USER_SENTINEL")
        mock_uc.create_organization.assert_awaited_once_with(
            name="X", user="USER_SENTINEL"
        )

    @patch("app.controllers.http_controller.organization_use_cases")
    async def test_failure_returns_mapped_status(self, mock_uc):
        mock_uc.create_organization = AsyncMock(
            return_value=Failure(ExternalServiceError("workos down"))
        )
        _, status = await HTTPController.post_organization("X", user="U")
        assert status == 502


# ---------------------------------------------------------------------------
# get_my_organization (L335-344) — three-branch match
# ---------------------------------------------------------------------------


class TestGetMyOrganizationCharacterization:
    @patch("app.controllers.http_controller.organization_use_cases")
    async def test_success_with_data_returns_200(self, mock_uc):
        mock_uc.get_organization = AsyncMock(
            return_value=Success({"id": "org-1", "name": "Acme"})
        )
        body, status = await HTTPController.get_my_organization(user="U")
        assert status == 200
        assert body["data"]["type"] == "organizations"
        assert body["data"]["id"] == "org-1"
        assert body["links"]["self"] == "/api/organizations/me"

    @patch("app.controllers.http_controller.organization_use_cases")
    async def test_success_with_none_returns_bespoke_404(self, mock_uc):
        """L341-342: `case Success(): return {'errors': [{'status': '404', ...}]}, 404`.
        This is a BESPOKE 404 envelope — NOT the standard _error_response shape.
        It only has `status` and `title`, no `detail` key. Pin this verbatim."""
        mock_uc.get_organization = AsyncMock(return_value=Success(None))
        body, status = await HTTPController.get_my_organization(user="U")
        assert status == 404
        assert body == {
            "errors": [{"status": "404", "title": "Organization not found"}]
        }

    @patch("app.controllers.http_controller.organization_use_cases")
    async def test_failure_routes_through_error_response(self, mock_uc):
        mock_uc.get_organization = AsyncMock(
            return_value=Failure(ExternalServiceError("upstream"))
        )
        _, status = await HTTPController.get_my_organization(user="U")
        assert status == 502

    @patch("app.controllers.http_controller.organization_use_cases")
    async def test_forwards_user(self, mock_uc):
        mock_uc.get_organization = AsyncMock(return_value=Success(None))
        await HTTPController.get_my_organization(user="USER_SENTINEL")
        mock_uc.get_organization.assert_awaited_once_with(user="USER_SENTINEL")
