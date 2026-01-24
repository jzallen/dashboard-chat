"""Response wrapper utilities for consistent API responses."""

from typing import Any, TypeVar
from pydantic import BaseModel

T = TypeVar("T")


class ErrorDetail(BaseModel):
    """Error detail schema."""
    message: str
    code: str | None = None
    details: dict[str, Any] | None = None


class SuccessResponse(BaseModel):
    """Success response wrapper."""
    success: bool = True
    data: Any


class ErrorResponse(BaseModel):
    """Error response wrapper."""
    success: bool = False
    error: ErrorDetail


def wrap_success(data: Any) -> dict[str, Any]:
    """Wrap data in a success response."""
    return {"success": True, "data": data}


def wrap_error(message: str, code: str | None = None, details: dict[str, Any] | None = None) -> dict[str, Any]:
    """Wrap error in an error response."""
    error_detail = {"message": message}
    if code:
        error_detail["code"] = code
    if details:
        error_detail["details"] = details

    return {"success": False, "error": error_detail}
