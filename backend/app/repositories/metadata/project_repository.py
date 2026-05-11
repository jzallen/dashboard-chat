"""ProjectRepository — per-aggregate persistence for the Project aggregate.

Phase 00 of ADR-020 (metadata-repository split). Owns the 6 Project methods
that previously lived on the god-object ``MetadataRepository``. Behaviour is
preserved verbatim from ``repository.py``; the only change is module
location and class identity. The ``_LegacyMetadataFacade`` delegates Project
calls here so existing call sites continue to work via ``repositories.metadata``.
"""

from collections.abc import Callable
from functools import reduce
from typing import TYPE_CHECKING, Any, Protocol, Self

from sqlalchemy import Select, exists, select
from sqlalchemy.orm import selectinload

from app.utils.pagination import decode_cursor

from . import _mappers
from ._base import handle_repository_exceptions
from ._pagination import paginate_by_id
from .dataset_record import DatasetRecord
from .project_record import ProjectRecord

if TYPE_CHECKING:
    from app.repositories import RestrictedSession


class ProjectsWithDatasetsQuery:
    """Query object for the projects-with-dataset-summaries read model.

    Ratifies ADR-025. Pure builder: produces a SQLAlchemy ``Select``; owns
    the eager-load projection, default ordering, conditional filter
    assembly, and has-more probe arithmetic. Does not own execution,
    mapping, or pagination consumption.

    Co-located with ``ProjectRepository`` per ADR-025's location rule
    ("co-locate when the aggregate has one query class; extract to a
    ``_queries/`` subpackage when the second arrives"). Consumed by both
    ``ProjectRepository.list_projects`` here and the legacy
    ``MetadataRepository.list_projects`` facade.

    Owns:
        * Eager-load projection: datasets loaded via ``selectinload`` with
          a column-level ``load_only`` (id, name, description, project_id,
          schema_config) — the "dataset summary" shape.
        * Default ordering: ``ProjectRecord.id`` descending (UUIDv7 makes
          this chronological).
        * Conditional org-scope filter (no-op when ``org_id`` is None).
        * Conditional keyset-cursor filter (no-op when ``cursor`` is None;
          decoded via ``decode_cursor`` — may raise ``InvalidCursor``).
        * Has-more probe via ``limit + 1`` (no-op when ``limit`` is None).

    Does NOT own:
        * Execution. Callers run ``await session.execute(query.compile())``.
        * Result mapping (``_mappers.project_to_dict`` / ``dataset_summary``).
        * Pagination slice/encode (``paginate_by_id`` in ``_pagination.py``).
        * ``MetadataRepositoryError`` wrapping (``@handle_repository_exceptions``
          stays on the repository method).
    """

    def __init__(self) -> None:
        self._steps: list[Callable[[Select], Select]] = []

    def with_org_scope(self, org_id: str | None) -> Self:
        """Restrict to ``org_id`` when provided; no-op when ``None``."""
        if org_id is not None:
            self._steps.append(lambda q: q.where(ProjectRecord.org_id == org_id))
        return self

    def with_cursor(self, cursor: str | None) -> Self:
        """Apply a keyset cursor when provided; no-op when ``None``.

        Decodes the base64url cursor via ``decode_cursor``; raises
        ``InvalidCursor`` for malformed input.
        """
        if cursor is not None:
            cursor_id = decode_cursor(cursor)
            self._steps.append(lambda q: q.where(ProjectRecord.id < cursor_id))
        return self

    def with_default_ordering(self) -> Self:
        """Apply ``ORDER BY id DESC`` — UUIDv7 makes this chronological."""
        self._steps.append(lambda q: q.order_by(ProjectRecord.id.desc()))
        return self

    def with_limit_probe(self, limit: int | None) -> Self:
        """Apply ``LIMIT limit + 1`` for has-more probe; no-op when ``None``.

        Callers fetch ``limit + 1`` rows and pass the result through
        ``paginate_by_id`` for the slice + next-cursor encode.
        """
        if limit is not None:
            self._steps.append(lambda q: q.limit(limit + 1))
        return self

    def compile(self) -> Select:
        """Fold the accumulated steps over the base projection."""
        base: Select = select(ProjectRecord).options(
            selectinload(ProjectRecord.datasets).load_only(
                DatasetRecord.id,
                DatasetRecord.name,
                DatasetRecord.description,
                DatasetRecord.project_id,
                DatasetRecord.schema_config,
            )
        )
        return reduce(lambda q, step: step(q), self._steps, base)


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
