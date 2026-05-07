"""Characterization tests for the dataset-layer harness mappers + bearer helper.

These tests pin the public data-shape behaviour of the inline mappers and the
``bearer()`` HTTP helper introduced for Phase 1 of the harness refactor
(``dc-wcy.5``). The mappers + helper live inline in
``backend/tests/integration/dataset_layer/harness.py`` per Mayor's scope override
(NO new files); this test file lives outside the harness package so it remains
importable without standing up the integration compose stack.

The tests are pure data-shape tests: no HTTP, no compose stack, no mocks beyond
plain dict literals representing recorded backend responses.
"""

from __future__ import annotations

import dataclasses

import pytest

from backend.tests.integration.dataset_layer.harness import (
    SessionState,
    TableState,
    TransformRecord,
    bearer,
    to_dataset_id,
    to_project_id,
    to_session_events_page,
    to_session_state,
    to_table_state,
    to_transform_records,
    unwrap_jsonapi,
)

# ----- bearer() ------------------------------------------------------------


class TestBearer:
    def test_token_only_emits_authorization_header(self) -> None:
        assert bearer("tok-1") == {"Authorization": "Bearer tok-1"}

    def test_json_body_adds_content_type(self) -> None:
        assert bearer("tok-1", json_body=True) == {
            "Authorization": "Bearer tok-1",
            "Content-Type": "application/json",
        }

    def test_returns_a_fresh_dict_each_call(self) -> None:
        a = bearer("t")
        b = bearer("t")
        a["X-Probe"] = "1"
        assert "X-Probe" not in b


# ----- unwrap_jsonapi -------------------------------------------------------


class TestUnwrapJsonapi:
    def test_jsonapi_resource_envelope_flattens_attributes_with_id(self) -> None:
        body = {"data": {"id": "ds-1", "attributes": {"row_count": 3, "columns": []}}}
        assert unwrap_jsonapi(body) == {"id": "ds-1", "row_count": 3, "columns": []}

    def test_data_wrapped_without_attributes_returned_unchanged(self) -> None:
        body = {"data": {"id": "ds-1", "row_count": 3}}
        assert unwrap_jsonapi(body) == {"id": "ds-1", "row_count": 3}

    def test_already_flat_body_passes_through(self) -> None:
        body = {"id": "ds-1", "row_count": 3}
        assert unwrap_jsonapi(body) == body

    def test_non_dict_input_returns_empty_dict(self) -> None:
        assert unwrap_jsonapi(None) == {}  # type: ignore[arg-type]
        assert unwrap_jsonapi([1, 2, 3]) == {}  # type: ignore[arg-type]

    def test_data_key_holds_non_dict_returns_empty_dict(self) -> None:
        # ``data`` is a list (e.g. JSON:API collection) — out of scope here.
        assert unwrap_jsonapi({"data": [{"id": "x"}]}) == {}


# ----- to_project_id --------------------------------------------------------


class TestToProjectId:
    def test_flat_response(self) -> None:
        assert to_project_id({"id": "proj-1", "name": "Demo"}) == "proj-1"

    def test_data_wrapped_response(self) -> None:
        assert to_project_id({"data": {"id": "proj-2"}}) == "proj-2"

    def test_missing_id_raises(self) -> None:
        with pytest.raises(RuntimeError):
            to_project_id({"name": "no-id"})

    def test_non_string_id_raises(self) -> None:
        with pytest.raises(RuntimeError):
            to_project_id({"id": 42})


# ----- to_dataset_id --------------------------------------------------------


class TestToDatasetId:
    def test_id_field_preferred(self) -> None:
        assert to_dataset_id({"id": "ds-1", "dataset_id": "ds-other"}) == "ds-1"

    def test_falls_back_to_dataset_id(self) -> None:
        assert to_dataset_id({"dataset_id": "ds-2"}) == "ds-2"

    def test_data_wrapped_response(self) -> None:
        assert to_dataset_id({"data": {"id": "ds-3"}}) == "ds-3"

    def test_missing_raises(self) -> None:
        with pytest.raises(RuntimeError):
            to_dataset_id({"name": "no-id"})


# ----- to_table_state -------------------------------------------------------


