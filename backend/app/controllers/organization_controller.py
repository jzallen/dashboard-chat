"""Organization HTTP controller — Seam 4 of dc-e65d.

Thin HTTP adapter for the Identity / Organization bounded context. Delegates
to use cases under `app/use_cases/organization`.

Use-case module access:
    The `organization_use_cases` alias is read off `app.controllers.http_controller`
    at call time (not imported here directly) so that existing test patches on
    `app.controllers.http_controller.organization_use_cases` continue to intercept
    the use-case calls. See seams.md Seam 8 "Test preservation".
"""

from typing import TYPE_CHECKING

from returns.result import Failure, Success

from ._result_mapper import error_response
from .response_wrapper import wrap_jsonapi_single

if TYPE_CHECKING:
    from app.auth.types import AuthUser


def _uc():
    """Late-bind the organization_use_cases module off http_controller.

    Keeps test patches on `app.controllers.http_controller.organization_use_cases`
    effective after this extraction.
    """
    from app.controllers import http_controller

    return http_controller.organization_use_cases


class OrganizationController:
    """Controller for Organization aggregate HTTP endpoints."""

    @staticmethod
    async def post_organization(name: str, user: "AuthUser", provisioned_org_id: str | None = None) -> tuple[dict, int]:
        result = await _uc().create_organization(name=name, user=user, provisioned_org_id=provisioned_org_id)
        match result:
            case Success(data):
                # The use case returns {"org_id", "org_name"}; map it to the
                # JSON:API resource shape (id, attributes.name). See DUI-3.
                org_id = data["org_id"]
                organization = {"id": org_id, "name": data["org_name"]}
                return (
                    wrap_jsonapi_single("organizations", organization, f"/api/organizations/{org_id}"),
                    201,
                )
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_my_organization(user: "AuthUser") -> tuple[dict, int]:
        result = await _uc().get_organization(user=user)
        match result:
            case Success(data) if data is not None:
                return wrap_jsonapi_single("organizations", data, "/api/organizations/me"), 200
            case Success():
                return {"errors": [{"status": "404", "title": "Organization not found"}]}, 404
            case Failure(error):
                return error_response(error)
