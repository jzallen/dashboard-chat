"""JSON:API response builders and cursor-based pagination helpers."""

from typing import Any

from app.utils.pagination import decode_cursor, encode_cursor  # noqa: F401 — re-export


def jsonapi_resource(resource_type: str, resource_id: str, attributes: dict[str, Any]) -> dict[str, Any]:
    """Build a JSON:API resource object {type, id, attributes}."""
    return {
        "type": resource_type,
        "id": resource_id,
        "attributes": {k: v for k, v in attributes.items() if k != "id"},
    }


def jsonapi_list(
    resource_type: str,
    items: list[dict[str, Any]],
    links: dict[str, str | None],
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Build a JSON:API list response with pagination."""
    return {
        "data": [jsonapi_resource(resource_type, item["id"], item) for item in items],
        "links": links,
        "meta": meta,
    }


def jsonapi_single(
    resource_type: str,
    item: dict[str, Any],
    self_link: str,
) -> dict[str, Any]:
    """Build a JSON:API single-resource response."""
    return {
        "data": jsonapi_resource(resource_type, item["id"], item),
        "links": {"self": self_link},
    }


def jsonapi_error(status: str, title: str, detail: str) -> dict[str, Any]:
    """Build a JSON:API error response."""
    return {
        "errors": [{"status": status, "title": title, "detail": detail}],
    }


# ---------------------------------------------------------------------------
# Pagination link builder
# ---------------------------------------------------------------------------


def build_pagination_links(
    base_url: str,
    page_size: int,
    next_cursor: str | None,
) -> dict[str, str | None]:
    """Build JSON:API pagination links."""
    self_link = f"{base_url}?page[size]={page_size}"
    next_link = f"{base_url}?page[after]={next_cursor}&page[size]={page_size}" if next_cursor else None
    return {"self": self_link, "next": next_link, "prev": None}
