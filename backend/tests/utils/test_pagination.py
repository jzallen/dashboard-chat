"""Tests for cursor-based pagination helpers."""

import base64
import json

import pytest

from app.use_cases.exceptions import DomainException
from app.utils.pagination import InvalidCursor, decode_cursor, encode_cursor


class TestCursorRoundTrip:
    def test_encode_decode_roundtrip(self):
        original_id = "01914c3b-0a7d-7f3e-b5c4-123456789abc"
        cursor = encode_cursor(original_id)
        assert decode_cursor(cursor) == original_id

    def test_cursor_is_url_safe(self):
        cursor = encode_cursor("01914c3b-0a7d-7f3e-b5c4-123456789abc")
        assert "+" not in cursor
        assert "/" not in cursor


class TestDecodeCursorValidation:
    def test_decode_bad_base64(self):
        with pytest.raises(InvalidCursor):
            decode_cursor("!!!not-base64!!!")

    def test_decode_valid_base64_bad_json(self):
        raw = base64.urlsafe_b64encode(b"not json").decode().rstrip("=")
        with pytest.raises(InvalidCursor):
            decode_cursor(raw)

    def test_decode_missing_id_key(self):
        raw = base64.urlsafe_b64encode(json.dumps({"foo": "bar"}).encode()).decode().rstrip("=")
        with pytest.raises(InvalidCursor, match="missing 'id' key"):
            decode_cursor(raw)

    def test_decode_non_uuid_value(self):
        raw = base64.urlsafe_b64encode(json.dumps({"id": "not-a-uuid"}).encode()).decode().rstrip("=")
        with pytest.raises(InvalidCursor, match="not a valid UUID"):
            decode_cursor(raw)


class TestInvalidCursorIsDomainException:
    def test_inherits_from_domain_exception(self):
        assert issubclass(InvalidCursor, DomainException)

    def test_status_code_is_400(self):
        exc = InvalidCursor("test")
        assert exc._status_code == 400

    def test_type_and_title(self):
        exc = InvalidCursor("test")
        assert exc._type == "INVALID_CURSOR"
        assert exc._title == "Invalid Cursor"
