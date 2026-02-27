"""Infrastructure sub-package for SQL access provisioning.

Re-exports public symbols from all sub-modules so use cases can import
from ``app.use_cases.sql_access._infra`` instead of reaching into
individual infrastructure modules.
"""

from .pg_duckdb_manager import (
    configure_s3_secrets,
    create_project_schema,
    drop_project_schema,
    ensure_duckdb_role_configured,
    execute_bootstrap,
    generate_password,
    grant_schema_usage,
    hash_password,
    pg_md5_hash,
    regenerate_credentials,
    role_name,
    schema_name,
)
from .port_allocation import PortRangeExhausted, allocate_proxy_port
from .provisioner import (
    EnvironmentStatus,
    MockEnvironmentProvisioner,
    MockPgBouncerProvisioner,
    ProjectEnvironment,
    ProjectEnvironmentProvisioner,
    ProvisioningError,
    StorageConfig,
    get_app_pgbouncer_provisioner,
    get_app_provisioner,
    set_app_pgbouncer_provisioner,
    set_app_provisioner,
)

__all__ = [
    # pg_duckdb_manager
    "configure_s3_secrets",
    "create_project_schema",
    "drop_project_schema",
    "ensure_duckdb_role_configured",
    "execute_bootstrap",
    "generate_password",
    "grant_schema_usage",
    "hash_password",
    "pg_md5_hash",
    "regenerate_credentials",
    "role_name",
    "schema_name",
    # port_allocation
    "PortRangeExhausted",
    "allocate_proxy_port",
    # provisioner
    "EnvironmentStatus",
    "MockEnvironmentProvisioner",
    "MockPgBouncerProvisioner",
    "ProjectEnvironment",
    "ProjectEnvironmentProvisioner",
    "ProvisioningError",
    "StorageConfig",
    "get_app_pgbouncer_provisioner",
    "get_app_provisioner",
    "set_app_pgbouncer_provisioner",
    "set_app_provisioner",
]
