"""API routers."""

from .auth import router as auth_router
from .datasets import router as datasets_router
from .organizations import router as organizations_router
from .projects import router as projects_router
from .sql_access import router as sql_access_router
from .transforms import router as transforms_router
from .uploads import router as uploads_router

__all__ = [
    "auth_router",
    "datasets_router",
    "organizations_router",
    "projects_router",
    "sql_access_router",
    "transforms_router",
    "uploads_router",
]
