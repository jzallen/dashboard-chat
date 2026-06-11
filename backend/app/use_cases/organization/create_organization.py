"""Create organization use case."""

from typing import TYPE_CHECKING

from app.auth.exceptions import AuthorizationError
from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.organization.exceptions import OrganizationNameTakenError

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
    """Create a new organization, stamping the creating user as owner.

    Creates the local record only — the backend is a pure resource store that
    trusts auth-proxy's identity headers (ADR-048 §2). Identity-provider
    org/membership provisioning lives in auth-proxy, not here.

    No project is auto-created — first-project creation belongs solely to
    the project-context onboarding flow (org-onboarding D2).
    """
    _ensure_user_has_no_org(user)

    metadata_repo = repositories.metadata

    # Org names are globally unique. Reject a collision with a cheap point
    # lookup on the unique name index before creating; the unique constraint is
    # the DB backstop for the rare check-then-create race.
    if await metadata_repo.get_organization_by_name(name) is not None:
        raise OrganizationNameTakenError(f"Organization name '{name}' is already in use")

    org = await _create_org_record(name, user.id, metadata_repo)

    return {"org_id": org["id"], "org_name": org["name"]}


def _ensure_user_has_no_org(user) -> None:
    if user.org_id is not None:
        raise AuthorizationError("User already belongs to an organization")


async def _create_org_record(name, user_id, metadata_repo):
    """Create the local org record, stamping the creating user as owner."""
    return await metadata_repo.create_organization(name=name, created_by=user_id)
