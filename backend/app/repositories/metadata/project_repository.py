"""ProjectRepository — per-aggregate persistence for the Project aggregate.

Phase 00 of ADR-020 (metadata-repository split). Owns the 6 Project methods
that previously lived on the god-object ``MetadataRepository``. Behaviour is
preserved verbatim from ``repository.py``; the only change is module
location and class identity. The ``_LegacyMetadataFacade`` delegates Project
calls here so existing call sites continue to work via ``repositories.metadata``.
"""

from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy import exists, select

from . import _mappers
from ._base import handle_repository_exceptions
from ._pagination import paginate_by_id
from ._queries import ProjectsWithDatasetsQuery
from .project_record import ProjectRecord

if TYPE_CHECKING:
    from app.repositories import RestrictedSession


class ProjectRepositoryProtocol(Protocol):
    """Narrow protocol for Project persistence (ADR-020 step 2)."""

    async def list_projects(
        self,
        org_id: str | None = None,
        cursor: str | None = None,
        limit: int | None = 50,
    ) -> tuple[list[dict[str, Any]], str | None, bool]: ...

    async def get_project(self, project_id: str) -> dict[str, Any] | None: ...

    async def create_project(
        self,
        name: str,
        description: str | None = None,
        org_id: str | None = None,
        created_by: str | None = None,
    ) -> dict[str, Any]: ...

    async def update_project(
        self,
        project_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None: ...

    async def delete_project(self, project_id: str) -> bool: ...

    async def project_exists(self, project_id: str) -> bool: ...


class ProjectRepository:
    """SQLAlchemy implementation of ProjectRepositoryProtocol.

    Does NOT commit. Session commit/rollback is managed at the
    router/controller boundary via the ``with_repositories`` decorator.
    """

    def __init__(self, session: "RestrictedSession") -> None:
        self._session = session

    @handle_repository_exceptions
    async def list_projects(
        self,
        org_id: str | None = None,
        cursor: str | None = None,
        limit: int | None = 50,
    ) -> tuple[list[dict[str, Any]], str | None, bool]:
        """List projects ordered by ID desc (UUIDv7 = chronological).

        Returns (items, next_cursor, has_more). Pass limit=None for
        unpaginated results (internal callers).
        """
        query = (
            ProjectsWithDatasetsQuery()
            .with_org_scope(org_id)
            .with_cursor(cursor)
            .with_default_ordering()
            .with_limit_probe(limit)
            .compile()
        )
        result = await self._session.execute(query)
        projects, next_cursor, has_more = paginate_by_id(list(result.scalars().all()), limit)

        items = [
            {
                **_mappers.project_to_dict(p),
                "datasets": [_mappers.dataset_summary(ds) for ds in p.datasets],
            }
            for p in projects
        ]
        return items, next_cursor, has_more

    @handle_repository_exceptions
    async def get_project(self, project_id: str) -> dict[str, Any] | None:
        """Get a project by ID (metadata only, no datasets)."""
        result = await self._session.execute(select(ProjectRecord).where(ProjectRecord.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            return None
        return _mappers.project_to_dict(project)

    @handle_repository_exceptions
    async def create_project(
        self,
        name: str,
        description: str | None = None,
        org_id: str | None = None,
        created_by: str | None = None,
    ) -> dict[str, Any]:
        """Create a new project."""
        project = ProjectRecord(name=name, description=description, org_id=org_id, created_by=created_by)
        self._session.add(project)
        await self._session.flush()
        await self._session.refresh(project)
        return _mappers.project_to_dict(project)

    @handle_repository_exceptions
    async def update_project(
        self,
        project_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a project."""
        result = await self._session.execute(select(ProjectRecord).where(ProjectRecord.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            return None

        for key, value in update_data.items():
            setattr(project, key, value)

        await self._session.flush()
        await self._session.refresh(project)
        return _mappers.project_to_dict(project)

    @handle_repository_exceptions
    async def delete_project(self, project_id: str) -> bool:
        """Delete a project and all its datasets."""
        result = await self._session.execute(select(ProjectRecord).where(ProjectRecord.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            return False

        await self._session.delete(project)
        await self._session.flush()
        return True

    @handle_repository_exceptions
    async def project_exists(self, project_id: str) -> bool:
        """Check if a project exists."""
        return (await self._session.execute(select(exists().where(ProjectRecord.id == project_id)))).scalar()
