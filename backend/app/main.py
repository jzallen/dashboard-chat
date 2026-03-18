"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from returns.result import Failure

from .auth.exceptions import AuthorizationError
from .auth.middleware import AuthMiddleware
from .config import get_settings
from .controllers.response_wrapper import wrap_jsonapi_error
from .database import async_session, close_db, init_db
from .plugins import create_plugin_registry
from .repositories import set_session
from .routers import (
    auth_router,
    datasets_router,
    organizations_router,
    projects_router,
    reports_router,
    sql_access_router,
    stream_token_router,
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

    app.state.plugin_registry = create_plugin_registry()
    logger.info("Loaded %d file format plugins", len(app.state.plugin_registry.all_plugins()))

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

# Global exception handler for authorization errors (returns 403 instead of 500)
@app.exception_handler(AuthorizationError)
async def authorization_error_handler(request: Request, exc: AuthorizationError):
    return JSONResponse(
        status_code=403,
        content=wrap_jsonapi_error(403, "Forbidden", str(exc)),
    )


# Include routers
app.include_router(auth_router)
app.include_router(stream_token_router)
app.include_router(datasets_router)
app.include_router(uploads_router)
app.include_router(projects_router)
app.include_router(transforms_router)
app.include_router(organizations_router)
app.include_router(sql_access_router)
app.include_router(views_router)
app.include_router(reports_router)


@app.get("/.well-known/jwks.json")
async def jwks():
    """Serve the dev-mode JWKS public key set."""
    from .auth.dev_keys import get_jwks_dict

    return get_jwks_dict()


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
