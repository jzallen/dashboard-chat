"""Unit tests for MinIOLakeRepository.presigned_put_url (slice 2).

Port-to-port at the lake adapter's public signing API. The presign client
only computes a signature locally — no network — so these run without moto.
The contract: the minted URL targets the browser-reachable
``minio_public_endpoint`` host (NOT the internal client endpoint) and carries
an S3v4 signature in its query string.
"""

from urllib.parse import parse_qs, urlparse

import boto3
from botocore.config import Config

from app.config import get_settings
from app.repositories.lake import MinIOLakeRepository


def _public_presign_client():
    """A boto3 s3 client bound to the public endpoint, mirroring production wiring."""
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=f"http://{settings.minio_public_endpoint}",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
        config=Config(signature_version="s3v4"),
    )


class TestPresignedPutUrl:
    def test_url_host_is_public_endpoint(self):
        """The signed URL must target minio_public_endpoint, not the internal client host."""
        settings = get_settings()
        repo = MinIOLakeRepository(s3_client=boto3.client("s3"), presign_client=_public_presign_client())

        url = repo.presigned_put_url(
            storage_key="uploads/p/s/u/data.csv",
            content_type="text/csv",
            expires_in=900,
        )

        parsed = urlparse(url)
        assert parsed.netloc == settings.minio_public_endpoint
        assert parsed.path.endswith("/uploads/p/s/u/data.csv")

    def test_url_carries_s3v4_signature(self):
        """The presigned URL must contain an S3v4 signature query parameter."""
        repo = MinIOLakeRepository(s3_client=boto3.client("s3"), presign_client=_public_presign_client())

        url = repo.presigned_put_url(
            storage_key="uploads/p/s/u/data.csv",
            content_type="text/csv",
            expires_in=900,
        )

        query = parse_qs(urlparse(url).query)
        assert "X-Amz-Signature" in query
        assert "X-Amz-Algorithm" in query
        assert query["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]

    def test_default_presign_client_built_from_public_endpoint(self):
        """When no presign_client is injected, the repo builds one bound to the public endpoint."""
        settings = get_settings()
        repo = MinIOLakeRepository(s3_client=boto3.client("s3"))

        url = repo.presigned_put_url(
            storage_key="uploads/p/s/u/data.csv",
            content_type="text/csv",
            expires_in=900,
        )

        assert urlparse(url).netloc == settings.minio_public_endpoint
