"""Tests for the idempotent bucket-CORS helper (slice 2).

The browser PUTs directly to MinIO, so the bucket must allow the UI origin to
cross-origin PUT. Port-to-port at the helper's public API against a real moto
S3 backend (it implements put/get_bucket_cors), asserting the applied rule and
that re-applying converges (idempotent).
"""

import pytest

from app.config import get_settings
from app.repositories.lake.bucket_cors import build_cors_configuration, ensure_bucket_cors


@pytest.fixture
def s3(mock_s3):
    """The session moto client (bucket already created by the mock_s3 fixture)."""
    return mock_s3


def test_applies_put_cors_for_ui_origin(s3):
    ensure_bucket_cors(s3_client=s3)

    settings = get_settings()
    cors = s3.get_bucket_cors(Bucket=settings.storage_bucket)
    rule = cors["CORSRules"][0]
    assert "PUT" in rule["AllowedMethods"]
    # Every configured UI origin is allowed to PUT.
    for origin in settings.cors_origins_list:
        assert origin in rule["AllowedOrigins"]


def test_is_idempotent(s3):
    ensure_bucket_cors(s3_client=s3)
    ensure_bucket_cors(s3_client=s3)

    settings = get_settings()
    cors = s3.get_bucket_cors(Bucket=settings.storage_bucket)
    # Re-applying replaces the whole config — exactly one rule remains.
    assert len(cors["CORSRules"]) == 1
    assert "PUT" in cors["CORSRules"][0]["AllowedMethods"]


def test_cors_rule_exposes_etag_and_allows_preflight_headers():
    """The CORS rule exposes ETag (so the browser can confirm the write) and
    permits any request header (presigned PUTs carry Content-Type + auth qs)."""
    settings = get_settings()
    rule = build_cors_configuration(settings)["CORSRules"][0]
    assert rule["ExposeHeaders"] == ["ETag"]
    assert rule["AllowedHeaders"] == ["*"]
    assert set(rule["AllowedMethods"]) >= {"PUT"}
