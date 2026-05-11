"""Keyset-pagination helpers for metadata repositories.

Pure functions consolidating the has-more probe + slice + next-cursor encode
pattern that previously lived inline in every ``list_*`` method. Callers fetch
``limit + 1`` rows (when limit is not None) and pass the records through.

Underscore-prefixed module: repository-internal, not part of the public
repository surface.
"""

from collections.abc import Callable
from typing import TypeVar

from app.utils.pagination import encode_cursor

T = TypeVar("T")


def paginate_by_id(records: list[T], limit: int | None) -> tuple[list[T], str | None, bool]:
    """Simple keyset pagination — cursor encodes ``records_slice[-1].id``.

    Caller fetched ``limit + 1`` rows when ``limit`` is not None.
    When ``limit is None``, returns ``(records, None, False)`` unchanged.
    """
    if limit is None:
        return records, None, False

    has_more = len(records) > limit
    sliced = records[:limit]
    next_cursor = encode_cursor(sliced[-1].id) if has_more and sliced else None  # type: ignore[attr-defined]
    return sliced, next_cursor, has_more


def paginate_composite(
    records: list[T],
    limit: int,
    encode_fn: Callable[[T], str],
) -> tuple[list[T], str | None, bool]:
    """Composite-cursor pagination — caller provides ``encode_fn(record) → cursor``.

    Caller fetched ``limit + 1`` rows.
    """
    has_more = len(records) > limit
    sliced = records[:limit]
    next_cursor = encode_fn(sliced[-1]) if has_more and sliced else None
    return sliced, next_cursor, has_more
