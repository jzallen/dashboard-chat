"""Response wrapper utilities for consistent API responses."""

from typing import Any

from .jsonapi import build_pagination_links, jsonapi_error, jsonapi_list, jsonapi_single


def wrap_success(data: Any) -> dict[str, Any]:
    """Wrap data in a success response (legacy envelope)."""
    return {"success": True, "data": data}


def wrap_jsonapi_list(
    resource_type: str,
    items: list[dict[str, Any]],
    base_url: str,
    page_size: int,
    next_cursor: str | None,
    has_more: bool,
) -> dict[str, Any]:
    """Wrap a list of items in a JSON:API envelope with pagination."""
    links = build_pagination_links(base_url, page_size, next_cursor)
    meta = {"page": {"size": page_size, "has_more": has_more}}
    return jsonapi_list(resource_type, items, links, meta)


def wrap_jsonapi_single(
    resource_type: str,
    item: dict[str, Any],
    self_link: str,
) -> dict[str, Any]:
    """Wrap a single item in a JSON:API envelope."""
    return jsonapi_single(resource_type, item, self_link)


def wrap_jsonapi_error(status: int, title: str, detail: str) -> dict[str, Any]:
    """Wrap an error in a JSON:API error envelope."""
    return jsonapi_error(str(status), title, detail)
