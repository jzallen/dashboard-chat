"""Source HTTP controller (Source bounded context).

Thin HTTP adapter for the Source aggregate. The router depends on this class
directly — there is deliberately no roll-up through a god ``HTTPController``.

Each endpoint declares its use case(s) as an injected, typed dependency: a
keyword-only ``*_func`` parameter defaulting to the real use case from
``app.use_cases.source``, typed against a ``Protocol`` that captures the call
interface the controller relies on. Production passes nothing (the defaults
bind); tests inject a function matching the Protocol instead of monkeypatching a
module-level alias. This is the seam that replaces the ``_uc()`` late-binding
shim inherited from the http_controller DDD refactor.
"""

from typing import TYPE_CHECKING, Any, Protocol

from returns.result import Failure, Result, Success

from app.use_cases import source as source_use_cases

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single

if TYPE_CHECKING:
    from app.auth.types import AuthUser


class CreateSourceProtocol(Protocol):
    """Call interface for the create-source use case."""

    async def __call__(
        self,
        *,
        project_id: str,
        name: str,
        schema_config: dict[str, Any] | None = None,
        user: "AuthUser | None" = None,
    ) -> Result: ...


class ListSourcesProtocol(Protocol):
    """Call interface for the list-sources use case."""

    async def __call__(self, project_id: str) -> Result: ...


class GetSourceProtocol(Protocol):
    """Call interface for the get-source use case."""

    async def __call__(self, source_id: str) -> Result: ...


class ArchiveSourceProtocol(Protocol):
    """Call interface for the archive-source use case (Cold-Storage toggle)."""

    async def __call__(self, source_id: str, *, archived: bool) -> Result: ...


class ListSourceUploadsProtocol(Protocol):
    """Call interface for the list-source-uploads use case."""

    async def __call__(self, source_id: str) -> Result: ...


class RecordUploadProtocol(Protocol):
    """Call interface for the record-upload use case."""

    async def __call__(
        self,
        *,
        source_id: str,
        filename: str,
        content_type: str,
        file_size: int,
        user: "AuthUser",
    ) -> Result: ...


class ProcessUploadProtocol(Protocol):
    """Call interface for the process-upload use case."""

    async def __call__(
        self,
        *,
        source_id: str,
        upload_id: str,
        plugin_registry: Any = None,
        choices: dict[str, str] | None = None,
    ) -> Result: ...


class SourceController:
    """Controller for Source aggregate HTTP endpoints."""

    @staticmethod
    async def post_source(
        project_id: str,
        name: str,
        schema_config: dict[str, Any] | None = None,
        user: "AuthUser | None" = None,
        *,
        create_source_func: CreateSourceProtocol = source_use_cases.create_source,
    ) -> tuple[dict, int]:
        result = await create_source_func(project_id=project_id, name=name, schema_config=schema_config, user=user)
        match result:
            case Success(data):
                serialized = serialize(data)
                return wrap_jsonapi_single("sources", serialized, f"/api/sources/{serialized['id']}"), 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def list_sources(
        project_id: str,
        *,
        list_sources_func: ListSourcesProtocol = source_use_cases.list_sources,
    ) -> tuple[dict, int]:
        result = await list_sources_func(project_id)
        match result:
            case Success(data):
                items = [serialize(i) for i in data]
                resp = wrap_jsonapi_list("sources", items, "/api/sources", len(items), None, False)
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def list_source_uploads(
        source_id: str,
        *,
        list_source_uploads_func: ListSourceUploadsProtocol = source_use_cases.list_source_uploads,
    ) -> tuple[dict, int]:
        """List a source's uploads (backs the upload modal's Files section).

        Wraps the upload dicts as a JSON:API ``uploads`` list. Each upload's
        ``id`` is its ``upload_id`` (the JSON:API resource id); the remaining
        fields become the resource attributes.
        """
        result = await list_source_uploads_func(source_id)
        match result:
            case Success(data):
                items = [{"id": upload["upload_id"], **upload} for upload in data]
                resp = wrap_jsonapi_list("uploads", items, f"/api/sources/{source_id}/uploads", len(items), None, False)
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_source(
        source_id: str,
        *,
        get_source_func: GetSourceProtocol = source_use_cases.get_source,
    ) -> tuple[dict, int]:
        result = await get_source_func(source_id)
        match result:
            case Success(data):
                return wrap_jsonapi_single("sources", serialize(data), f"/api/sources/{source_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_source_archived(
        source_id: str,
        archived: bool,
        *,
        archive_source_func: ArchiveSourceProtocol = source_use_cases.archive_source,
    ) -> tuple[dict, int]:
        """Toggle a source's Cold-Storage state (PATCH ``{archived}``)."""
        result = await archive_source_func(source_id, archived=archived)
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
        *,
        record_upload_func: RecordUploadProtocol = source_use_cases.record_upload,
    ) -> tuple[dict, int]:
        """Mint a presigned PUT URL for a direct browser upload. Returns 202.

        The response carries ``{upload_id, put_url, storage_key, status}``; the
        browser PUTs the file to ``put_url`` then calls the process endpoint.
        """
        result = await record_upload_func(
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
        *,
        process_upload_func: ProcessUploadProtocol = source_use_cases.process_upload,
    ) -> tuple[dict, int]:
        """Ingest a recorded upload and return the linked Dataset (200), an
        ``awaiting_input`` marker (202), or a domain error (4xx)."""
        result = await process_upload_func(
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