class TestToTableState:
    def test_full_payload(self) -> None:
        body = {
            "data": {
                "id": "ds-1",
                "attributes": {
                    "row_count": 7,
                    "columns": [{"name": "a", "type": "text"}],
                    "preview": [{"a": "x"}, {"a": "y"}],
                },
            },
        }
        state = to_table_state(body, "ds-1")
        assert isinstance(state, TableState)
        assert state.dataset_id == "ds-1"
        assert state.row_count == 7
        assert state.columns == [{"name": "a", "type": "text"}]
        assert state.preview == [{"a": "x"}, {"a": "y"}]

    def test_legacy_preview_rows_alias(self) -> None:
        body = {"preview_rows": [{"a": 1}], "row_count": 1, "columns": []}
        state = to_table_state(body, "ds-9")
        assert state.preview == [{"a": 1}]

    def test_columns_under_schema(self) -> None:
        body = {"schema": {"columns": [{"name": "x"}]}, "preview": [], "row_count": 0}
        state = to_table_state(body, "ds-9")
        assert state.columns == [{"name": "x"}]

    def test_row_count_falls_back_to_rows_then_len_preview(self) -> None:
        body_rows = {"rows": 2, "preview": [{"a": 1}], "columns": []}
        assert to_table_state(body_rows, "ds-9").row_count == 2

        body_len = {"preview": [{"a": 1}, {"a": 2}], "columns": []}
        assert to_table_state(body_len, "ds-9").row_count == 2

    def test_missing_row_count_zero(self) -> None:
        body = {"columns": [], "preview": []}
        assert to_table_state(body, "ds-9").row_count == 0

    def test_column_type_lookup(self) -> None:
        body = {
            "columns": [{"name": "a", "type": "text"}, {"id": "b", "type": "int"}],
            "preview": [],
            "row_count": 0,
        }
        state = to_table_state(body, "ds-9")
        assert state.column_type("a") == "text"
        assert state.column_type("b") == "int"
        assert state.column_type("missing") is None


# ----- to_session_state -----------------------------------------------------


class TestToSessionState:
    def test_returns_typed_session_state(self) -> None:
        body = {
            "data": {
                "id": "sess-1",
                "attributes": {
                    "stream_thread_id": "thr-1",
                    "created_at": "2026-05-07T10:00:00Z",
                    "owner_id": "u-1",
                },
            },
        }
        state = to_session_state(body)
        assert isinstance(state, SessionState)
        assert state.id == "sess-1"
        assert state.stream_thread_id == "thr-1"
        assert state.extra == {"created_at": "2026-05-07T10:00:00Z", "owner_id": "u-1"}

    def test_flat_response(self) -> None:
        body = {"id": "sess-2", "stream_thread_id": "thr-2"}
        state = to_session_state(body)
        assert state.id == "sess-2"
        assert state.stream_thread_id == "thr-2"
        assert state.extra == {}

    def test_missing_stream_thread_id_defaults_empty(self) -> None:
        body = {"id": "sess-3"}
        state = to_session_state(body)
        assert state.id == "sess-3"
        assert state.stream_thread_id == ""

    def test_missing_id_raises(self) -> None:
        with pytest.raises(RuntimeError):
            to_session_state({"stream_thread_id": "thr-x"})

    def test_session_state_is_frozen(self) -> None:
        state = to_session_state({"id": "sess-4", "stream_thread_id": "thr-4"})
        with pytest.raises(dataclasses.FrozenInstanceError):
            state.id = "mutated"  # type: ignore[misc]


# ----- to_transform_records -------------------------------------------------


class TestToTransformRecords:
    def test_returns_list_of_typed_records(self) -> None:
        body = {
            "data": {
                "id": "ds-1",
                "attributes": {
                    "transforms": [
                        {
                            "id": "t-1",
                            "kind": "trim_whitespace",
                            "params": {"column": "name"},
                            "created_at": "2026-05-07T10:00:00Z",
                            "applied_by": "u-1",
                        },
                        {
                            "id": "t-2",
                            "kind": "set_type",
                            "params": {"column": "age", "type": "int"},
                        },
                    ],
                },
            },
        }
        records = to_transform_records(body)
        assert len(records) == 2
        assert records[0] == TransformRecord(
            id="t-1",
            kind="trim_whitespace",
            params={"column": "name"},
            created_at="2026-05-07T10:00:00Z",
            extra={"applied_by": "u-1"},
        )
        assert records[1].id == "t-2"
        assert records[1].created_at is None
        assert records[1].extra == {}

    def test_no_transforms_returns_empty_list(self) -> None:
        assert to_transform_records({"data": {"id": "ds-x", "attributes": {}}}) == []
        assert to_transform_records({"transforms": None}) == []
        assert to_transform_records({}) == []

    def test_transform_record_is_frozen(self) -> None:
        body = {"transforms": [{"id": "t-1", "kind": "k", "params": {}}]}
        record = to_transform_records(body)[0]
        with pytest.raises(dataclasses.FrozenInstanceError):
            record.id = "mutated"  # type: ignore[misc]


# ----- to_session_events_page -----------------------------------------------


class TestToSessionEventsPage:
    def test_returns_events_cursor_and_has_more(self) -> None:
        body = {
            "events": [{"type": "transform_applied", "transform_id": "t-1"}],
            "next_cursor": "cur-2",
            "has_more": True,
        }
        events, cursor, has_more = to_session_events_page(body)
        assert events == [{"type": "transform_applied", "transform_id": "t-1"}]
        assert cursor == "cur-2"
        assert has_more is True

    def test_missing_events_returns_empty_list(self) -> None:
        events, cursor, has_more = to_session_events_page({})
        assert events == []
        assert cursor is None
        assert has_more is False

    def test_has_more_false_when_absent_or_falsy(self) -> None:
        for body in ({"has_more": False}, {"has_more": None}, {}):
            _, _, has_more = to_session_events_page(body)
            assert has_more is False

    def test_null_events_treated_as_empty(self) -> None:
        events, _, _ = to_session_events_page({"events": None})
        assert events == []
