"""Characterization tests — Seam 1: Dataset Ingestion controller.

Pins the CURRENT observable behavior of the dataset/upload/transform/search
endpoints on HTTPController (L66-196 + L314-321). These tests must remain green
after extraction to `dataset_controller.py`.

Existing coverage in test_http_controller.py covers:
- TestGetDataset (success 200 / 404 / 500)
- TestListDatasets (success / 400 / 404)
- TestPatchDataset (success 200 / 404)
- TestPostDataset (success 201 / 404 / 409)
- TestPostUpload (success 201 / 400 x2)
- TestListProjectDatasets (success / 404)

Gaps pinned here:
- post_transforms, patch_transforms, preview_transform (success + failure envelope).
- search_datasets envelope shape.
- list_datasets and list_project_datasets envelope `links` and `meta.page` detail.
- get_dataset passes through include_* kwargs to the use case.
- post_dataset forwards all kwargs (upload_id, partition_fields, description,
  plugin_registry, choices).
- post_upload forwards all kwargs.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController
from app.use_cases.dataset.exceptions import (
    ColumnTypeMismatch,
    DatasetNotFound,
    InvalidExpressionConfig,
    PreviewNotSupported,
)
from app.use_cases.upload.exceptions import UnsupportedFormat


@dataclass
class _Model:
    id: str
    name: str = "thing"

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# Transforms — post / patch / preview (L171-196)
# ---------------------------------------------------------------------------


class TestPostTransformsCharacterization:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_201_with_ok_true(self, mock_uc):
        mock_uc.create_transforms = AsyncMock(return_value=Success(None))
        body, status = await HTTPController.post_transforms(
            "d1", [{"column": "c", "expression": {"op": "TRIM"}}]
        )
        assert status == 201
        assert body == {"ok": True}
        mock_uc.create_transforms.assert_awaited_once_with(
            "d1", [{"column": "c", "expression": {"op": "TRIM"}}]
        )

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_dataset_not_found_returns_404(self, mock_uc):
        mock_uc.create_transforms = AsyncMock(
            return_value=Failure(DatasetNotFound("d1"))
        )
        body, status = await HTTPController.post_transforms("d1", [])
        assert status == 404
        assert body["errors"][0]["title"] == "Dataset Not Found"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_invalid_expression_returns_400(self, mock_uc):
        mock_uc.create_transforms = AsyncMock(
            return_value=Failure(InvalidExpressionConfig("bad config"))
        )
        _, status = await HTTPController.post_transforms("d1", [])
        assert status == 400


class TestPatchTransformsCharacterization:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_200_with_ok_true(self, mock_uc):
        mock_uc.update_transforms = AsyncMock(return_value=Success(None))
        body, status = await HTTPController.patch_transforms(
            "d1", [{"id": "t1", "expression": {}}]
        )
        assert status == 200
        assert body == {"ok": True}

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_dataset_not_found_returns_404(self, mock_uc):
        mock_uc.update_transforms = AsyncMock(
            return_value=Failure(DatasetNotFound("d1"))
        )
        _, status = await HTTPController.patch_transforms("d1", [])
        assert status == 404


class TestPreviewTransformCharacterization:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_200_with_raw_data_envelope(self, mock_uc):
        """preview uses a bespoke `{'data': ...}` envelope, NOT JSON:API
        (see L194). Lift-and-shift must preserve this."""
        mock_uc.preview_cleaning_transform = AsyncMock(
            return_value=Success({"before": [1, 2], "after": [1, 2]})
        )
        body, status = await HTTPController.preview_transform(
            "d1", "col", {"op": "TRIM"}
        )
        assert status == 200
        assert body == {"data": {"before": [1, 2], "after": [1, 2]}}

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_preview_not_supported_returns_400(self, mock_uc):
        mock_uc.preview_cleaning_transform = AsyncMock(
            return_value=Failure(PreviewNotSupported("OP"))
        )
        _, status = await HTTPController.preview_transform("d1", "col", {})
        assert status == 400

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_column_type_mismatch_returns_422(self, mock_uc):
        mock_uc.preview_cleaning_transform = AsyncMock(
            return_value=Failure(ColumnTypeMismatch("col", "int", "TRIM"))
        )
        _, status = await HTTPController.preview_transform("d1", "col", {})
        assert status == 422


# ---------------------------------------------------------------------------
# search_datasets (L314-321) — raw `{data: ...}` envelope, NOT JSON:API
# ---------------------------------------------------------------------------


class TestSearchDatasetsCharacterization:
    @patch("app.controllers.http_controller.search_datasets_uc")
    async def test_success_returns_200_with_raw_data_envelope(self, mock_uc):
        mock_uc.search_datasets = AsyncMock(
            return_value=Success([{"id": "d1", "name": "DS"}])
        )
        body, status = await HTTPController.search_datasets("p1", "query", user=None)
        assert status == 200
        # Raw envelope — not JSON:API list
        assert body == {"data": [{"id": "d1", "name": "DS"}]}

    @patch("app.controllers.http_controller.search_datasets_uc")
    async def test_failure_returns_500(self, mock_uc):
        mock_uc.search_datasets = AsyncMock(
            return_value=Failure(RuntimeError("boom"))
        )
        _, status = await HTTPController.search_datasets("p1", "query", user=None)
        assert status == 500

    @patch("app.controllers.http_controller.search_datasets_uc")
    async def test_forwards_project_id_query_and_user(self, mock_uc):
        mock_uc.search_datasets = AsyncMock(return_value=Success([]))
        await HTTPController.search_datasets("p1", "find me", user="USER_SENTINEL")
        mock_uc.search_datasets.assert_awaited_once_with(
            "p1", "find me", user="USER_SENTINEL"
        )


# ---------------------------------------------------------------------------
# list_datasets — pagination envelope detail (L66-82)
# ---------------------------------------------------------------------------


class TestListDatasetsEnvelopeDetail:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_envelope_includes_pagination_metadata(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(
            return_value=Success(
                {
                    "items": [_Model("d1", "A"), _Model("d2", "B")],
                    "next_cursor": "CURSOR_XYZ",
                    "has_more": True,
                    "page_size": 25,
                }
            )
        )
        body, status = await HTTPController.list_datasets(
            "p1", cursor="IN", page_size=25, base_url="/api/custom"
        )
        assert status == 200
        assert body["data"] == [
            {"id": "d1", "type": "datasets", "attributes": {"name": "A"}},
            {"id": "d2", "type": "datasets", "attributes": {"name": "B"}},
        ]
        assert body["meta"]["page"] == {"size": 25, "has_more": True}
        # links should include pagination; self is always present
        assert "self" in body["links"]
        mock_uc.list_datasets.assert_awaited_once_with(
            "p1", cursor="IN", page_size=25
        )


class TestListProjectDatasetsUrl:
    """L84-101 builds `{base_url}/{project_id}/datasets` for its links."""

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_url_includes_project_id(self, mock_uc):
        mock_uc.list_datasets_for_project = AsyncMock(
            return_value=Success(
                {
                    "items": [],
                    "next_cursor": None,
                    "has_more": False,
                    "page_size": 50,
                }
            )
        )
        body, _ = await HTTPController.list_project_datasets(
            "PROJECT-42", base_url="/api/projects"
        )
        # self link points at the nested resource route
        assert "/api/projects/PROJECT-42/datasets" in body["links"]["self"]


# ---------------------------------------------------------------------------
# get_dataset kwargs forwarding (L103-112)
# ---------------------------------------------------------------------------


class TestGetDatasetKwargForwarding:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_forwards_all_kwargs(self, mock_uc):
        mock_uc.get_dataset = AsyncMock(return_value=Success(_Model("d1")))
        await HTTPController.get_dataset(
            "d1", include_transforms=False, include_preview=True, preview_limit=100
        )
        mock_uc.get_dataset.assert_awaited_once_with("d1", False, True, 100)


# ---------------------------------------------------------------------------
# post_dataset kwargs forwarding (L123-143)
# ---------------------------------------------------------------------------


class TestPostDatasetKwargForwarding:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_forwards_all_kwargs_to_use_case(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(
            return_value=Success(_Model("d1"))
        )
        registry = object()
        await HTTPController.post_dataset(
            upload_id="u1",
            partition_fields=["region"],
            description="desc",
            plugin_registry=registry,
            choices={"a": "b"},
        )
        mock_uc.create_dataset_from_upload.assert_awaited_once_with(
            upload_id="u1",
            partition_fields=["region"],
            description="desc",
            plugin_registry=registry,
            choices={"a": "b"},
        )

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_self_link_contains_new_dataset_id(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(
            return_value=Success(_Model("NEW-DS-ID", "New"))
        )
        body, status = await HTTPController.post_dataset("u1")
        assert status == 201
        assert body["links"]["self"] == "/api/datasets/NEW-DS-ID"


# ---------------------------------------------------------------------------
# post_upload kwargs forwarding (L145-167)
# ---------------------------------------------------------------------------


class TestPostUploadKwargForwarding:
    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_forwards_all_kwargs(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Success(_Model("u1", "up")))
        registry = object()
        proj = {"id": "p1"}
        await HTTPController.post_upload(
            file_content=b"bytes",
            file_name="f.csv",
            project_id="p1",
            plugin_registry=registry,
            dataset_id="d-existing",
            project=proj,
        )
        mock_uc.upload_file.assert_awaited_once_with(
            file_content=b"bytes",
            file_name="f.csv",
            project_id="p1",
            plugin_registry=registry,
            dataset_id="d-existing",
            project=proj,
        )

    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_unsupported_format_returns_400(self, mock_uc):
        mock_uc.upload_file = AsyncMock(
            return_value=Failure(UnsupportedFormat(".parquet", [".csv"]))
        )
        _, status = await HTTPController.post_upload(b"x", "f.parquet", "p1")
        assert status == 400

    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_self_link_contains_new_upload_id(self, mock_uc):
        mock_uc.upload_file = AsyncMock(
            return_value=Success(_Model("NEW-UP-ID", "x.csv"))
        )
        body, status = await HTTPController.post_upload(b"x", "x.csv", "p1")
        assert status == 201
        assert body["links"]["self"] == "/api/uploads/NEW-UP-ID"
