"""Check organization name availability use case (CDO-S2, ADR-050 §b).

Supporting affordance (ADR-048 layer A) for the CDO-S5 auth-proxy interception:
a thin read over the existing unique-name point lookup. A name is available iff
no organization row already carries it.
"""

from typing import TYPE_CHECKING

from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def check_org_name_availability(
    name: str,
    *,
    repositories: "RepositoryContainer",
) -> dict:
    """Return whether ``name`` is free to claim as an organization name.

    Org names are globally unique, so availability is exactly the absence of a
    row on the unique name index (the same lookup create_organization uses to
    reject a collision before insert).
    """
    return {"available": await repositories.metadata.get_organization_by_name(name) is None}
