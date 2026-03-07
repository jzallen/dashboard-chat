"""Cursor-based pagination helpers.

Encoding/decoding cursors for keyset pagination. Extracted from
controllers/jsonapi.py so the repository layer can use them without
a circular import.
"""

import base64
import json
import uuid

from app.use_cases.exceptions import DomainException


class InvalidCursor(DomainException):
    """Raised when a pagination cursor cannot be decoded."""

    _type: str = "INVALID_CURSOR"
    _title: str = "Invalid Cursor"
    _status_code: int = 400


def encode_cursor(record_id: str) -> str:
    """Encode a record ID as a base64url cursor."""
    payload = json.dumps({"id": record_id})
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> str:
    """Decode a base64url cursor back to a record ID.

    Raises InvalidCursor on malformed input.
    """
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = base64.urlsafe_b64decode(padded.encode()).decode()
        data = json.loads(payload)
    except Exception as exc:
        raise InvalidCursor(f"Malformed cursor: {cursor}") from exc

    record_id = data.get("id")
    if record_id is None:
        raise InvalidCursor(f"Cursor missing 'id' key: {cursor}")

    try:
        uuid.UUID(str(record_id))
    except ValueError as exc:
        raise InvalidCursor(f"Cursor 'id' is not a valid UUID: {record_id}") from exc

    return str(record_id)
