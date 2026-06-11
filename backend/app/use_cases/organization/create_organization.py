"""Create organization use case."""

from typing import TYPE_CHECKING

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

    The new org's id is the caller's org claim (``user.org_id`` ← ``X-Org-Id``,
    resolved gated on ``trust_proxy_headers``): in workos mode the auth-proxy
    sets ``X-Org-Id`` to the freshly-provisioned WorkOS org id on the
    create-route forward — the WorkOS org id IS the local org id (ADR-050 §b).
    Absent/None (dev, non-intercepted traffic) → backend-generated id.

    There is no "user already has an org" guard: a create request by definition
    persists the user's (new) org, so there is no prior org to reject against.
    Uniqueness is enforced by the global org-name index
    (``OrganizationNameTakenError`` → 409) and the org-id primary key.

    No project is auto-created — first-project creation belongs solely to the
    project-context onboarding flow (org-onboarding D2).
    """
    metadata_repo = repositories.metadata

    # Org names are globally unique. Reject a collision with a cheap point
    # lookup on the unique name index before creating; the unique constraint is
    # the DB backstop for the rare check-then-create race.
    if await metadata_repo.get_organization_by_name(name) is not None:
        raise OrganizationNameTakenError(f"Organization name '{name}' is already in use")

    org = await _create_org_record(name, user.id, metadata_repo, user.org_id)

    return {"org_id": org["id"], "org_name": org["name"]}


async def _create_org_record(name, user_id, metadata_repo, org_id=None):
    """Create the local org record, stamping the creating user as owner.

    When ``org_id`` is supplied (the trust-gated org claim — the WorkOS org id
    in workos mode), it is used verbatim as the row ``id``, preserving the rule
    that the WorkOS org id IS the local org id (ADR-050 §b). Absent →
    backend-generated id.
    """
    return await metadata_repo.create_organization(name=name, id=org_id, created_by=user_id)
