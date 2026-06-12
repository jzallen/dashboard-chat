"""Source HTTP controller (Source aggregate, slice 1).

Thin HTTP adapter for the Source bounded context. Delegates to
``app/use_cases/source``. The ``source_use_cases`` alias is read off
``http_controller`` at call time so test patches on
``app.controllers.http_controller.source_use_cases`` continue to intercept.
"""

from typing import TYPE_CHECKING, Any

from returns.result import Failure, Success

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single

if TYPE_CHECKING:
    from app.auth.types import AuthUser


def _uc():
    from app.controllers import http_controller

    return http_controller.source_use_cases


class SourceController:
    """Controller for Source aggregate HTTP endpoints."""

    @staticmethod
    async def post_source(
        project_id: str,
        name: str,
        schema_config: dict[str, Any] | None = None,
        user: "AuthUser | None" = None,
    ) -> tuple[dict, int]:
        result = await _uc().create_source(project_id=project_id, name=name, schema_config=schema_config, user=user)
        match result:
            case Success(data):
                serialized = serialize(data)
                return wrap_jsonapi_single("sources", serialized, f"/api/sources/{serialized['id']}"), 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def list_sources(project_id: str) -> tuple[dict, int]:
        result = await _uc().list_sources(project_id)
        match result:
            case Success(data):
                items = [serialize(i) for i in data]
                resp = wrap_jsonapi_list("sources", items, "/api/sources", len(items), None, False)
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def list_source_uploads(source_id: str) -> tuple[dict, int]:
        """List a source's uploads (backs the upload modal's Files section).

        Wraps the upload dicts as a JSON:API ``uploads`` list. Each upload's
        ``id`` is its ``upload_id`` (the JSON:API resource id); the remaining
        fields become the resource attributes.
        """
        result = await _uc().list_source_uploads(source_id)
        match result:
            case Success(data):
                items = [{"id": upload["upload_id"], **upload} for upload in data]
                resp = wrap_jsonapi_list("uploads", items, f"/api/sources/{source_id}/uploads", len(items), None, False)
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_source(source_id: str) -> tuple[dict, int]:
        result = await _uc().get_source(source_id)
        match result:
            case Success(data):
                return wrap_jsonapi_single("sources", serialize(data), f"/api/sources/{source_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def record_source_upload(
        source_id: str,
        filename: str,
        content_type: str,
        file_size: int,
        user: "AuthUser",
    ) -> tuple[dict, int]:
        """Mint a presigned PUT URL for a direct browser upload. Returns 202.

        The response carries ``{upload_id, put_url, storage_key, status}``; the
        browser PUTs the file to ``put_url`` then calls the process endpoint.
        """
        result = await _uc().record_upload(
            source_id=source_id,
            filename=filename,
            content_type=content_type,
            file_size=file_size,
            user=user,
        )
        match result:
            case Success(data):
                return data, 202
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def process_source_upload(
        source_id: str,
        upload_id: str,
        plugin_registry: Any = None,
        choices: dict[str, str] | None = None,
    ) -> tuple[dict, int]:
        """Ingest a recorded upload and return the linked Dataset (200), an
        ``awaiting_input`` marker (202), or a domain error (4xx)."""
        result = await _uc().process_upload(
            source_id=source_id,
            upload_id=upload_id,
            plugin_registry=plugin_registry,
            choices=choices,
        )
        match result:
            case Success(data) if isinstance(data, dict) and data.get("status") == "awaiting_input":
                return data, 202
            case Success(data):
                serialized = serialize(data)
                return wrap_jsonapi_single("datasets", serialized, f"/api/datasets/{serialized['id']}"), 200
            case Failure(error):
                return error_response(error)
