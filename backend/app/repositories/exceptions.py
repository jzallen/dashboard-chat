"""Repository-specific exceptions.

These exceptions wrap infrastructure errors (SQLAlchemy, boto3) into
domain-specific repository errors for cleaner error handling in use cases.
"""


class RepositoryError(Exception):
    """Base class for repository errors."""
    pass


class MetadataRepositoryError(RepositoryError):
    """Raised when the metadata database encounters an error."""

    def __init__(self, message: str):
        super().__init__(f"Metadata repository error: {message}")


class LakeRepositoryError(RepositoryError):
    """Raised when the data lake storage encounters an error."""

    def __init__(self, message: str):
        super().__init__(f"Lake repository error: {message}")


class OutboxRepositoryError(RepositoryError):
    """Raised when the outbox repository encounters an error."""

    def __init__(self, message: str):
        super().__init__(f"Outbox repository error: {message}")
