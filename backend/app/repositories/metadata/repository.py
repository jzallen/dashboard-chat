"""MetadataRepository - SQLAlchemy implementation for metadata persistence.

Covers all control-plane aggregates: projects, project memories, sessions,
datasets, transforms, organizations, views, and reports.

Session lifecycle (commit/rollback) is managed at the edge (routers/controllers).
This repository uses flush() to persist changes within the transaction.
"""

import base64
import json
from collections.abc import Callable
from datetime import datetime
from functools import wraps
from typing import TYPE_CHECKING, Any, ParamSpec, TypeVar

from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import joinedload, selectinload

from app.utils.pagination import decode_cursor
from app.utils.sql_safety import validate_condition_sql

from ..exceptions import MetadataRepositoryError
from . import _mappers
from ._pagination import paginate_by_id, paginate_composite
from ._queries import ProjectsWithDatasetsQuery
from .dataset_record import DatasetRecord
from .organization_record import OrganizationRecord
from .project_memory_record import ProjectMemoryRecord
from .project_record import ProjectRecord
from .report_record import ReportRecord
from .session_record import SessionRecord
from .transform_record import TransformRecord
from .view_record import ViewRecord

if TYPE_CHECKING:
    from app.repositories import RestrictedSession

P = ParamSpec("P")
R = TypeVar("R")


def handle_repository_exceptions(func: Callable[P, R]) -> Callable[P, R]:
    """Decorator that wraps SQLAlchemyError as MetadataRepositoryError."""

    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return await func(*args, **kwargs)
        except SQLAlchemyError as e:
            raise MetadataRepositoryError(str(e)) from e

    return wrapper


