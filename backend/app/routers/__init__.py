"""API routers."""

from .projects import router as projects_router
from .datasets import router as datasets_router
from .uploads import router as uploads_router

__all__ = ["projects_router", "datasets_router", "uploads_router"]
