"""FastAPI application entry point."""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth.exceptions import AuthorizationError
from .auth.middleware import AuthMiddleware
from .config import get_settings
from .controllers.response_wrapper import wrap_jsonapi_error
from .database import async_session, close_db, init_db
from .plugins import create_plugin_registry
from .routers import (
    datasets_router,
    organizations_router,
    projects_router,
    query_engines_router,
    reports_router,
    session_replay_router,
    sessions_router,
    sources_router,
    sql_access_router,
    transforms_router,
    uploads_router,
    views_router,
)
from .use_cases.exceptions import DomainException
from .use_cases.query_engine.seed_default_node import seed_default_query_engine_node
from .use_cases.query_engine.sync_processor import run_sync_processor
from .use_cases.session.event_replay_dispatch import install_session_event_reader
from .use_cases.sql_access._infra import (
    AsyncpgQueryEngineProvisioner,
    MockQueryEngineProvisioner,
    set_app_query_engine_provisioner,
)
from .version import log_image_identity

logger = logging.getLogger(__name__)

settings = get_settings()


def _create_query_engine_provisioner():
    """Create the query engine provisioner based on config."""
    if settings.environment_provisioner == "mock":
        return MockQueryEngineProvisioner()

    async def node_lookup(engine_node_id: str) -> dict:
        """Look up engine node connection details from the database."""
        async with async_session() as session:
            from .repositories import RestrictedSession
            from .repositories.query_engine_node import QueryEngineNodeRepository

            repo = QueryEngineNodeRepository(RestrictedSession(session))
            node = await repo.get_by_id(engine_node_id)
            if not node:
                raise KeyError(f"Engine node '{engine_node_id}' not found")
            return {
                "host": node.host,
                "port": node.port,
                "database": node.database,
                "admin_user": node.admin_user,
                "admin_password": settings.query_engine_admin_password,
            }

    return AsyncpgQueryEngineProvisioner(node_lookup=node_lookup)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    log_image_identity("dashboard-api")
    await init_db()

    app.state.plugin_registry = create_plugin_registry()
    logger.info("Loaded %d file format plugins", len(app.state.plugin_registry.all_plugins()))

    # Configure query engine provisioner
    provisioner = _create_query_engine_provisioner()
    set_app_query_engine_provisioner(provisioner)
    logger.info("Configured query engine provisioner: %s", type(provisioner).__name__)

    # Seed default query engine node for dev org
    if settings.auto_provision_org:
        async with async_session() as session:
            from .auth import DEV_USER

            await seed_default_query_engine_node(session, DEV_USER.org_id)

    # Wire the SessionEventReader (ADR-018 (supersedes ADR-017)): Stream.io if creds present,
    # Redis if REDIS_URL set, else noop. Logs the choice once.
    install_session_event_reader(settings)

    # Start sync processor background task
    sync_task = asyncio.create_task(run_sync_processor(), name="sync-processor")
    app.state.sync_processor_task = sync_task

    yield

    # Shutdown
    sync_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await sync_task

    await close_db()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure auth middleware (added after CORS — Starlette LIFO means CORS runs first)
app.add_middleware(AuthMiddleware)


# Global exception handler for authorization errors (returns 403 instead of 500)
@app.exception_handler(AuthorizationError)
async def authorization_error_handler(request: Request, exc: AuthorizationError):
    return JSONResponse(
        status_code=403,
        content=wrap_jsonapi_error(403, "Forbidden", str(exc)),
    )


# Global exception handler for DomainException and subclasses.
#
# Exceptions raised inside FastAPI ``Depends(...)`` callables (e.g.
# ``authorize_project_access`` raising ``ProjectNotFound``) bypass per-route
# ``match Failure(error)`` blocks because dep-raised exceptions never reach
# the handler body. Without a global handler, FastAPI's default surfaces
# them as opaque 500s. This handler honours each subclass's ``_status_code``,
# ``_type``, and ``_title`` and emits the same Problem-Details-shaped body
# the per-route handlers already use.
@app.exception_handler(DomainException)
async def domain_exception_handler(request: Request, exc: DomainException):
    return JSONResponse(
        status_code=exc._status_code,
        content={
            "type": exc._type,
            "title": exc._title,
            "status": exc._status_code,
            "detail": str(exc),
        },
    )


# Include routers
app.include_router(datasets_router)
app.include_router(uploads_router)
app.include_router(sources_router)
app.include_router(projects_router)
app.include_router(transforms_router)
app.include_router(organizations_router)
app.include_router(sql_access_router)
app.include_router(query_engines_router)
app.include_router(views_router)
app.include_router(reports_router)
app.include_router(sessions_router)
app.include_router(session_replay_router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": settings.app_version}


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
    }
