"""API routers."""

from .datasets import router as datasets_router
from .uploads import router as uploads_router
from .projects import router as projects_router

__all__ = ["datasets_router", "uploads_router", "projects_router"]
