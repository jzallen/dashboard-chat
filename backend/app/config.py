"""Application configuration from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Query engine — org-level persistent pg_duckdb service
    query_engine_host: str = "query-engine"
    query_engine_port: int = 5432
    query_engine_admin_user: str = "duckdb_admin"
    query_engine_admin_password: str = "duckdb_secret"
    query_engine_database: str = "dashboard_external"
    query_engine_name: str = "default"

    # MinIO internal endpoint for pg_duckdb containers (Docker networking)
    minio_internal_endpoint: str = ""

    # Auth
    trust_proxy_headers: bool = False  # Trust X-User-Id/X-Org-Id/X-User-Email from auth proxy
    dev_no_org: bool = False  # Ignore org claims (header/contextvar); resolve org from DB by created_by
    auto_provision_org: bool = False  # auto-create org + project on login (dev/SQLite only)

    # Mirth Connect - HL7v2 to FHIR conversion
    mirth_connect_url: str = ""
    mirth_connect_api_key: str = ""
    mirth_connect_timeout: int = 60

    # Redis — durable replay log for SessionEventReader (ADR-018 (supersedes ADR-017)).
    redis_url: str = ""

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
