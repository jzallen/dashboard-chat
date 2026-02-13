"""Shared FastAPI dependencies for routers."""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.repositories import set_session


async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
    """Dependency that sets the db session in context for use cases."""
    set_session(db)
    return db
