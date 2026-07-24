"""DatasetController — use-case dependency injection at the controller seam.

Exercises the pattern that replaces the http_controller late-binding shim: each
endpoint takes a keyword-only ``*_func`` dependency typed against a Protocol, so
a test injects a fake use case matching that interface instead of monkeypatching
a module-level alias. No database, no ASGI stack — the controller is unit-tested
against injected fakes, and each test asserts the whole ``(body, status)`` result.

The envelope tests assert the full response (JSON:API for the CRUD endpoints, the
bespoke ``{"data": ...}`` / ``{"ok": True}`` shapes for search and transforms);
the forwarding tests spy on the injected use case to pin the argument contract the
controller relies on — including the ``patch_dataset`` collapse of ``**kwargs``
into an ``update_dict`` and the ``get_dataset`` positional include-flag passthrough.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec — compare the full envelope,
don't weaken to spot-checks, and build expected values from literals here rather
than echoing the fake's return.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock

from returns.result import Failure, Success

from app.controllers.dataset_controller import DatasetController
from app.use_cases.dataset.exceptions import (
    ColumnTypeMismatch,
    DatasetNotFound,
    InvalidExpressionConfig,
    PreviewNotSupported,
)
from app.use_cases.project.exceptions import ProjectIdRequired, ProjectNotFound
from app.use_cases.upload.exceptions import (
    UnsupportedFormat,
    UploadAlreadyProcessed,
    UploadNotFound,
)


@dataclass
class _Model:
    """Serializable domain model stand-in returned by the fake use cases."""

    id: str
    name: str = "thing"

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# list_datasets
# ---------------------------------------------------------------------------


async def test_list_datasets__when_use_case_succeeds__returns_200_with_serialized_paginated_envelope():
    async def fake_list_datasets(project_id, *, cursor, page_size, archived):
        return Success(
            {
                "items": [_Model("d1", "A"), _Model("d2", "B")],
                "next_cursor": "CURSOR_XYZ",
                "has_more": True,
                "page_size": 25,
            }
        )

    result = await DatasetController.list_datasets("p1", page_size=25, list_datasets_func=fake_list_datasets)

    assert result == (
        {
            "data": [
                {"type": "datasets", "id": "d1", "attributes": {"name": "A"}},
                {"type": "datasets", "id": "d2", "attributes": {"name": "B"}},
            ],
            "links": {
                "self": "/api/datasets?page[size]=25",
                "next": "/api/datasets?page[after]=CURSOR_XYZ&page[size]=25",
                "prev": None,
            },
            "meta": {"page": {"size": 25, "has_more": True}},
        },
        200,
    )


async def test_list_datasets__when_project_id_required__returns_400_error_envelope():
    async def fake_list_datasets(project_id, *, cursor, page_size, archived):
        return Failure(ProjectIdRequired())

    _, status = await DatasetController.list_datasets(None, list_datasets_func=fake_list_datasets)

    assert status == 400


async def test_list_datasets__when_project_not_found__returns_404_error_envelope():
    async def fake_list_datasets(project_id, *, cursor, page_size, archived):
        return Failure(ProjectNotFound("p1"))

    _, status = await DatasetController.list_datasets("p1", list_datasets_func=fake_list_datasets)

    assert status == 404


async def test_list_datasets__when_given_cursor_page_size_and_archived__forwards_them_to_use_case():
    fake = AsyncMock(return_value=Success({"items": [], "next_cursor": None, "has_more": False, "page_size": 25}))

    await DatasetController.list_datasets("p1", cursor="IN", page_size=25, archived=True, list_datasets_func=fake)

    fake.assert_awaited_once_with("p1", cursor="IN", page_size=25, archived=True)


async def test_list_datasets__when_no_archived_arg__forwards_none_by_default():
    fake = AsyncMock(return_value=Success({"items": [], "next_cursor": None, "has_more": False, "page_size": 50}))

    await DatasetController.list_datasets("p1", list_datasets_func=fake)

    fake.assert_awaited_once_with("p1", cursor=None, page_size=50, archived=None)


# ---------------------------------------------------------------------------
# list_project_datasets — nested resource URL
# ---------------------------------------------------------------------------


async def test_list_project_datasets__when_use_case_succeeds__returns_200_with_nested_resource_links():
    async def fake_list_for_project(project_id, *, cursor, page_size, archived):
        return Success(
            {
                "items": [{"id": "d1", "name": "DS"}],
                "next_cursor": None,
                "has_more": False,
                "page_size": 50,
            }
        )

    result = await DatasetController.list_project_datasets(
        "PROJECT-42", list_datasets_for_project_func=fake_list_for_project
    )

    assert result == (
        {
            "data": [{"type": "datasets", "id": "d1", "attributes": {"name": "DS"}}],
            "links": {
                "self": "/api/projects/PROJECT-42/datasets?page[size]=50",
                "next": None,
                "prev": None,
            },
            "meta": {"page": {"size": 50, "has_more": False}},
        },
        200,
    )


async def test_list_project_datasets__when_project_not_found__returns_404_error_envelope():
    async def fake_list_for_project(project_id, *, cursor, page_size, archived):
        return Failure(ProjectNotFound("p1"))

    _, status = await DatasetController.list_project_datasets(
        "p1", list_datasets_for_project_func=fake_list_for_project
    )

    assert status == 404


# ---------------------------------------------------------------------------
# get_dataset
# ---------------------------------------------------------------------------


async def test_get_dataset__when_use_case_succeeds__returns_200_with_single_envelope():
    async def fake_get_dataset(dataset_id, include_transforms, include_preview, preview_limit):
        return Success(_Model("d1", "My Dataset"))

    result = await DatasetController.get_dataset("d1", get_dataset_func=fake_get_dataset)

    assert result == (
        {
            "data": {"type": "datasets", "id": "d1", "attributes": {"name": "My Dataset"}},
            "links": {"self": "/api/datasets/d1"},
        },
        200,
    )


async def test_get_dataset__when_dataset_not_found__returns_404_error_envelope():
    async def fake_get_dataset(dataset_id, include_transforms, include_preview, preview_limit):
        return Failure(DatasetNotFound("d1"))

    _, status = await DatasetController.get_dataset("d1", get_dataset_func=fake_get_dataset)

    assert status == 404


async def test_get_dataset__when_use_case_raises_unknown_error__returns_500_error_envelope():
    async def fake_get_dataset(dataset_id, include_transforms, include_preview, preview_limit):
        return Failure(RuntimeError("Database exploded"))

    _, status = await DatasetController.get_dataset("d1", get_dataset_func=fake_get_dataset)

    assert status == 500


async def test_get_dataset__when_given_include_flags__forwards_them_positionally_to_use_case():
    fake = AsyncMock(return_value=Success(_Model("d1")))

    await DatasetController.get_dataset(
        "d1", include_transforms=False, include_preview=True, preview_limit=100, get_dataset_func=fake
    )

    fake.assert_awaited_once_with("d1", False, True, 100)


# ---------------------------------------------------------------------------
# patch_dataset
# ---------------------------------------------------------------------------


async def test_patch_dataset__when_use_case_succeeds__returns_200_with_updated_envelope():
    async def fake_update_dataset(dataset_id, update_dict):
        return Success(_Model(dataset_id, update_dict["name"]))

    result = await DatasetController.patch_dataset("d1", name="Updated", update_dataset_func=fake_update_dataset)

    assert result == (
        {
            "data": {"type": "datasets", "id": "d1", "attributes": {"name": "Updated"}},
            "links": {"self": "/api/datasets/d1"},
        },
        200,
    )


async def test_patch_dataset__when_dataset_not_found__returns_404_error_envelope():
    async def fake_update_dataset(dataset_id, update_dict):
        return Failure(DatasetNotFound("d1"))

    _, status = await DatasetController.patch_dataset("d1", name="X", update_dataset_func=fake_update_dataset)

    assert status == 404


async def test_patch_dataset__when_given_body_kwargs__collapses_them_into_update_dict():
    fake = AsyncMock(return_value=Success(_Model("d1", "Updated")))

    await DatasetController.patch_dataset("d1", name="Updated", description="New", update_dataset_func=fake)

    fake.assert_awaited_once_with("d1", {"name": "Updated", "description": "New"})


# ---------------------------------------------------------------------------
# archive_dataset / restore_dataset (cold storage)
# ---------------------------------------------------------------------------


async def test_archive_dataset__when_use_case_succeeds__returns_200_with_single_envelope():
    async def fake_archive_dataset(dataset_id):
        return Success(_Model("d1", "Archived"))

    result = await DatasetController.archive_dataset("d1", archive_dataset_func=fake_archive_dataset)

    assert result == (
        {
            "data": {"type": "datasets", "id": "d1", "attributes": {"name": "Archived"}},
            "links": {"self": "/api/datasets/d1"},
        },
        200,
    )


async def test_restore_dataset__when_use_case_succeeds__returns_200_with_single_envelope():
    async def fake_restore_dataset(dataset_id):
        return Success(_Model("d1", "Restored"))

    result = await DatasetController.restore_dataset("d1", restore_dataset_func=fake_restore_dataset)

    assert result == (
        {
            "data": {"type": "datasets", "id": "d1", "attributes": {"name": "Restored"}},
            "links": {"self": "/api/datasets/d1"},
        },
        200,
    )


async def test_archive_dataset__when_dataset_not_found__returns_404_error_envelope():
    async def fake_archive_dataset(dataset_id):
        return Failure(DatasetNotFound("d1"))

    _, status = await DatasetController.archive_dataset("d1", archive_dataset_func=fake_archive_dataset)

    assert status == 404


# ---------------------------------------------------------------------------
# post_dataset
# ---------------------------------------------------------------------------


async def test_post_dataset__when_use_case_succeeds__returns_201_with_self_link_to_new_dataset():
    async def fake_create_dataset(*, upload_id, partition_fields, description, plugin_registry, choices):
        return Success(_Model("NEW-DS-ID", "New"))

    result = await DatasetController.post_dataset("u1", create_dataset_func=fake_create_dataset)

    assert result == (
        {
            "data": {"type": "datasets", "id": "NEW-DS-ID", "attributes": {"name": "New"}},
            "links": {"self": "/api/datasets/NEW-DS-ID"},
        },
        201,
    )


async def test_post_dataset__when_upload_not_found__returns_404_error_envelope():
    async def fake_create_dataset(*, upload_id, partition_fields, description, plugin_registry, choices):
        return Failure(UploadNotFound("u1"))

    _, status = await DatasetController.post_dataset("u1", create_dataset_func=fake_create_dataset)

    assert status == 404


async def test_post_dataset__when_upload_already_processed__returns_409_error_envelope():
    async def fake_create_dataset(*, upload_id, partition_fields, description, plugin_registry, choices):
        return Failure(UploadAlreadyProcessed("u1"))

    _, status = await DatasetController.post_dataset("u1", create_dataset_func=fake_create_dataset)

    assert status == 409


async def test_post_dataset__when_given_all_args__forwards_them_as_keywords_to_use_case():
    fake = AsyncMock(return_value=Success(_Model("d1")))
    registry = object()

    await DatasetController.post_dataset(
        upload_id="u1",
        partition_fields=["region"],
        description="desc",
        plugin_registry=registry,
        choices={"a": "b"},
        create_dataset_func=fake,
    )

    fake.assert_awaited_once_with(
        upload_id="u1",
        partition_fields=["region"],
        description="desc",
        plugin_registry=registry,
        choices={"a": "b"},
    )


# ---------------------------------------------------------------------------
# post_upload
# ---------------------------------------------------------------------------


async def test_post_upload__when_use_case_succeeds__returns_201_with_self_link_to_new_upload():
    async def fake_upload_file(*, file_content, file_name, project_id, plugin_registry, dataset_id, project):
        return Success(_Model("NEW-UP-ID", "x.csv"))

    result = await DatasetController.post_upload(b"x", "x.csv", "p1", upload_file_func=fake_upload_file)

    assert result == (
        {
            "data": {"type": "uploads", "id": "NEW-UP-ID", "attributes": {"name": "x.csv"}},
            "links": {"self": "/api/uploads/NEW-UP-ID"},
        },
        201,
    )


async def test_post_upload__when_file_format_unsupported__returns_400_error_envelope():
    async def fake_upload_file(*, file_content, file_name, project_id, plugin_registry, dataset_id, project):
        return Failure(UnsupportedFormat(".parquet", [".csv"]))

    _, status = await DatasetController.post_upload(b"x", "f.parquet", "p1", upload_file_func=fake_upload_file)

    assert status == 400


async def test_post_upload__when_given_all_args__forwards_them_as_keywords_to_use_case():
    fake = AsyncMock(return_value=Success(_Model("u1", "up")))
    registry = object()
    proj = {"id": "p1"}

    await DatasetController.post_upload(
        file_content=b"bytes",
        file_name="f.csv",
        project_id="p1",
        plugin_registry=registry,
        dataset_id="d-existing",
        project=proj,
        upload_file_func=fake,
    )

    fake.assert_awaited_once_with(
        file_content=b"bytes",
        file_name="f.csv",
        project_id="p1",
        plugin_registry=registry,
        dataset_id="d-existing",
        project=proj,
    )


# ---------------------------------------------------------------------------
# Transforms — post / patch use a bespoke {"ok": True} envelope
# ---------------------------------------------------------------------------


async def test_post_transforms__when_use_case_succeeds__returns_201_with_ok_true():
    async def fake_create_transforms(dataset_id, transforms_input):
        return Success(None)

    result = await DatasetController.post_transforms(
        "d1", [{"column": "c", "expression": {"op": "TRIM"}}], create_transforms_func=fake_create_transforms
    )

    assert result == ({"ok": True}, 201)


async def test_post_transforms__when_given_dataset_id_and_transforms__forwards_them_to_use_case():
    fake = AsyncMock(return_value=Success(None))
    transforms = [{"column": "c", "expression": {"op": "TRIM"}}]

    await DatasetController.post_transforms("d1", transforms, create_transforms_func=fake)

    fake.assert_awaited_once_with("d1", transforms)


async def test_post_transforms__when_dataset_not_found__returns_404_error_envelope():
    async def fake_create_transforms(dataset_id, transforms_input):
        return Failure(DatasetNotFound("d1"))

    result = await DatasetController.post_transforms("d1", [], create_transforms_func=fake_create_transforms)

    assert result == (
        {"errors": [{"status": "404", "title": "Dataset Not Found", "detail": "Dataset with ID 'd1' not found"}]},
        404,
    )


async def test_post_transforms__when_expression_invalid__returns_400_error_envelope():
    async def fake_create_transforms(dataset_id, transforms_input):
        return Failure(InvalidExpressionConfig("bad config"))

    _, status = await DatasetController.post_transforms("d1", [], create_transforms_func=fake_create_transforms)

    assert status == 400


async def test_patch_transforms__when_use_case_succeeds__returns_200_with_ok_true():
    async def fake_update_transforms(dataset_id, updates):
        return Success(None)

    result = await DatasetController.patch_transforms(
        "d1", [{"id": "t1", "expression": {}}], update_transforms_func=fake_update_transforms
    )

    assert result == ({"ok": True}, 200)


async def test_patch_transforms__when_given_dataset_id_and_updates__forwards_them_to_use_case():
    fake = AsyncMock(return_value=Success(None))
    updates = [{"id": "t1", "expression": {}}]

    await DatasetController.patch_transforms("d1", updates, update_transforms_func=fake)

    fake.assert_awaited_once_with("d1", updates)


async def test_patch_transforms__when_dataset_not_found__returns_404_error_envelope():
    async def fake_update_transforms(dataset_id, updates):
        return Failure(DatasetNotFound("d1"))

    _, status = await DatasetController.patch_transforms("d1", [], update_transforms_func=fake_update_transforms)

    assert status == 404


# ---------------------------------------------------------------------------
# preview_transform — bespoke {"data": ...} envelope, NOT JSON:API
# ---------------------------------------------------------------------------


async def test_preview_transform__when_use_case_succeeds__returns_200_with_raw_data_envelope():
    async def fake_preview(dataset_id, target_column, expression_config):
        return Success({"before": [1, 2], "after": [1, 2]})

    result = await DatasetController.preview_transform("d1", "col", {"op": "TRIM"}, preview_transform_func=fake_preview)

    assert result == ({"data": {"before": [1, 2], "after": [1, 2]}}, 200)


async def test_preview_transform__when_operation_not_supported__returns_400_error_envelope():
    async def fake_preview(dataset_id, target_column, expression_config):
        return Failure(PreviewNotSupported("OP"))

    _, status = await DatasetController.preview_transform("d1", "col", {}, preview_transform_func=fake_preview)

    assert status == 400


async def test_preview_transform__when_column_type_mismatches__returns_422_error_envelope():
    async def fake_preview(dataset_id, target_column, expression_config):
        return Failure(ColumnTypeMismatch("col", "int", "TRIM"))

    _, status = await DatasetController.preview_transform("d1", "col", {}, preview_transform_func=fake_preview)

    assert status == 422


# ---------------------------------------------------------------------------
# search_datasets — bespoke {"data": ...} envelope, NOT JSON:API
# ---------------------------------------------------------------------------


async def test_search_datasets__when_use_case_succeeds__returns_200_with_raw_data_envelope():
    async def fake_search(project_id, query, *, user):
        return Success([{"id": "d1", "name": "DS"}])

    result = await DatasetController.search_datasets("p1", "query", None, search_datasets_func=fake_search)

    assert result == ({"data": [{"id": "d1", "name": "DS"}]}, 200)


async def test_search_datasets__when_use_case_raises_unknown_error__returns_500_error_envelope():
    async def fake_search(project_id, query, *, user):
        return Failure(RuntimeError("boom"))

    _, status = await DatasetController.search_datasets("p1", "query", None, search_datasets_func=fake_search)

    assert status == 500


async def test_search_datasets__when_given_project_query_and_user__forwards_them_to_use_case():
    fake = AsyncMock(return_value=Success([]))

    await DatasetController.search_datasets("p1", "find me", "USER_SENTINEL", search_datasets_func=fake)

    fake.assert_awaited_once_with("p1", "find me", user="USER_SENTINEL")
