"""Tests for JSON:API response builders and cursor helpers."""

from app.controllers.jsonapi import (
    build_pagination_links,
    decode_cursor,
    encode_cursor,
    jsonapi_error,
    jsonapi_list,
    jsonapi_resource,
    jsonapi_single,
)


class TestCursorRoundTrip:
    def test_encode_decode_roundtrip(self):
        original_id = "01914c3b-0a7d-7f3e-b5c4-123456789abc"
        cursor = encode_cursor(original_id)
        assert decode_cursor(cursor) == original_id

    def test_cursor_is_url_safe(self):
        cursor = encode_cursor("some-id-with-chars")
        assert "+" not in cursor
        assert "/" not in cursor


class TestJsonapiResource:
    def test_separates_id_from_attributes(self):
        result = jsonapi_resource("projects", "p1", {"id": "p1", "name": "My Project", "description": None})
        assert result == {
            "type": "projects",
            "id": "p1",
            "attributes": {"name": "My Project", "description": None},
        }

    def test_handles_no_id_in_attributes(self):
        result = jsonapi_resource("projects", "p1", {"name": "Test"})
        assert result["id"] == "p1"
        assert result["attributes"] == {"name": "Test"}


class TestJsonapiList:
    def test_wraps_items_with_links_and_meta(self):
        items = [{"id": "p1", "name": "A"}, {"id": "p2", "name": "B"}]
        links = {"self": "/api/projects?page[size]=20", "next": None, "prev": None}
        meta = {"page": {"size": 20, "has_more": False}}
        result = jsonapi_list("projects", items, links, meta)

        assert len(result["data"]) == 2
        assert result["data"][0]["type"] == "projects"
        assert result["data"][0]["id"] == "p1"
        assert result["data"][0]["attributes"] == {"name": "A"}
        assert result["links"] == links
        assert result["meta"] == meta


class TestJsonapiSingle:
    def test_wraps_item_with_self_link(self):
        item = {"id": "p1", "name": "My Project"}
        result = jsonapi_single("projects", item, "/api/projects/p1")

        assert result["data"]["type"] == "projects"
        assert result["data"]["id"] == "p1"
        assert result["data"]["attributes"] == {"name": "My Project"}
        assert result["links"]["self"] == "/api/projects/p1"


class TestJsonapiError:
    def test_error_format(self):
        result = jsonapi_error("404", "Not Found", "Project not found")
        assert result == {
            "errors": [{"status": "404", "title": "Not Found", "detail": "Project not found"}],
        }


class TestBuildPaginationLinks:
    def test_with_next_cursor(self):
        cursor = encode_cursor("p5")
        links = build_pagination_links("/api/projects", 20, cursor)

        assert links["self"] == "/api/projects?page[size]=20"
        assert f"page[after]={cursor}" in links["next"]
        assert "page[size]=20" in links["next"]
        assert links["prev"] is None

    def test_without_next_cursor(self):
        links = build_pagination_links("/api/projects", 20, None)
        assert links["next"] is None
