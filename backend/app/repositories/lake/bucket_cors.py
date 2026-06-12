"""Idempotent bucket-CORS helper for direct browser uploads (slice 2).

The browser PUTs files directly to MinIO via a presigned URL, so the bucket
must allow the UI origin to issue cross-origin ``PUT`` (and the preflight
``OPTIONS``). MinIO supports per-bucket CORS via the S3 ``put_bucket_cors``
API. There is no app-server bucket-ensure path today (the bucket is created by
infra / the dev MinIO container), so this is a standalone idempotent helper:

    # one-off, against the running MinIO (dev):
    cd backend && uv run python -m app.repositories.lake.bucket_cors

Re-running is safe — ``put_bucket_cors`` replaces the whole CORS config, so
applying the same rule twice converges to the same state.
"""

from __future__ import annotations

import boto3
from botocore.config import Config

from app.config import get_settings


def _allowed_origins(settings) -> list[str]:
    """UI origins permitted to PUT directly to the bucket (from CORS settings)."""
    return settings.cors_origins_list


def build_cors_configuration(settings) -> dict:
    """Build the S3 CORS configuration allowing the UI origin to PUT.

    Allows ``PUT`` (the presigned upload), ``GET``/``HEAD`` (debugging), and
    exposes ``ETag`` so the browser can confirm the write.
    """
    return {
        "CORSRules": [
            {
                "AllowedOrigins": _allowed_origins(settings),
                "AllowedMethods": ["PUT", "GET", "HEAD"],
                "AllowedHeaders": ["*"],
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600,
            }
        ]
    }


def ensure_bucket_cors(s3_client=None) -> dict:
    """Apply the bucket CORS rule idempotently. Returns the applied config.

    Args:
        s3_client: Optional boto3 S3 client. Defaults to a client bound to
            ``minio_endpoint`` (the server-side host).
    """
    settings = get_settings()
    if s3_client is None:
        s3_client = boto3.client(
            "s3",
            endpoint_url=f"http://{settings.minio_endpoint}",
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            config=Config(signature_version="s3v4"),
        )

    cors_configuration = build_cors_configuration(settings)
    s3_client.put_bucket_cors(Bucket=settings.storage_bucket, CORSConfiguration=cors_configuration)
    return cors_configuration


if __name__ == "__main__":  # pragma: no cover - operational entrypoint
    applied = ensure_bucket_cors()
    print(f"Applied CORS to bucket; allowed origins: {applied['CORSRules'][0]['AllowedOrigins']}")
