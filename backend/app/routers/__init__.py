"""API routers."""

from .auth import router as auth_router
from .datasets import router as datasets_router
from .organizations import router as organizations_router
from .projects import router as projects_router
from .reports import router as reports_router
from .sessions import router as sessions_router
from .sql_access import router as sql_access_router
from .stream_token import router as stream_token_router
from .transforms import router as transforms_router
from .uploads import router as uploads_router
from .views import router as views_router

__all__ = [
    "auth_router",
    "datasets_router",
    "organizations_router",
    "projects_router",
    "reports_router",
    "sessions_router",
    "sql_access_router",
    "stream_token_router",
    "transforms_router",
    "uploads_router",
    "views_router",
]
