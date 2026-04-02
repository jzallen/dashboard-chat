"""QueryEngineNodeRepository - CRUD for query engine node records."""

from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from typing import TYPE_CHECKING, Any, ParamSpec, TypeVar

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from .exceptions import QueryEngineNodeRepositoryError
from .metadata.external_access_record import ExternalAccessRecord
from .metadata.query_engine_node_record import QueryEngineNodeRecord

if TYPE_CHECKING:
    from app.repositories import RestrictedSession

P = ParamSpec("P")
R = TypeVar("R")


@dataclass(frozen=True)
class QueryEngineNodeView:
    """Read-only view of a QueryEngineNodeRecord (excludes admin_password_encrypted)."""

    id: str
    org_id: str
    name: str
    host: str
    port: int
    database: str
    admin_user: str
    status: str
    status_message: str | None
    created_at: str | None
    updated_at: str | None


@dataclass(frozen=True)
class QueryEngineNodeDetailView(QueryEngineNodeView):
    """QueryEngineNodeView with project count."""

    project_count: int = 0


def handle_repository_exceptions(func: Callable[P, R]) -> Callable[P, R]:
    """Decorator that wraps SQLAlchemyError as QueryEngineNodeRepositoryError."""

    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return await func(*args, **kwargs)
        except SQLAlchemyError as e:
            raise QueryEngineNodeRepositoryError(str(e)) from e

    return wrapper


class QueryEngineNodeRepository:
    """CRUD operations for QueryEngineNodeRecord."""

    def __init__(self, session: "RestrictedSession") -> None:
        self._session = session

    @handle_repository_exceptions
    async def create(
        self,
        org_id: str,
        name: str,
        host: str,
        port: int,
        database: str,
        admin_user: str,
        admin_password_encrypted: str,
    ) -> QueryEngineNodeView:
        """Create a new query engine node record."""
        record = QueryEngineNodeRecord(
            org_id=org_id,
            name=name,
            host=host,
            port=port,
            database=database,
            admin_user=admin_user,
            admin_password_encrypted=admin_password_encrypted,
        )
        self._session.add(record)
        await self._session.flush()
        await self._session.refresh(record)
        return self._to_view(record)

    @handle_repository_exceptions
    async def get_by_id(self, node_id: str) -> QueryEngineNodeView | None:
        """Get a query engine node by ID."""
        result = await self._session.execute(select(QueryEngineNodeRecord).where(QueryEngineNodeRecord.id == node_id))
        record = result.scalar_one_or_none()
        if not record:
            return None
        return self._to_view(record)

    @handle_repository_exceptions
    async def get_by_org_and_name(self, org_id: str, name: str) -> QueryEngineNodeView | None:
        """Get a query engine node by org_id and name."""
        result = await self._session.execute(
            select(QueryEngineNodeRecord).where(
                QueryEngineNodeRecord.org_id == org_id,
                QueryEngineNodeRecord.name == name,
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            return None
        return self._to_view(record)

    @handle_repository_exceptions
    async def get_first_for_org(self, org_id: str) -> QueryEngineNodeView | None:
        """Get the first (default) query engine node for an org."""
        result = await self._session.execute(
            select(QueryEngineNodeRecord)
            .where(QueryEngineNodeRecord.org_id == org_id)
            .order_by(QueryEngineNodeRecord.created_at.asc())
            .limit(1)
        )
        record = result.scalar_one_or_none()
        if not record:
            return None
        return self._to_view(record)

    @handle_repository_exceptions
    async def list_by_org(self, org_id: str) -> list[QueryEngineNodeView]:
        """List all query engine nodes for an organization."""
        result = await self._session.execute(
            select(QueryEngineNodeRecord)
            .where(QueryEngineNodeRecord.org_id == org_id)
            .order_by(QueryEngineNodeRecord.created_at.desc())
        )
        return [self._to_view(r) for r in result.scalars().all()]

    @handle_repository_exceptions
    async def get_with_project_count(self, node_id: str) -> QueryEngineNodeDetailView | None:
        """Get a query engine node with count of enabled projects.

        Left-joins with ExternalAccessRecord to count projects using this engine.
        """
        # Count only enabled access records linked to this engine node
        enabled_filter = (
            select(func.count(ExternalAccessRecord.id))
            .where(
                ExternalAccessRecord.engine_node_id == QueryEngineNodeRecord.id,
                ExternalAccessRecord.enabled == True,
            )
            .correlate(QueryEngineNodeRecord)
            .scalar_subquery()
        )

        stmt = select(QueryEngineNodeRecord, enabled_filter.label("project_count")).where(
            QueryEngineNodeRecord.id == node_id
        )
        result = await self._session.execute(stmt)
        row = result.one_or_none()
        if not row:
            return None
        record, count = row
        return self._to_detail_view(record, count)

    @handle_repository_exceptions
    async def update(self, node_id: str, update_data: dict[str, Any]) -> QueryEngineNodeView | None:
        """Update a query engine node by ID."""
        result = await self._session.execute(select(QueryEngineNodeRecord).where(QueryEngineNodeRecord.id == node_id))
        record = result.scalar_one_or_none()
        if not record:
            return None

        for key, value in update_data.items():
            setattr(record, key, value)

        await self._session.flush()
        await self._session.refresh(record)
        return self._to_view(record)

    @staticmethod
    def _to_view(record: QueryEngineNodeRecord) -> QueryEngineNodeView:
        """Convert QueryEngineNodeRecord to QueryEngineNodeView.

        Deliberately excludes admin_password_encrypted.
        """
        return QueryEngineNodeView(
            id=record.id,
            org_id=record.org_id,
            name=record.name,
            host=record.host,
            port=record.port,
            database=record.database,
            admin_user=record.admin_user,
            status=record.status,
            status_message=record.status_message,
            created_at=record.created_at.isoformat() if record.created_at else None,
            updated_at=record.updated_at.isoformat() if record.updated_at else None,
        )

    @staticmethod
    def _to_detail_view(record: QueryEngineNodeRecord, project_count: int) -> QueryEngineNodeDetailView:
        """Convert QueryEngineNodeRecord to QueryEngineNodeDetailView with project count."""
        return QueryEngineNodeDetailView(
            id=record.id,
            org_id=record.org_id,
            name=record.name,
            host=record.host,
            port=record.port,
            database=record.database,
            admin_user=record.admin_user,
            status=record.status,
            status_message=record.status_message,
            created_at=record.created_at.isoformat() if record.created_at else None,
            updated_at=record.updated_at.isoformat() if record.updated_at else None,
            project_count=project_count,
        )
