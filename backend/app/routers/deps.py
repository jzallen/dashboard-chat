"""Shared FastAPI dependencies for routers."""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.repositories import set_session
from app.auth import get_auth_user, AuthUser


async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
    """Dependency that sets the db session in context for use cases."""
    set_session(db)
    return db


async def use_auth_context() -> AuthUser:
    """Dependency that returns the current authenticated user from context.

    The auth middleware sets the user in context before routers run,
    so this just retrieves it.
    """
    return get_auth_user()
