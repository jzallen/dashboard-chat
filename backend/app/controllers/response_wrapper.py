"""Response wrapper utilities for consistent API responses."""

from typing import Any


def wrap_success(data: Any) -> dict[str, Any]:
    """Wrap data in a success response."""
    return {"success": True, "data": data}
