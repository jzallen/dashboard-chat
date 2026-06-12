"""Shared HTTP result-mapping helpers used by every per-context controller.

Moved from `http_controller.py` as Seam 0 of the dc-e65d DDD refactor. The
two helpers translate use-case results (domain models / domain exceptions)
into HTTP-ready shapes. They are context-independent plumbing.

Package-private (leading underscore): only other modules under
`app/controllers/` should import from here. The legacy names
`_serialize` and `_error_response` are re-exported from
`http_controller` for test-compatibility (see seams.md Seam 8).
"""

import logging
from typing import Any

from app.use_cases.exceptions import DomainException

from .response_wrapper import wrap_jsonapi_error

logger = logging.getLogger(__name__)


def serialize(data: Any) -> Any:
    """Serialize use case result data for HTTP response.

    Handles single models and iterables by calling model.serialize().
    """
    match data:
        case _ if hasattr(data, "serialize"):
            return data.serialize()
        case list() | tuple():
            return [serialize(item) for item in data]
        case _:
            return data


def error_response(error: Exception) -> tuple[dict, int]:
    """Build a JSON:API error response from an exception.

    DomainException subclasses carry status_code, type, and title.
    All other exceptions map to a generic 500.
    """
    if isinstance(error, DomainException):
        body = wrap_jsonapi_error(error._status_code, error._title, str(error))
        if hasattr(error, "retry_after"):
            body["errors"][0]["retry_after"] = error.retry_after
        if hasattr(error, "detail"):
            # Machine-readable mismatch/validation detail for the UI to render
            # (e.g. SchemaMismatch's missing/extra/type_mismatch columns).
            body["errors"][0]["detail"] = error.detail
        return body, error._status_code

    logger.error("Unhandled error: %s", error)
    msg = "An unexpected error occurred. Check server logs for details."
    return wrap_jsonapi_error(500, "Internal Server Error", msg), 500
