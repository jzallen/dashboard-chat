"""Create organization use case."""

from typing import TYPE_CHECKING

import httpx

from app.auth.exceptions import AuthorizationError
from app.auth.types import AuthUser
from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.organization.exceptions import (
    ExternalServiceError,
    OrganizationNameTakenError,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def create_organization(
    name: str,
    user: AuthUser,
    *,
    repositories: "RepositoryContainer",
) -> dict:
    """Create a new organization and a default project.

    For WorkOS mode: creates org in WorkOS, links user via membership, then
    creates local records. Returns requires_reauth=True so the frontend
    can re-trigger login for a fresh token with org_id.

    For dev mode: creates local records only.
    """
    _ensure_user_has_no_org(user)

    metadata_repo = repositories.metadata
    settings = get_settings()

    # Org names are globally unique. Reject a collision with a cheap point
    # lookup on the unique name index before creating; the unique constraint is
    # the DB backstop for the rare check-then-create race.
    if await metadata_repo.get_organization_by_name(name) is not None:
        raise OrganizationNameTakenError(f"Organization name '{name}' is already in use")

    org, requires_reauth = await _create_org_record(name, user.id, metadata_repo, settings)
    org_id = org["id"]

    await metadata_repo.create_project(
        name="My First Project",
        org_id=org_id,
        created_by=user.id,
    )

    result = {"org_id": org_id, "org_name": org["name"]}
    if requires_reauth:
        result["requires_reauth"] = True

    return result


def _ensure_user_has_no_org(user) -> None:
    if user.org_id is not None:
        raise AuthorizationError("User already belongs to an organization")


async def _create_org_record(name, user_id, metadata_repo, settings):
    """Create org via WorkOS or locally depending on auth mode.

    Returns:
        Tuple of (org_dict, requires_reauth).
    """
    if settings.auth_mode == "workos":
        org_id, requires_reauth = await _create_workos_org(
            name=name,
            user_id=user_id,
            api_key=settings.workos_api_key,
            api_url=settings.workos_api_url,
        )
        org = await metadata_repo.create_organization(name=name, id=org_id)
    else:
        requires_reauth = False
        org = await metadata_repo.create_organization(name=name)
    return org, requires_reauth


async def _create_workos_org(
    name: str,
    user_id: str,
    api_key: str,
    api_url: str,
) -> tuple[str, bool]:
    """Create an org in WorkOS and link the user to it.

    Returns:
        Tuple of (org_id, requires_reauth).
    """
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{api_url}/organizations",
                json={"name": name},
                headers=headers,
            )
            resp.raise_for_status()
            org_data = resp.json()
            org_id = org_data["id"]

            membership_resp = await client.post(
                f"{api_url}/user_management/organization_memberships",
                json={"user_id": user_id, "organization_id": org_id},
                headers=headers,
            )
            membership_resp.raise_for_status()
        return org_id, True
    except httpx.HTTPStatusError as e:
        raise ExternalServiceError(f"WorkOS API error: {e.response.status_code}") from e
    except httpx.RequestError as e:
        raise ExternalServiceError(f"WorkOS API request failed: {e!s}") from e
