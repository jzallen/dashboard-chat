"""Create organization use case."""

from typing import TYPE_CHECKING

import httpx

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.config import get_settings
from app.use_cases import handle_returns
from app.repositories import with_repositories

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def create_organization(
    name: str,
    *,
    repositories: 'RepositoryContainer',
) -> dict:
    """Create a new organization and a default project.

    For WorkOS mode: creates org in WorkOS, links user via membership, then
    creates local records. Returns requires_reauth=True so the frontend
    can re-trigger login for a fresh token with org_id.

    For dev mode: creates local records only.

    Raises:
        AuthorizationError: If user already has an org.
    """
    user = get_auth_user()
    if user.org_id is not None:
        raise AuthorizationError("User already belongs to an organization")

    metadata_repo = repositories['metadata_repository']
    settings = get_settings()

    if settings.auth_mode == "workos":
        org_id, requires_reauth = await _create_workos_org(
            name=name,
            user_id=user.id,
            api_key=settings.workos_api_key,
        )
        # WorkOS provides the org_id — pass it explicitly
        org = await metadata_repo.create_organization(name=name, id=org_id)
    else:
        requires_reauth = False
        # Let the database generate the ID via server_default
        org = await metadata_repo.create_organization(name=name)

    org_id = org["id"]

    # Create default project for the new org
    await metadata_repo.create_project(
        name="My First Project",
        org_id=org_id,
        created_by=user.id,
    )

    result = {"org_id": org_id, "org_name": org["name"]}
    if requires_reauth:
        result["requires_reauth"] = True

    return result


async def _create_workos_org(
    name: str,
    user_id: str,
    api_key: str,
) -> tuple[str, bool]:
    """Create an org in WorkOS and link the user to it.

    Returns:
        Tuple of (org_id, requires_reauth).
    """
    headers = {"Authorization": f"Bearer {api_key}"}

    async with httpx.AsyncClient() as client:
        # Create the organization
        resp = await client.post(
            "https://api.workos.com/organizations",
            json={"name": name},
            headers=headers,
        )
        resp.raise_for_status()
        org_data = resp.json()
        org_id = org_data["id"]

        # Create organization membership for the user
        membership_resp = await client.post(
            "https://api.workos.com/user_management/organization_memberships",
            json={"user_id": user_id, "organization_id": org_id},
            headers=headers,
        )
        membership_resp.raise_for_status()

    return org_id, True
