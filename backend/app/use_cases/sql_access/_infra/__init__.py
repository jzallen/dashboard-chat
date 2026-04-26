"""Infrastructure sub-package for SQL access provisioning.

Re-exports public symbols from all sub-modules so use cases can import
from ``app.use_cases.sql_access._infra`` instead of reaching into
individual infrastructure modules.
"""

from .pg_duckdb_manager import (
    create_project_schema,
    create_proxy_role,
    drop_project_schema,
    ensure_duckdb_role_configured,
    execute_bootstrap,
    generate_password,
    grant_schema_usage,
    hash_password,
    pg_md5_hash,
    proxy_role_name,
    regenerate_credentials,
    regenerate_proxy_credentials,
    role_name,
    schema_name,
)
from .provisioner import (
    EnvironmentStatus,
    MockQueryEngineProvisioner,
    ProjectEnvironment,
    ProvisioningError,
    QueryEngineProvisioner,
    StorageConfig,
    get_app_query_engine_provisioner,
    set_app_query_engine_provisioner,
)
from .query_engine_provisioner import AsyncpgQueryEngineProvisioner

__all__ = [
    "AsyncpgQueryEngineProvisioner",
    "EnvironmentStatus",
    "MockQueryEngineProvisioner",
    "ProjectEnvironment",
    "ProvisioningError",
    "QueryEngineProvisioner",
    "StorageConfig",
    "create_project_schema",
    "create_proxy_role",
    "drop_project_schema",
    "ensure_duckdb_role_configured",
    "execute_bootstrap",
    "generate_password",
    "get_app_query_engine_provisioner",
    "grant_schema_usage",
    "hash_password",
    "pg_md5_hash",
    "proxy_role_name",
    "regenerate_credentials",
    "regenerate_proxy_credentials",
    "role_name",
    "schema_name",
    "set_app_query_engine_provisioner",
]
