"""ProjectsWithDatasetsQuery — query object for projects-with-dataset-summaries.

Ratifies ADR-025. Pure builder: produces a SQLAlchemy ``Select``; owns the
eager-load projection, default ordering, conditional filter assembly, and
has-more probe arithmetic. Does not own execution, mapping, or pagination
consumption.

Consumed by both ``ProjectRepository.list_projects`` (the ADR-020 per-aggregate
file) and the legacy ``MetadataRepository.list_projects`` facade, which proves
the abstraction is real duplication-elimination today, not speculative.
"""

from collections.abc import Callable
from functools import reduce
from typing import Self

from sqlalchemy import Select, select
from sqlalchemy.orm import selectinload

from app.utils.pagination import decode_cursor

from ..dataset_record import DatasetRecord
from ..project_record import ProjectRecord


class ProjectsWithDatasetsQuery:
    """Lists ProjectRecord rows with their dataset summaries.

    Owns:
        * Eager-load projection: datasets loaded via ``selectinload`` with a
          column-level ``load_only`` (id, name, description, project_id,
          schema_config) — the "dataset summary" shape.
        * Default ordering: ``ProjectRecord.id`` descending (UUIDv7 makes this
          chronological).
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
