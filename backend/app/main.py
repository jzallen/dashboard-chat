"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from returns.result import Failure

from .auth.middleware import AuthMiddleware
from .config import get_settings
from .database import async_session, close_db, init_db
from .repositories import set_session
from .routers import (
    auth_router,
    datasets_router,
    organizations_router,
    projects_router,
    sql_access_router,
    transforms_router,
    uploads_router,
    views_router,
)
from .use_cases.sql_access._infra import set_app_pgbouncer_provisioner, set_app_provisioner
from .use_cases.sql_access.reconcile_sql_access import reconcile_sql_access

logger = logging.getLogger(__name__)

settings = get_settings()


def _create_provisioners():
    """Create the environment provisioners based on config."""
    if settings.environment_provisioner == "mock":
        from .use_cases.sql_access._infra import MockEnvironmentProvisioner, MockPgBouncerProvisioner

        return MockEnvironmentProvisioner(), MockPgBouncerProvisioner()

    from .use_cases.sql_access._infra.docker_provisioner import DockerPgDuckDbProvisioner
    from .use_cases.sql_access._infra.pgbouncer_provisioner import DockerPgBouncerProvisioner

    pgbouncer_provisioner = DockerPgBouncerProvisioner(
        image=settings.pgbouncer_image,
        network=settings.pg_duckdb_network,
    )
    env_provisioner = DockerPgDuckDbProvisioner(
        image=settings.pg_duckdb_image,
        network=settings.pg_duckdb_network,
        admin_user=settings.pg_duckdb_admin_user,
        admin_password=settings.pg_duckdb_admin_password,
        database=settings.pg_duckdb_database,
        pgbouncer_provisioner=pgbouncer_provisioner,
    )
    return env_provisioner, pgbouncer_provisioner


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    await init_db()

    provisioner, pgbouncer_provisioner = _create_provisioners()
    set_app_provisioner(provisioner)
    set_app_pgbouncer_provisioner(pgbouncer_provisioner)
    app.state.provisioner = provisioner
    app.state.pgbouncer_provisioner = pgbouncer_provisioner
    logger.info("Configured environment provisioner: %s", settings.environment_provisioner)

    # Reconcile enabled environments against running containers
    async with async_session() as session:
        set_session(session)
        result = await reconcile_sql_access()
        if isinstance(result, Failure):
            logger.warning("SQL access reconciliation failed: %s", result.failure())
        else:
            logger.info("SQL access reconciliation: %s", result.unwrap())

    yield

    # Shutdown
    if hasattr(pgbouncer_provisioner, "close"):
        await pgbouncer_provisioner.close()
    if hasattr(provisioner, "close"):
        await provisioner.close()
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

# Include routers
app.include_router(auth_router)
app.include_router(datasets_router)
app.include_router(uploads_router)
app.include_router(projects_router)
app.include_router(transforms_router)
app.include_router(organizations_router)
app.include_router(sql_access_router)
app.include_router(views_router)


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
