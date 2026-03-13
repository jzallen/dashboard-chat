import pytest


@pytest.fixture(autouse=True)
def auto_mock_s3(mock_s3):
    """Auto-use S3 mocking for integration tests."""
    yield mock_s3
