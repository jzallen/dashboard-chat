"""ExternalAccessRepository - CRUD for external SQL access records."""

from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, TypeVar, ParamSpec

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .exceptions import ExternalAccessRepositoryError
from .metadata.external_access_record import ExternalAccessRecord

P = ParamSpec("P")
R = TypeVar("R")


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

    def __init__(self, session: 'RestrictedSession') -> None:
        self._session = session

    @handle_repository_exceptions
    async def create(
        self,
        project_id: str,
        org_id: str,
        pg_schema: str,
        pg_role: str,
        pg_password_hash: str,
        environment_id: str | None = None,
        environment_host: str | None = None,
        environment_port: int | None = None,
    ) -> dict[str, Any]:
        """Create a new external access record."""
        record = ExternalAccessRecord(
            project_id=project_id,
            org_id=org_id,
            pg_schema=pg_schema,
            pg_role=pg_role,
            pg_password_hash=pg_password_hash,
            environment_id=environment_id,
            environment_host=environment_host,
            environment_port=environment_port,
            enabled=True,
        )
        self._session.add(record)
        await self._session.flush()
        await self._session.refresh(record)
        return self._to_dict(record)

    @handle_repository_exceptions
    async def get_by_project_id(self, project_id: str) -> dict[str, Any] | None:
        """Get external access record by project ID."""
        result = await self._session.execute(
            select(ExternalAccessRecord).where(
                ExternalAccessRecord.project_id == project_id
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            return None
        return self._to_dict(record)

    @handle_repository_exceptions
    async def get_by_project_id_for_update(self, project_id: str) -> dict[str, Any] | None:
        """Get external access record with a row-level lock (SELECT ... FOR UPDATE).

        Use this in enable/disable flows to prevent concurrent modifications.
        Falls back to a regular SELECT on SQLite (no FOR UPDATE support).
        """
        query = select(ExternalAccessRecord).where(
            ExternalAccessRecord.project_id == project_id
        )
        try:
            query = query.with_for_update()
        except Exception:
            pass  # SQLite doesn't support FOR UPDATE; proceed without lock
        result = await self._session.execute(query)
        record = result.scalar_one_or_none()
        if not record:
            return None
        return self._to_dict(record)

    @handle_repository_exceptions
    async def list_enabled(self) -> list[dict[str, Any]]:
        """List all enabled external access records."""
        result = await self._session.execute(
            select(ExternalAccessRecord).where(
                ExternalAccessRecord.enabled == True  # noqa: E712
            )
        )
        return [self._to_dict(r) for r in result.scalars().all()]

    @handle_repository_exceptions
    async def update(
        self,
        project_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update an external access record by project ID."""
        result = await self._session.execute(
            select(ExternalAccessRecord).where(
                ExternalAccessRecord.project_id == project_id
            )
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
    async def soft_disable(self, project_id: str) -> dict[str, Any] | None:
        """Soft-disable external access for a project (set enabled=False)."""
        result = await self._session.execute(
            select(ExternalAccessRecord).where(
                ExternalAccessRecord.project_id == project_id
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            return None

        record.enabled = False
        record.environment_id = None
        record.environment_host = None
        record.environment_port = None
        record.updated_at = datetime.now(timezone.utc)

        await self._session.flush()
        await self._session.refresh(record)
        return self._to_dict(record)

    @staticmethod
    def _to_dict(record: ExternalAccessRecord) -> dict[str, Any]:
        """Convert ExternalAccessRecord to dictionary.

        Deliberately excludes pg_password_hash — use _to_dict_with_hash()
        only when credential verification is needed.
        """
        return {
            "id": record.id,
            "project_id": record.project_id,
            "org_id": record.org_id,
            "pg_schema": record.pg_schema,
            "pg_role": record.pg_role,
            "environment_id": record.environment_id,
            "environment_host": record.environment_host,
            "environment_port": record.environment_port,
            "enabled": record.enabled,
            "last_synced_at": record.last_synced_at.isoformat() if record.last_synced_at else None,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        }
