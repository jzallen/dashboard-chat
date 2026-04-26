"""Server-wide pg_duckdb secret bootstrap.

PERSISTENT SECRETs in pg_duckdb are instance-global, not per-connection,
so they belong to the query-engine bootstrap rather than to any single
use case. This module owns the SQL builder for the MinIO secret and the
async helper that issues it on a given connection.

Both the query-engine pool factory in ``app.database`` and the legacy
``configure_s3_secrets`` re-export in ``sql_access._infra`` delegate here.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.utils.sql_safety import quote_literal as _quote_literal

if TYPE_CHECKING:
    import asyncpg

    from app.use_cases.sql_access._infra.provisioner import StorageConfig

logger = logging.getLogger(__name__)


def build_minio_secret_sql(storage_config: StorageConfig) -> str:
    """Render the CREATE OR REPLACE PERSISTENT SECRET statement for MinIO."""
    use_ssl_str = "true" if storage_config.use_ssl else "false"
    return f"""
SELECT duckdb.raw_query($q$
  CREATE OR REPLACE PERSISTENT SECRET minio_secret (
    TYPE S3,
    KEY_ID {_quote_literal(storage_config.access_key)},
    SECRET {_quote_literal(storage_config.secret_key)},
    ENDPOINT {_quote_literal(storage_config.endpoint)},
    URL_STYLE {_quote_literal(storage_config.url_style)},
    USE_SSL {use_ssl_str},
    REGION {_quote_literal(storage_config.region)}
  );
$q$);
"""


async def ensure_minio_secret(conn: asyncpg.Connection, storage_config: StorageConfig) -> None:
    """Issue the persistent MinIO secret on ``conn``.

    Idempotent at the SQL level (CREATE OR REPLACE), so repeated calls are
    safe. Used both by the query-engine pool factory at first acquire and
    by the legacy ``configure_s3_secrets`` entry point.
    """
    await conn.execute(build_minio_secret_sql(storage_config))
    logger.info("Configured MinIO persistent secret on query-engine connection")
