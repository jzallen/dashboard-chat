"""Application configuration from environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: str = "postgresql+asyncpg://dashboard:dashboard_secret@localhost:5432/dashboard_chat"

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Debug mode
    debug: bool = False

    # Storage configuration
    storage_type: str = "minio"  # or "s3" for production
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_secure: bool = False
    storage_bucket: str = "dashboard-chat.datalake"

    # S3 configuration (production)
    s3_region: str = "us-east-1"

    # S3/MinIO client settings - fast-fail defaults to avoid browser hanging
    s3_max_retries: int = 1
    s3_connect_timeout: int = 5
    s3_read_timeout: int = 10

    # pg_duckdb - external SQL access
    pg_duckdb_admin_user: str = "duckdb_admin"
    pg_duckdb_admin_password: str = "duckdb_secret"
    pg_duckdb_database: str = "dashboard_external"
    pg_duckdb_image: str = "pgduckdb/pgduckdb:16-main"
    pg_duckdb_network: str = "dashboard-chat_default"
    pg_duckdb_connection_limit: int = 10
    environment_provisioner: str = "docker"  # "docker" or "mock"

    # PgBouncer proxy
    pgbouncer_image: str = "edoburu/pgbouncer:1.22"
    pgbouncer_port_range_start: int = 6432
    pgbouncer_port_range_end: int = 7431
    pgbouncer_max_client_conn: int = 20
    pgbouncer_default_pool_size: int = 5

    # Credential management
    credential_regen_cooldown_seconds: int = 60

    # MinIO internal endpoint for pg_duckdb containers (Docker networking)
    minio_internal_endpoint: str = ""

    # Auth
    auth_mode: str = "dev"  # "dev" or "workos"
    auto_provision_org: bool = False  # auto-create org + project on login (dev/SQLite only)
    workos_api_key: str = ""
    workos_client_id: str = ""
    workos_redirect_uri: str = "http://localhost:5173/auth/callback"

    # App info
    app_name: str = "Dashboard Chat API"
    app_version: str = "1.0.0"

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse CORS origins from comma-separated string."""
        return [origin.strip() for origin in self.cors_origins.split(",")]


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
