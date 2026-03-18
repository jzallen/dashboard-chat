"""Hardened DuckDB connection factory.

All in-process DuckDB connections must be created through this module.
After extension loading and S3 configuration, external access and community
extensions are disabled to limit blast radius of any SQL injection.
"""

from collections.abc import Callable

import ibis

from ..config import get_settings
from .sql_safety import validate_s3_endpoint, validate_s3_key


def create_hardened_duckdb_connection(
    *,
    configure_s3: bool = False,
    s3_configurator: Callable[[ibis.BaseBackend], None] | None = None,
) -> ibis.BaseBackend:
    """Create an in-memory DuckDB connection with security settings applied.

    Sequence:
    1. Create in-memory connection
    2. Install/load httpfs extension
    3. Configure S3/MinIO endpoint (if requested, via settings or custom hook)
    4. Set enable_external_access = false
    5. Set allow_community_extensions = false

    After step 4, no further filesystem/network access is possible
    except through the already-configured S3 endpoint.

    Args:
        configure_s3: If True, configure S3 from application settings.
        s3_configurator: Optional callback that receives the connection and
            configures S3 (installs httpfs, sets credentials). When provided,
            configure_s3 is ignored and this hook is used instead.
    """
    conn = ibis.duckdb.connect()

    # Always install httpfs before any S3 configuration or lockdown.
    conn.raw_sql("INSTALL httpfs; LOAD httpfs;")

    if s3_configurator is not None:
        s3_configurator(conn)
    elif configure_s3:
        settings = get_settings()
        if settings.storage_type == "minio":
            validate_s3_endpoint(settings.minio_endpoint)
            validate_s3_key(settings.minio_access_key or "")
            validate_s3_key(settings.minio_secret_key or "")
            endpoint = settings.minio_endpoint.replace("'", "''")
            access_key = (settings.minio_access_key or "").replace("'", "''")
            secret_key = (settings.minio_secret_key or "").replace("'", "''")
            use_ssl = "true" if settings.minio_secure else "false"
            conn.raw_sql(f"""
                SET s3_endpoint='{endpoint}';
                SET s3_access_key_id='{access_key}';
                SET s3_secret_access_key='{secret_key}';
                SET s3_use_ssl={use_ssl};
                SET s3_url_style='path';
            """)
        else:
            region = (settings.s3_region or "").replace("'", "''")
            conn.raw_sql(f"SET s3_region='{region}';")

    # Lock down: disable external access and community extensions.
    # These settings are irreversible per-session (DuckDB security feature).
    conn.raw_sql("SET enable_external_access = false;")
    conn.raw_sql("SET allow_community_extensions = false;")

    return conn
