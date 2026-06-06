"""Get organization use case — assembles the full OrgSettings response.

The backend is a pure resource server with no user/membership table: the only
identity it sees is the current request's ``AuthUser`` (auth-proxy headers).
So ``members`` is self-only and ``plan``/``seats`` are static stubs. The real
configuration (``slug``/``region``/``defaults``) comes from the org record;
``slug`` falls back to a slugified ``name`` when the column is null.
"""

import re
from typing import TYPE_CHECKING, Any

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

# Static stubs — no billing domain exists (no plan/seat persistence). Emitted at
# the response boundary so a future billing context is an additive change.
_PLAN_STUB = "free"
_SEATS_STUB = 5


@handle_returns
@with_repositories
async def get_organization(
    user: AuthUser,
    *,
    repositories: "RepositoryContainer",
) -> dict | None:
    """Get the current user's org as a full OrgSettings response.

    Returns:
        OrgSettings dict (id + name/slug/region/plan/seats/used_seats/created_at
        + self-only members + defaults), or None if the user has no org / the
        org is not found.
    """
    if user.org_id is None:
        return None

    org = await repositories.metadata.get_organization(user.org_id)
    if org is None:
        return None

    return _to_org_settings(org, user)


def _to_org_settings(org: dict[str, Any], user: AuthUser) -> dict[str, Any]:
    """Assemble the OrgSettings response from the org record + current user."""
    members = [
        {
            "name": user.name or user.email,
            "email": user.email,
            "role": "owner",
        }
    ]
    return {
        "id": org["id"],
        "name": org["name"],
        "slug": org.get("slug") or _slugify(org["name"]),
        "region": org["region"],
        "plan": _PLAN_STUB,
        "seats": _SEATS_STUB,
        "used_seats": len(members),
        "created_at": org["created_at"],
        "members": members,
        "defaults": {
            "engine": org["default_engine"],
            "materialization": org["default_materialization"],
            "model_prefix": org["default_model_prefix"],
        },
    }


def _slugify(name: str) -> str:
    """Lowercase, hyphenate, and strip non-alphanumerics from an org name."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower())
    return slug.strip("-")
