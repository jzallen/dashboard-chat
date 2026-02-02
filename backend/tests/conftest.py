"""Pytest configuration and fixtures."""

import os
import sys
from pathlib import Path

import pytest
from moto import mock_aws

# Add backend directory to path for imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


@pytest.fixture(autouse=True)
def mock_s3():
    """Auto-use fixture that mocks all AWS S3 calls via moto.

    This runs for every test automatically, ensuring boto3 S3 calls
    go to moto's in-memory mock instead of real S3/MinIO.
    """
    with mock_aws():
        # Create the test bucket that MinIOLakeRepository expects
        import boto3
        from app.config import get_settings

        settings = get_settings()
        s3 = boto3.client(
            's3',
            region_name='us-east-1',
            aws_access_key_id='testing',
            aws_secret_access_key='testing',
        )
        s3.create_bucket(Bucket=settings.storage_bucket)

        yield s3