class MetadataRepository:
    """SQLAlchemy implementation of MetadataRepositoryProtocol.

    Handles metadata database operations for projects, project memories,
    sessions, datasets, transforms, organizations, views, and reports.

    Note: This repository does NOT commit. Session commit/rollback is managed
    at the router/controller level to ensure transactional consistency.
    """

    def __init__(self, session: "RestrictedSession") -> None:
        """Initialize with restricted session.

        Args:
            session: RestrictedSession (only exposes execute/add/flush/refresh/delete)
        """
        self._session = session

    # -------------------------------------------------------------------------
    # Project operations
    # -------------------------------------------------------------------------

    @handle_repository_exceptions
    async def list_projects(
        self,
        org_id: str | None = None,
        cursor: str | None = None,
        limit: int | None = 50,
    ) -> tuple[list[dict[str, Any]], str | None, bool]:
        """List projects ordered by ID desc (UUIDv7 = chronological).

        Returns (items, next_cursor, has_more).
        Pass limit=None for unpaginated results (internal callers).
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
    async def get_project(
        self,
        project_id: str,
    ) -> dict[str, Any] | None:
        """Get a project by ID (metadata only, no datasets)."""
        query = select(ProjectRecord).where(ProjectRecord.id == project_id)

        result = await self._session.execute(query)
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

    # -------------------------------------------------------------------------
    # Project memory operations
    # -------------------------------------------------------------------------

    @handle_repository_exceptions
    async def get_project_memory(self, project_id: str) -> dict[str, Any] | None:
        """Get the memory for a project."""
        result = await self._session.execute(
            select(ProjectMemoryRecord).where(ProjectMemoryRecord.project_id == project_id)
        )
        memory = result.scalar_one_or_none()
        if not memory:
            return None
        return _mappers.memory_to_dict(memory)

    @handle_repository_exceptions
    async def create_project_memory(
        self,
        project_id: str,
        org_id: str,
        stream_channel_id: str,
    ) -> dict[str, Any]:
        """Create a project memory mapping."""
        memory = ProjectMemoryRecord(
            project_id=project_id,
            org_id=org_id,
            stream_channel_id=stream_channel_id,
        )
        self._session.add(memory)
        await self._session.flush()
        await self._session.refresh(memory)
        return _mappers.memory_to_dict(memory)

    # -------------------------------------------------------------------------
    # Session operations
    # -------------------------------------------------------------------------

    @handle_repository_exceptions
    async def create_session(
        self,
        memory_id: str,
        stream_thread_id: str,
        owner_id: str,
        org_id: str,
        title: str | None = None,
    ) -> dict[str, Any]:
        """Create a new session (Stream thread) within a memory."""
        session = SessionRecord(
            memory_id=memory_id,
            stream_thread_id=stream_thread_id,
            owner_id=owner_id,
            org_id=org_id,
            title=title,
        )
        self._session.add(session)
        await self._session.flush()
        await self._session.refresh(session)
        return _mappers.session_to_dict(session)

    @staticmethod
    def _encode_session_cursor(session: "SessionRecord") -> str:
        """Encode a (last_active_at, id) composite cursor for session pagination."""
        payload = json.dumps(
            {
                "id": session.id,
                "last_active_at": session.last_active_at.isoformat(),
            }
        )
        return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

    @staticmethod
    def _decode_session_cursor(cursor: str) -> tuple[str, str]:
        """Decode a composite session cursor. Returns (last_active_at_iso, id)."""
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = base64.urlsafe_b64decode(padded.encode()).decode()
        data = json.loads(payload)
        return data["last_active_at"], data["id"]

    @handle_repository_exceptions
    async def list_sessions(
        self,
        memory_id: str,
        org_id: str,
        cursor: str | None = None,
        limit: int = 30,
    ) -> tuple[list[dict[str, Any]], str | None, bool]:
        """List sessions for a memory, ordered by last_active_at desc."""
        query = select(SessionRecord).where(
            SessionRecord.memory_id == memory_id,
            SessionRecord.org_id == org_id,
        )
        if cursor is not None:
            last_active_iso, cursor_id = self._decode_session_cursor(cursor)
            cursor_ts = datetime.fromisoformat(last_active_iso)
            # Composite keyset: skip rows with same (last_active_at, id) as cursor
            query = query.where(
                or_(
                    SessionRecord.last_active_at < cursor_ts,
                    and_(
                        SessionRecord.last_active_at == cursor_ts,
                        SessionRecord.id < cursor_id,
                    ),
                )
            )
        query = query.order_by(SessionRecord.last_active_at.desc(), SessionRecord.id.desc())
        query = query.limit(limit + 1)

        result = await self._session.execute(query)
        sessions, next_cursor, has_more = paginate_composite(
            list(result.scalars().all()),
            limit,
            self._encode_session_cursor,
        )

        return [_mappers.session_to_dict(s) for s in sessions], next_cursor, has_more

    @handle_repository_exceptions
    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        """Get a session by ID."""
        result = await self._session.execute(select(SessionRecord).where(SessionRecord.id == session_id))
        session = result.scalar_one_or_none()
        if not session:
            return None
        return _mappers.session_to_dict(session)

    @handle_repository_exceptions
    async def update_session(
        self,
        session_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a session's metadata."""
        result = await self._session.execute(select(SessionRecord).where(SessionRecord.id == session_id))
        session = result.scalar_one_or_none()
        if not session:
            return None

        for key, value in update_data.items():
            setattr(session, key, value)

        await self._session.flush()
        await self._session.refresh(session)
        return _mappers.session_to_dict(session)

    # -------------------------------------------------------------------------
    # Dataset operations
    # -------------------------------------------------------------------------

    @handle_repository_exceptions
    async def list_datasets(
        self,
        project_id: str | None = None,
        include_transforms: bool = True,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[DatasetRecord], str | None, bool]:
        """List datasets, optionally filtered by project.

        Always returns (records, next_cursor, has_more) tuple.
        When limit is None, returns all records with next_cursor=None, has_more=False.
        """
        query = select(DatasetRecord).where(DatasetRecord.project_id == project_id)

        if include_transforms:
            query = query.options(selectinload(DatasetRecord.transforms.and_(TransformRecord.status != "deleted")))

        if cursor is not None:
            query = query.where(DatasetRecord.id < decode_cursor(cursor))

        query = query.order_by(DatasetRecord.id.desc())

        if limit is not None:
            query = query.limit(limit + 1)

        result = await self._session.execute(query)
        return paginate_by_id(list(result.scalars().all()), limit)

    @handle_repository_exceptions
    async def get_dataset(
        self,
        dataset_id: str,
        include_transforms: bool = True,
    ) -> dict[str, Any] | None:
        """Get a dataset by ID with optional transforms."""
        dataset = await self.get_dataset_record(dataset_id, include_transforms)

        if not dataset:
            return None

        dataset_dict = _mappers.dataset_to_dict(dataset)

        if include_transforms:
            dataset_dict["transforms"] = [_mappers.transform_to_dict(t) for t in dataset.transforms]

        return dataset_dict

    @handle_repository_exceptions
    async def get_dataset_record(
        self,
        dataset_id: str,
        include_transforms: bool = True,
    ) -> DatasetRecord | None:
        """Get a dataset record by ID with optional transforms.

        Returns the ORM record for domain model conversion.
        """
        query = select(DatasetRecord).where(DatasetRecord.id == dataset_id)
        query = query.options(joinedload(DatasetRecord.project))

        if include_transforms:
            query = query.options(joinedload(DatasetRecord.transforms.and_(TransformRecord.status != "deleted")))

        result = await self._session.execute(query)
        return result.unique().scalar_one_or_none()

    @handle_repository_exceptions
    async def create_dataset(
        self,
        project_id: str,
        name: str,
        schema_config: dict[str, Any],
        description: str | None = None,
        partition_fields: list[str] | None = None,
        column_profiles: dict[str, Any] | None = None,
        format_context: str | None = None,
        row_count: int | None = None,
    ) -> dict[str, Any]:
        """Create a new dataset record.

        ID and storage_path are generated by the database (server_default / computed).
        """
        dataset = DatasetRecord(
            project_id=project_id,
            name=name,
            description=description,
            schema_config=schema_config,
            partition_fields=partition_fields or [],
            column_profiles=column_profiles,
            format_context=format_context,
            row_count=row_count,
        )

        self._session.add(dataset)
        await self._session.flush()
        await self._session.refresh(dataset)
        return _mappers.dataset_to_dict(dataset)

    @handle_repository_exceptions
    async def update_dataset(
        self,
        dataset_id: str,
        **kwargs: Any,
    ) -> DatasetRecord | None:
        """Update a dataset's metadata."""
        result = await self._session.execute(
            select(DatasetRecord)
            .options(selectinload(DatasetRecord.transforms.and_(TransformRecord.status != "deleted")))
            .where(DatasetRecord.id == dataset_id)
        )
        dataset = result.scalar_one_or_none()

        if not dataset:
            return None

        for key, value in kwargs.items():
            setattr(dataset, key, value)

        await self._session.flush()
        await self._session.refresh(dataset)

        return dataset

    @handle_repository_exceptions
    async def delete_dataset(self, dataset_id: str) -> str | None:
        """Delete a dataset record, returning storage_path for file cleanup."""
        result = await self._session.execute(select(DatasetRecord).where(DatasetRecord.id == dataset_id))
        dataset = result.scalar_one_or_none()

        if not dataset:
            return None

        storage_path = dataset.storage_path

        await self._session.delete(dataset)
        await self._session.flush()

        return storage_path

    @handle_repository_exceptions
    async def search_datasets_by_name(
        self,
        project_id: str,
        query: str,
    ) -> list[dict[str, Any]]:
        """Search datasets by name within a project."""
        stmt = (
            select(DatasetRecord)
            .where(DatasetRecord.project_id == project_id)
            .where(DatasetRecord.name.ilike(f"%{query}%"))
            .order_by(DatasetRecord.name)
            .limit(10)
        )
        result = await self._session.execute(stmt)
        return [_mappers.dataset_to_dict(ds) for ds in result.scalars().all()]

    @handle_repository_exceptions
    async def dataset_exists(self, dataset_id: str) -> bool:
        """Check if a dataset exists."""
        return (await self._session.execute(select(exists().where(DatasetRecord.id == dataset_id)))).scalar()

    # -------------------------------------------------------------------------
    # Transform operations
    # -------------------------------------------------------------------------

    @handle_repository_exceptions
    async def find_transform_by_sql(
        self,
        dataset_id: str,
        condition_sql: str,
    ) -> dict[str, Any] | None:
        """Find an existing transform with matching SQL."""
        result = await self._session.execute(
            select(TransformRecord)
            .where(TransformRecord.dataset_id == dataset_id)
            .where(TransformRecord.condition_sql == condition_sql)
            .order_by(TransformRecord.created_at.asc())
            .limit(1)
        )
        transform = result.scalar_one_or_none()

        if not transform:
            return None

        return _mappers.transform_to_dict(transform)

    @handle_repository_exceptions
    async def create_transform(
        self,
        dataset_id: str,
        name: str,
        condition_json: dict[str, Any],
        condition_sql: str,
        description: str | None = None,
        nl_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Create a new transform."""
        if condition_sql:
            validate_condition_sql(condition_sql)
        transform = TransformRecord(
            dataset_id=dataset_id,
            name=name,
            description=description,
            condition_json=condition_json,
            condition_sql=condition_sql,
            nl_prompt=nl_prompt,
        )

        self._session.add(transform)
        await self._session.flush()
        await self._session.refresh(transform)
        return _mappers.transform_to_dict(transform)

    @handle_repository_exceptions
    async def create_transforms_batch(
        self,
        dataset_id: str,
        transforms_input: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Create multiple transforms in a single flush."""
        records = [self._build_transform_record(dataset_id, spec) for spec in transforms_input]
        for record in records:
            self._session.add(record)

        await self._session.flush()
        for record in records:
            await self._session.refresh(record)

        return [_mappers.transform_to_dict(r) for r in records]

    @staticmethod
    def _build_transform_record(dataset_id: str, spec: dict[str, Any]) -> TransformRecord:
        """Construct a TransformRecord from a batch-input dict, validating SQL."""
        condition_sql = spec.get("condition_sql", "")
        if condition_sql:
            validate_condition_sql(condition_sql)
        return TransformRecord(
            dataset_id=dataset_id,
            name=spec["name"],
            condition_json=spec.get("condition_json", {}),
            condition_sql=condition_sql,
            description=spec.get("description"),
            nl_prompt=spec.get("nl_prompt"),
            transform_type=spec.get("transform_type", "filter"),
            target_column=spec.get("target_column"),
            expression_sql=spec.get("expression_sql"),
            expression_config=spec.get("expression_config"),
        )

    @handle_repository_exceptions
    async def update_transform(
        self,
        transform_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a transform."""
        result = await self._session.execute(select(TransformRecord).where(TransformRecord.id == transform_id))
        transform = result.scalar_one_or_none()

        if not transform:
            return None

        if update_data.get("name") is not None:
            transform.name = update_data["name"]

        if update_data.get("description") is not None:
            transform.description = update_data["description"]

        if update_data.get("condition_json") is not None:
            transform.condition_json = update_data["condition_json"]
            new_condition_sql = update_data.get("condition_sql")
            if new_condition_sql:
                validate_condition_sql(new_condition_sql)
            transform.condition_sql = new_condition_sql
            transform.version += 1

        if update_data.get("status") is not None:
            transform.status = update_data["status"]

        await self._session.flush()
        await self._session.refresh(transform)
        return _mappers.transform_to_dict(transform)

    @handle_repository_exceptions
    async def update_transforms(self, updates: list[dict[str, Any]]) -> None:
        """Batch update transforms in a single query.

        Args:
            updates: List of dicts, each containing 'id' and fields to update.
        """
        if updates:
            await self._session.execute(update(TransformRecord), updates)
            await self._session.flush()

    @handle_repository_exceptions
    async def delete_transform(self, transform_id: str) -> bool:
        """Delete a transform."""
        result = await self._session.execute(select(TransformRecord).where(TransformRecord.id == transform_id))
        transform = result.scalar_one_or_none()

        if not transform:
            return False

        await self._session.delete(transform)
        await self._session.flush()
        return True

    # -------------------------------------------------------------------------
    # Organization operations
    # -------------------------------------------------------------------------

    @handle_repository_exceptions
    async def create_organization(
        self,
        name: str,
        id: str | None = None,
    ) -> dict[str, Any]:
        """Create a new organization."""
        kwargs = {"name": name}
        if id is not None:
            kwargs["id"] = id
        org = OrganizationRecord(**kwargs)
        self._session.add(org)
        await self._session.flush()
        await self._session.refresh(org)
        return _mappers.organization_to_dict(org)

    @handle_repository_exceptions
    async def get_organization(self, org_id: str) -> dict[str, Any] | None:
        """Get an organization by ID."""
        result = await self._session.execute(select(OrganizationRecord).where(OrganizationRecord.id == org_id))
        org = result.scalar_one_or_none()
        if not org:
            return None
        return _mappers.organization_to_dict(org)

    # -------------------------------------------------------------------------
    # View operations
    # -------------------------------------------------------------------------

    @handle_repository_exceptions
    async def create_view(
        self,
        project_id: str,
        org_id: str,
        name: str,
        sql_definition: str,
        source_refs: list | None = None,
        columns: list | None = None,
        joins: list | None = None,
        filters: list | None = None,
        grain: dict | None = None,
        description: str | None = None,
        materialization: str = "ephemeral",
    ) -> dict[str, Any]:
        """Create a new view record."""
        view = ViewRecord(
            project_id=project_id,
            org_id=org_id,
            name=name,
            sql_definition=sql_definition,
            source_refs=source_refs or [],
            columns=columns or [],
            joins=joins or [],
            filters=filters or [],
            grain=grain,
            description=description,
            materialization=materialization,
        )
        self._session.add(view)
        await self._session.flush()
        await self._session.refresh(view)
        return _mappers.view_to_dict(view)

    @handle_repository_exceptions
    async def get_view(self, view_id: str) -> dict[str, Any] | None:
        """Get a view by ID."""
        result = await self._session.execute(select(ViewRecord).where(ViewRecord.id == view_id))
        view = result.scalar_one_or_none()
        if not view:
            return None
        return _mappers.view_to_dict(view)

    @handle_repository_exceptions
    async def list_views_by_project(self, project_id: str) -> list[ViewRecord]:
        """List views for a project."""
        query = select(ViewRecord).where(ViewRecord.project_id == project_id).order_by(ViewRecord.created_at.desc())
        result = await self._session.execute(query)
        return result.scalars().all()

    @handle_repository_exceptions
    async def update_view(self, view_id: str, **kwargs: Any) -> ViewRecord | None:
        """Update a view's metadata."""
        result = await self._session.execute(select(ViewRecord).where(ViewRecord.id == view_id))
        view = result.scalar_one_or_none()

        if not view:
            return None

        for key, value in kwargs.items():
            setattr(view, key, value)

        await self._session.flush()
        await self._session.refresh(view)
        return view

    @handle_repository_exceptions
    async def delete_view(self, view_id: str) -> bool:
        """Delete a view."""
        result = await self._session.execute(select(ViewRecord).where(ViewRecord.id == view_id))
        view = result.scalar_one_or_none()

        if not view:
            return False

        await self._session.delete(view)
        await self._session.flush()
        return True

    @handle_repository_exceptions
    async def view_exists(self, view_id: str) -> bool:
        """Check if a view exists."""
        return (await self._session.execute(select(exists().where(ViewRecord.id == view_id)))).scalar()

    # -------------------------------------------------------------------------
    # Report operations
    # -------------------------------------------------------------------------

    @handle_repository_exceptions
    async def create_report(
        self,
        project_id: str,
        org_id: str,
        name: str,
        sql_definition: str,
        report_type: str,
        source_refs: list | None = None,
        description: str | None = None,
        domain: str = "Organization",
        columns_metadata: list | None = None,
        materialization: str = "view",
    ) -> dict[str, Any]:
        """Create a new report record."""
        report = ReportRecord(
            project_id=project_id,
            org_id=org_id,
            name=name,
            sql_definition=sql_definition,
            report_type=report_type,
            source_refs=source_refs or [],
            description=description,
            domain=domain,
            columns_metadata=columns_metadata or [],
            materialization=materialization,
        )
        self._session.add(report)
        await self._session.flush()
        await self._session.refresh(report)
        return _mappers.report_to_dict(report)

    @handle_repository_exceptions
    async def get_report(self, report_id: str) -> dict[str, Any] | None:
        """Get a report by ID."""
        result = await self._session.execute(select(ReportRecord).where(ReportRecord.id == report_id))
        report = result.scalar_one_or_none()
        if not report:
            return None
        return _mappers.report_to_dict(report)

    @handle_repository_exceptions
    async def list_reports_by_project(self, project_id: str) -> list[ReportRecord]:
        """List reports for a project."""
        query = (
            select(ReportRecord).where(ReportRecord.project_id == project_id).order_by(ReportRecord.created_at.desc())
        )
        result = await self._session.execute(query)
        return result.scalars().all()

    @handle_repository_exceptions
    async def update_report(self, report_id: str, **kwargs: Any) -> ReportRecord | None:
        """Update a report's metadata."""
        result = await self._session.execute(select(ReportRecord).where(ReportRecord.id == report_id))
        report = result.scalar_one_or_none()

        if not report:
            return None

        for key, value in kwargs.items():
            setattr(report, key, value)

        await self._session.flush()
        await self._session.refresh(report)
        return report

    @handle_repository_exceptions
    async def delete_report(self, report_id: str) -> bool:
        """Delete a report."""
        result = await self._session.execute(select(ReportRecord).where(ReportRecord.id == report_id))
        report = result.scalar_one_or_none()

        if not report:
            return False

        await self._session.delete(report)
        await self._session.flush()
        return True

    @handle_repository_exceptions
    async def report_exists(self, report_id: str) -> bool:
        """Check if a report exists."""
        return (await self._session.execute(select(exists().where(ReportRecord.id == report_id)))).scalar()
