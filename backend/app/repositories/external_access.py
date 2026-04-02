"""ExternalAccessRepository - CRUD for external SQL access records."""

import contextlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import wraps
from typing import TYPE_CHECKING, Any, ParamSpec, TypeVar

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .exceptions import ExternalAccessRepositoryError
from .metadata.external_access_record import ExternalAccessRecord

if TYPE_CHECKING:
    from app.repositories import RestrictedSession

P = ParamSpec("P")
R = TypeVar("R")


@dataclass(frozen=True)
class AccessRecordView:
    """Read-only view of an ExternalAccessRecord (excludes pg_password_hash)."""

    id: str
    project_id: str
    org_id: str
    engine_node_id: str | None
    pg_schema: str
    pg_role: str
    pg_proxy_role: str | None
    enabled: bool
    last_synced_at: str | None
    created_at: str | None
    updated_at: str | None


@dataclass(frozen=True)
class AccessRecordWithHash(AccessRecordView):
    """AccessRecordView that also includes the pg_password_hash."""

    pg_password_hash: str = ""


def handle_repository_exceptions(func: Callable[P, R]) -> Callable[P, R]:
    """Decorator that wraps SQLAlchemyError as ExternalAccessRepositoryError."""

    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return await func(*args, **kwargs)
        except SQLAlchemyError as e:
            raise ExternalAccessRepositoryError(str(e)) from e

    return wrapper


class ExternalAccessRepository:
    """CRUD operations for ExternalAccessRecord."""

    def __init__(self, session: "RestrictedSession") -> None:
        self._session = session

    @handle_repository_exceptions
    async def create(
        self,
        project_id: str,
        org_id: str,
        pg_schema: str,
        pg_role: str,
        pg_password_hash: str,
        engine_node_id: str | None = None,
        pg_proxy_role: str | None = None,
    ) -> AccessRecordView:
        """Create a new external access record."""
        record = ExternalAccessRecord(
            project_id=project_id,
            org_id=org_id,
            engine_node_id=engine_node_id,
            pg_schema=pg_schema,
            pg_role=pg_role,
            pg_proxy_role=pg_proxy_role,
            pg_password_hash=pg_password_hash,
            enabled=True,
        )
        self._session.add(record)
        await self._session.flush()
        await self._session.refresh(record)
        return self._to_dict(record)

    @handle_repository_exceptions
    async def get_by_project_id(self, project_id: str) -> AccessRecordView | None:
        """Get external access record by project ID."""
        result = await self._session.execute(
            select(ExternalAccessRecord).where(ExternalAccessRecord.project_id == project_id)
        )
        record = result.scalar_one_or_none()
        if not record:
            return None
        return self._to_dict(record)

    @handle_repository_exceptions
    async def get_by_project_id_for_update(self, project_id: str) -> AccessRecordView | None:
        """Get external access record with a row-level lock (SELECT ... FOR UPDATE).

        Use this in enable/disable flows to prevent concurrent modifications.
        Falls back to a regular SELECT on SQLite (no FOR UPDATE support).
        """
        query = select(ExternalAccessRecord).where(ExternalAccessRecord.project_id == project_id)
        with contextlib.suppress(Exception):
            query = query.with_for_update()
        result = await self._session.execute(query)
        record = result.scalar_one_or_none()
        if not record:
            return None
        return self._to_dict(record)

    @handle_repository_exceptions
    async def get_active_engine_node_id(self, project_id: str) -> str | None:
        """Return the engine_node_id if SQL access is enabled for this project, else None."""
        result = await self._session.execute(
            select(ExternalAccessRecord.engine_node_id).where(
                ExternalAccessRecord.project_id == project_id,
                ExternalAccessRecord.enabled == True,
            )
        )
        return result.scalar_one_or_none()

    @handle_repository_exceptions
    async def list_enabled(self) -> list[AccessRecordView]:
        """List all enabled external access records."""
        result = await self._session.execute(select(ExternalAccessRecord).where(ExternalAccessRecord.enabled == True))
        return [self._to_dict(r) for r in result.scalars().all()]

    @handle_repository_exceptions
    async def list_enabled_by_engine_node(self, engine_node_id: str) -> list[AccessRecordView]:
        """List all enabled external access records for a specific engine node."""
        result = await self._session.execute(
            select(ExternalAccessRecord).where(
                ExternalAccessRecord.enabled == True,
                ExternalAccessRecord.engine_node_id == engine_node_id,
            )
        )
        return [self._to_dict(r) for r in result.scalars().all()]

    @handle_repository_exceptions
    async def update(
        self,
        project_id: str,
        update_data: dict[str, Any],
    ) -> AccessRecordView | None:
        """Update an external access record by project ID."""
        result = await self._session.execute(
            select(ExternalAccessRecord).where(ExternalAccessRecord.project_id == project_id)
        )
        record = result.scalar_one_or_none()
        if not record:
            return None

        for key, value in update_data.items():
            setattr(record, key, value)

        await self._session.flush()
        await self._session.refresh(record)
        return self._to_dict(record)

    @handle_repository_exceptions
    async def soft_disable(self, project_id: str) -> AccessRecordView | None:
        """Soft-disable external access for a project (set enabled=False)."""
        result = await self._session.execute(
            select(ExternalAccessRecord).where(ExternalAccessRecord.project_id == project_id)
        )
        record = result.scalar_one_or_none()
        if not record:
            return None

        record.enabled = False
        record.updated_at = datetime.now(UTC)

        await self._session.flush()
        await self._session.refresh(record)
        return self._to_dict(record)

    @handle_repository_exceptions
    async def get_by_project_id_with_hash(self, project_id: str) -> AccessRecordWithHash | None:
        """Get external access record by project ID, including pg_password_hash."""
        result = await self._session.execute(
            select(ExternalAccessRecord).where(ExternalAccessRecord.project_id == project_id)
        )
        record = result.scalar_one_or_none()
        if not record:
            return None
        return self._to_dict_with_hash(record)

    @staticmethod
    def _to_dict(record: ExternalAccessRecord) -> AccessRecordView:
        """Convert ExternalAccessRecord to AccessRecordView."""
        return AccessRecordView(
            id=record.id,
            project_id=record.project_id,
            org_id=record.org_id,
            engine_node_id=record.engine_node_id,
            pg_schema=record.pg_schema,
            pg_role=record.pg_role,
            pg_proxy_role=record.pg_proxy_role,
            enabled=record.enabled,
            last_synced_at=record.last_synced_at.isoformat() if record.last_synced_at else None,
            created_at=record.created_at.isoformat() if record.created_at else None,
            updated_at=record.updated_at.isoformat() if record.updated_at else None,
        )

    @staticmethod
    def _to_dict_with_hash(record: ExternalAccessRecord) -> AccessRecordWithHash:
        """Convert ExternalAccessRecord to AccessRecordWithHash."""
        return AccessRecordWithHash(
            id=record.id,
            project_id=record.project_id,
            org_id=record.org_id,
            engine_node_id=record.engine_node_id,
            pg_schema=record.pg_schema,
            pg_role=record.pg_role,
            pg_proxy_role=record.pg_proxy_role,
            enabled=record.enabled,
            last_synced_at=record.last_synced_at.isoformat() if record.last_synced_at else None,
            created_at=record.created_at.isoformat() if record.created_at else None,
            updated_at=record.updated_at.isoformat() if record.updated_at else None,
            pg_password_hash=record.pg_password_hash,
        )
