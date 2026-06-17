"""Transitional facade preserving the ``repositories.metadata`` surface (ADR-020).

Phase 00 of the metadata-repository split. The facade composes the new
``ProjectRepository`` for Project methods and the unsplit ``MetadataRepository``
for everything else, so existing call sites continue to work unchanged while
new code can migrate to ``repositories.projects``. Phases 01-03 progressively
move the remaining aggregates here and eventually delete the facade entirely.

Emits ``DeprecationWarning`` on construction (= first ``.metadata`` access)
naming the new container properties, per ADR-020 §Decision outcome step 5.
"""

from __future__ import annotations

import warnings
from typing import TYPE_CHECKING, Any

from .project_repository import ProjectRepository
from .repository import MetadataRepository

if TYPE_CHECKING:
    from app.repositories import RestrictedSession as _RestrictedSession


_DEPRECATION_MESSAGE = (
    "RepositoryContainer.metadata (and the 'metadata_repository' container key) "
    "is deprecated and will be removed once ADR-020 Phase 03 lands. Use the "
    "per-aggregate container properties instead: .projects (Phase 00); .datasets, "
    ".transforms, .sessions, .views, .reports, .organizations, .project_memories "
    "(Phase 01)."
)


class _LegacyMetadataFacade:
    """Delegating shim that preserves the legacy ``MetadataRepository`` surface.

    Project methods route to the new :class:`ProjectRepository`; every other
    attribute falls through to an internal :class:`MetadataRepository` bound
    to the same session. Both repositories share the caller's
    ``RestrictedSession`` so all writes land in the same transaction.
    """

    def __init__(self, session: _RestrictedSession) -> None:
        warnings.warn(_DEPRECATION_MESSAGE, DeprecationWarning, stacklevel=2)
        self._projects = ProjectRepository(session)
        self._inner = MetadataRepository(session)

    # -- Project delegations (Phase 00) --------------------------------------

    async def list_projects(
        self,
        org_id: str | None = None,
        cursor: str | None = None,
        limit: int | None = 50,
    ) -> tuple[list[dict[str, Any]], str | None, bool]:
        return await self._projects.list_projects(org_id=org_id, cursor=cursor, limit=limit)

    async def get_project(self, project_id: str, org_id: str | None = None) -> dict[str, Any] | None:
        return await self._projects.get_project(project_id, org_id=org_id)

    async def create_project(
        self,
        name: str,
        description: str | None = None,
        org_id: str | None = None,
        created_by: str | None = None,
    ) -> dict[str, Any]:
        return await self._projects.create_project(
            name=name,
            description=description,
            org_id=org_id,
            created_by=created_by,
        )

    async def update_project(
        self,
        project_id: str,
        update_data: dict[str, Any],
        org_id: str | None = None,
    ) -> dict[str, Any] | None:
        return await self._projects.update_project(project_id, update_data, org_id=org_id)

    async def delete_project(self, project_id: str, org_id: str | None = None) -> bool:
        return await self._projects.delete_project(project_id, org_id=org_id)

    async def project_exists(self, project_id: str, org_id: str | None = None) -> bool:
        return await self._projects.project_exists(project_id, org_id=org_id)

    # -- Pass-through for the seven unsplit aggregates -----------------------

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)
