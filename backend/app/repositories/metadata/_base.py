"""Shared infrastructure for per-aggregate metadata repositories (ADR-020).

Houses the decorator that translates SQLAlchemy errors into
``MetadataRepositoryError`` so every per-aggregate module can decorate its
methods without re-importing from ``repository.py``. Lifted out as part of
Phase 00 of the metadata-repository split per ADR-020 §Decision outcome step 1.
"""

from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from sqlalchemy.exc import SQLAlchemyError

from ..exceptions import MetadataRepositoryError

P = ParamSpec("P")
R = TypeVar("R")


def handle_repository_exceptions(func: Callable[P, R]) -> Callable[P, R]:
    """Wrap SQLAlchemyError as MetadataRepositoryError."""

    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return await func(*args, **kwargs)
        except SQLAlchemyError as e:
            raise MetadataRepositoryError(str(e)) from e

    return wrapper
