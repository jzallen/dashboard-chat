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
        super().__init__(f"[MetadataRepository] {message}")


class LakeRepositoryError(RepositoryError):
    """Raised when the data lake storage encounters an error."""

    def __init__(self, message: str):
        super().__init__(f"[LakeRepository] {message}")


class OutboxRepositoryError(RepositoryError):
    """Raised when the outbox repository encounters an error."""

    def __init__(self, message: str):
        super().__init__(f"[OutboxRepository] {message}")


class ExternalAccessRepositoryError(RepositoryError):
    """Raised when the external access repository encounters an error."""

    def __init__(self, message: str):
        super().__init__(f"[ExternalAccessRepository] {message}")


class QueryEngineNodeRepositoryError(RepositoryError):
    """Raised when the query engine node repository encounters an error."""

    def __init__(self, message: str):
        super().__init__(f"[QueryEngineNodeRepository] {message}")
