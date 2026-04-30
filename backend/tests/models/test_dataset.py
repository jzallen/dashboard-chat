"""Characterization tests for the Dataset domain model.

These tests pin the CURRENT observable behavior of ``app.models.dataset.Dataset``
at its public port boundaries. They exist to give the RPP L1-L6 progressive
refactor (bead dc-24gt, step 8) a safety net: any change that alters what the
Dataset's public API returns will flip these tests red.

Design notes
------------
* Port-to-port only. Internal helpers (``_build_table``, ``_build_table_from_schema``,
  ``_s3_path``, ``_table_alias``) are NOT called directly; they are exercised
  through the public properties/methods that use them.
* Golden pins on SQL output are intentional — they are a safety net, not an
  oracle. Each exact-string assertion is tagged with a "characterization pin"
  comment so future readers understand the intent.
* ``query_preview_rows`` hits an asyncpg pool. We fake the pool via monkeypatch
  and pin the two observable outcomes that matter to the refactor: (a) the exact
  SQL handed to the connection, (b) whether custom macros are registered.
"""

from datetime import datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.dataset import Dataset
from app.models.transform import Transform
from app.types import QueryBuilderJSON

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _make_schema(fields: dict[str, str] | None = None) -> dict[str, Any]:
    """Build a minimal schema_config. ``fields`` maps column name -> type."""
    if not fields:
        return {}
    return {"fields": {name: {"type": type_name} for name, type_name in fields.items()}}


def _filter_transform(
    condition_json: QueryBuilderJSON | None = None,
    condition_sql: str | None = None,
    status: str = "enabled",
    id: str = "t-filter",
    name: str = "Filter",
) -> Transform:
    return Transform(
        id=id,
        name=name,
        condition_json=condition_json,
        condition_sql=condition_sql,
        transform_type="filter",
        status=status,
    )


def _clean_trim(
    column: str, status: str = "enabled", created_at: datetime | None = None
) -> Transform:
    return Transform(
        id=f"t-trim-{column}",
        name=f"Trim {column}",
        condition_json=None,
        transform_type="clean",
        target_column=column,
        expression_config={"operation": "trim"},
        status=status,
        created_at=created_at,
    )


def _clean_case(
    column: str, mode: str, created_at: datetime | None = None
) -> Transform:
    return Transform(
        id=f"t-case-{column}-{mode}",
        name=f"Case {mode} {column}",
        condition_json=None,
        transform_type="clean",
        target_column=column,
        expression_config={"operation": "case", "mode": mode},
        status="enabled",
        created_at=created_at,
    )


def _alias_transform(column: str, alias: str) -> Transform:
    return Transform(
        id=f"t-alias-{column}",
        name=f"Alias {column} to {alias}",
        condition_json=None,
        transform_type="alias",
        target_column=column,
        expression_config={"operation": "alias", "alias": alias},
        status="enabled",
    )


def _age_gt_filter_json(field: str = "age", threshold: int = 18) -> QueryBuilderJSON:
    """Build a minimal QueryBuilderJSON that produces ``<field> > <threshold>``."""
    return QueryBuilderJSON(
        {
            "id": "root",
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "r1": {
                    "type": "rule",
                    "properties": {
                        "field": field,
                        "operator": "greater",
                        "value": [threshold],
                    },
                },
            },
        }
    )


# ---------------------------------------------------------------------------
# Construction + defaults
# ---------------------------------------------------------------------------


class TestDatasetConstruction:
    """Dataset construction and default values."""

    def test_create_dataset_with_only_id_yields_documented_defaults(self):
        ds = Dataset(id="ds-1")

        assert ds.id == "ds-1"
        assert ds.project_id is None
        assert ds.name == "New Dataset"
        assert ds.description is None
        assert ds.schema_config == {}
        assert ds.partition_fields == []
        assert ds.transforms == []
        assert ds.preview_rows == []
        assert ds.column_profiles is None
        assert ds.format_context is None

    def test_create_dataset_with_all_fields_populates_them(self):
        ds = Dataset(
            id="ds-1",
            project_id="proj-1",
            name="My Dataset",
            description="An example",
            schema_config={"fields": {"x": {"type": "text"}}},
            partition_fields=["x"],
            transforms=[],
            preview_rows=[{"x": "a"}],
            column_profiles={"x": {"min": "a"}},
            format_context="HL7v2 context",
        )

        assert ds.name == "My Dataset"
        assert ds.description == "An example"
        assert ds.schema_config == {"fields": {"x": {"type": "text"}}}
        assert ds.partition_fields == ["x"]
        assert ds.preview_rows == [{"x": "a"}]
        assert ds.column_profiles == {"x": {"min": "a"}}
        assert ds.format_context == "HL7v2 context"

    def test_dataset_is_frozen_dataclass(self):
        ds = Dataset(id="ds-1")
        with pytest.raises((AttributeError, Exception)):
            ds.name = "mutated"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# __post_init__ transform coercion (three match arms)
# ---------------------------------------------------------------------------


class TestPostInitTransformCoercion:
    """__post_init__ coerces transforms input into list[Transform]."""

    def test_none_transforms_become_empty_list(self):
        ds = Dataset(id="ds-1", transforms=None)
        assert ds.transforms == []

    def test_empty_list_transforms_remain_empty_list(self):
        ds = Dataset(id="ds-1", transforms=[])
        assert ds.transforms == []

    def test_list_of_dicts_converts_to_transform_objects(self):
        ds = Dataset(
            id="ds-1",
            transforms=[
                {
                    "id": "t1",
                    "name": "Filter active",
                    "condition_json": {"some": "json"},
                    "condition_sql": "status='active'",
                    "description": "only active",
                    "status": "enabled",
                    "transform_type": "filter",
                },
                {
                    "id": "t2",
                    "name": "Trim name",
                    "condition_json": None,
                    "status": "disabled",
                    "transform_type": "clean",
                    "target_column": "name",
                    "expression_config": {"operation": "trim"},
                },
            ],
        )

        assert len(ds.transforms) == 2
        first, second = ds.transforms
        assert isinstance(first, Transform)
        assert first.id == "t1"
        assert first.name == "Filter active"
        assert isinstance(first.condition_json, QueryBuilderJSON)
        assert first.condition_json == {"some": "json"}
        assert first.condition_sql == "status='active'"
        assert first.description == "only active"
        assert first.status == "enabled"
        assert first.transform_type == "filter"

        assert isinstance(second, Transform)
        assert second.id == "t2"
        assert second.status == "disabled"
        assert second.transform_type == "clean"
        assert second.target_column == "name"
        assert second.expression_config == {"operation": "trim"}
        # condition_json default when absent
        assert second.condition_json is None

    def test_list_of_dicts_with_missing_status_defaults_to_enabled(self):
        ds = Dataset(
            id="ds-1",
            transforms=[{"id": "t1", "name": "T", "condition_json": None}],
        )
        assert ds.transforms[0].status == "enabled"
        # transform_type default when absent
        assert ds.transforms[0].transform_type == "filter"

    def test_list_of_dicts_with_empty_condition_json_becomes_none(self):
        ds = Dataset(
            id="ds-1",
            transforms=[{"id": "t1", "name": "T", "condition_json": None}],
        )
        assert ds.transforms[0].condition_json is None

    def test_list_of_orm_like_records_converts_to_transform_objects(self):
        class FakeOrmRecord:
            _sa_instance_state = object()  # marker used by __post_init__ match arm

            def __init__(self, **kw: Any) -> None:
                for key, value in kw.items():
                    setattr(self, key, value)

        orm_records = [
            FakeOrmRecord(
                id="t-orm-1",
                name="ORM filter",
                condition_json={"k": "v"},
                condition_sql="x > 0",
                description="from ORM",
                status="enabled",
                transform_type="filter",
                target_column=None,
                expression_sql=None,
                expression_config=None,
                created_at=datetime(2026, 1, 1),
            ),
        ]
        ds = Dataset(id="ds-1", transforms=orm_records)  # type: ignore[arg-type]

        assert len(ds.transforms) == 1
        tx = ds.transforms[0]
        assert isinstance(tx, Transform)
        assert tx.id == "t-orm-1"
        assert tx.name == "ORM filter"
        assert isinstance(tx.condition_json, QueryBuilderJSON)
        assert tx.condition_sql == "x > 0"
        assert tx.status == "enabled"
        assert tx.created_at == datetime(2026, 1, 1)

    def test_list_of_orm_records_with_missing_optional_fields_defaults_via_getattr(
        self,
    ):
        class MinimalOrm:
            _sa_instance_state = object()

            def __init__(self) -> None:
                self.id = "t-min"
                self.name = "N"
                self.condition_json = None
                self.condition_sql = None
                self.description = None
                self.status = "enabled"
                # transform_type / target_column / expression_* / created_at intentionally omitted

        ds = Dataset(id="ds-1", transforms=[MinimalOrm()])  # type: ignore[arg-type]
        tx = ds.transforms[0]
        assert tx.transform_type == "filter"  # getattr default
        assert tx.target_column is None
        assert tx.expression_sql is None
        assert tx.expression_config is None
        assert tx.created_at is None

    def test_list_of_transform_objects_is_passed_through_unchanged(self):
        # characterization pin — current __post_init__ has no arm for list[Transform];
        # the list is left as-is because neither the dict nor the SA arm matches.
        existing = Transform(id="t1", name="T", condition_json=None)
        ds = Dataset(id="ds-1", transforms=[existing])

        assert len(ds.transforms) == 1
        assert ds.transforms[0] is existing


# ---------------------------------------------------------------------------
# from_record (ORM -> domain conversion)
# ---------------------------------------------------------------------------


class TestFromRecord:
    """Dataset.from_record maps an ORM-like record to a Dataset instance."""

    def test_from_record_with_all_fields_populated(self):
        record = SimpleNamespace(
            id="ds-rec-1",
            project_id="proj-1",
            name="From Record",
            description="desc",
            schema_config={"fields": {"x": {"type": "text"}}},
            partition_fields=["x"],
            transforms=[],
            column_profiles={"x": {"min": 0}},
            format_context="HL7v2",
        )
        ds = Dataset.from_record(record)

        assert ds.id == "ds-rec-1"
        assert ds.project_id == "proj-1"
        assert ds.name == "From Record"
        assert ds.description == "desc"
        assert ds.schema_config == {"fields": {"x": {"type": "text"}}}
        assert ds.partition_fields == ["x"]
        assert ds.transforms == []
        assert ds.preview_rows == []
        assert ds.column_profiles == {"x": {"min": 0}}
        assert ds.format_context == "HL7v2"

    def test_from_record_coerces_none_schema_and_partitions_to_defaults(self):
        record = SimpleNamespace(
            id="ds-rec-2",
            project_id="p",
            name="N",
            description=None,
            schema_config=None,
            partition_fields=None,
            transforms=[],
            column_profiles=None,
        )
        # format_context omitted entirely — must use getattr default None
        ds = Dataset.from_record(record)

        assert ds.schema_config == {}
        assert ds.partition_fields == []
        assert ds.format_context is None

    def test_from_record_with_preview_rows_populates_them(self):
        record = SimpleNamespace(
            id="ds-rec-3",
            project_id="p",
            name="N",
            description=None,
            schema_config={},
            partition_fields=[],
            transforms=[],
            column_profiles=None,
        )
        rows = [{"a": 1}, {"a": 2}]
        ds = Dataset.from_record(record, preview_rows=rows)

        assert ds.preview_rows == rows

    def test_from_record_without_preview_rows_defaults_to_empty_list(self):
        record = SimpleNamespace(
            id="ds-rec-4",
            project_id="p",
            name="N",
            description=None,
            schema_config={},
            partition_fields=[],
            transforms=[],
            column_profiles=None,
        )
        ds = Dataset.from_record(record, preview_rows=None)
        assert ds.preview_rows == []

    def test_from_record_include_transforms_false_discards_record_transforms(self):
        record = SimpleNamespace(
            id="ds-rec-5",
            project_id="p",
            name="N",
            description=None,
            schema_config={},
            partition_fields=[],
            transforms=[{"id": "t1", "name": "T", "condition_json": None}],
            column_profiles=None,
        )
        ds = Dataset.from_record(record, include_transforms=False)

        assert ds.transforms == []

    def test_from_record_include_transforms_true_by_default_keeps_record_transforms(
        self,
    ):
        record = SimpleNamespace(
            id="ds-rec-6",
            project_id="p",
            name="N",
            description=None,
            schema_config={},
            partition_fields=[],
            transforms=[{"id": "t1", "name": "T", "condition_json": None}],
            column_profiles=None,
        )
        ds = Dataset.from_record(record)  # include_transforms default True

        assert len(ds.transforms) == 1
        assert ds.transforms[0].id == "t1"


# ---------------------------------------------------------------------------
# transforms_to_delete
# ---------------------------------------------------------------------------


class TestTransformsToDelete:
    """``transforms_to_delete`` returns only transforms with status='deleted'."""

    def test_transforms_to_delete_filters_only_status_deleted(self):
        tx = [
            Transform(id="t-en", name="enabled", condition_json=None, status="enabled"),
            Transform(
                id="t-del-1", name="deleted one", condition_json=None, status="deleted"
            ),
            Transform(
                id="t-dis", name="disabled", condition_json=None, status="disabled"
            ),
            Transform(
                id="t-del-2", name="deleted two", condition_json=None, status="deleted"
            ),
        ]
        ds = Dataset(id="ds-1", transforms=tx)

        to_delete = ds.transforms_to_delete

        assert [t.id for t in to_delete] == ["t-del-1", "t-del-2"]

    def test_transforms_to_delete_with_no_transforms_is_empty_list(self):
        ds = Dataset(id="ds-1", transforms=[])
        assert ds.transforms_to_delete == []

    def test_transforms_to_delete_with_none_deleted_returns_empty_list(self):
        ds = Dataset(
            id="ds-1",
            transforms=[
                Transform(id="t1", name="n", condition_json=None, status="enabled"),
                Transform(id="t2", name="n", condition_json=None, status="disabled"),
            ],
        )
        assert ds.transforms_to_delete == []


# ---------------------------------------------------------------------------
# storage_path
# ---------------------------------------------------------------------------


class TestStoragePath:
    """``storage_path`` follows the pattern ``datasets/{project_id}/{id}/``."""

    def test_storage_path_exact_shape(self):
        # characterization pin — refactor must preserve this output verbatim
        ds = Dataset(id="ds-abc", project_id="proj-123")
        assert ds.storage_path == "datasets/proj-123/ds-abc/"

    def test_storage_path_always_ends_with_slash(self):
        # The trailing slash signals partitioned parquet storage; downstream
        # callers (_s3_path glob expansion, dbt sources.yml) rely on this.
        ds = Dataset(id="x", project_id="y")
        assert ds.storage_path.endswith("/")

    def test_storage_path_with_none_project_id_interpolates_the_literal_none(self):
        # characterization pin — current behavior is f-string interpolation of
        # None into the path. Documented here so a future refactor can decide
        # whether to raise instead.
        ds = Dataset(id="ds-1", project_id=None)
        assert ds.storage_path == "datasets/None/ds-1/"


# ---------------------------------------------------------------------------
# staging_sql (exact golden pins)
# ---------------------------------------------------------------------------


class TestStagingSql:
    """``staging_sql`` emits compact DuckDB SQL from the Ibis pipeline."""

    def test_staging_sql_empty_schema_returns_error_comment(self):
        # characterization pin — empty schema raises ValueError internally;
        # staging_sql catches and formats as "-- Error generating SQL: ...".
        ds = Dataset(id="ds-1", project_id="p", name="Empty")
        assert (
            ds.staging_sql
            == "-- Error generating SQL: No data or schema available for this dataset"
        )

    def test_staging_sql_simple_schema_no_transforms(self):
        # characterization pin — refactor must preserve this output verbatim
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Simple",
            schema_config=_make_schema({"name": "text", "age": "number"}),
        )
        assert ds.staging_sql == 'SELECT * FROM "Simple" AS "t0"'

    def test_staging_sql_with_cleaning_trim_transform(self):
        # characterization pin — refactor must preserve this output verbatim
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Clean",
            schema_config=_make_schema({"name": "text", "age": "number"}),
            transforms=[_clean_trim("name")],
        )
        assert ds.staging_sql == (
            'SELECT TRIM("t0"."name", \' \t\n\r\x0b\x0c\') AS "name", '
            '"t0"."age" FROM "Clean" AS "t0"'
        )

    def test_staging_sql_with_filter_transform(self):
        # characterization pin — refactor must preserve this output verbatim
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="FilterSet",
            schema_config=_make_schema({"name": "text", "age": "number"}),
            transforms=[_filter_transform(condition_json=_age_gt_filter_json())],
        )
        assert ds.staging_sql == (
            'SELECT * FROM "FilterSet" AS "t0" WHERE "t0"."age" > 18'
        )

    def test_staging_sql_with_alias_transform(self):
        # characterization pin — refactor must preserve this output verbatim
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Aliased",
            schema_config=_make_schema({"name": "text", "age": "number"}),
            transforms=[_alias_transform("age", "person_age")],
        )
        assert ds.staging_sql == (
            'SELECT "t0"."name", "t0"."age" AS "person_age" FROM "Aliased" AS "t0"'
        )

    def test_staging_sql_skips_disabled_transforms(self):
        # Structural check (the exact SQL is already pinned above for the
        # equivalent enabled case). Disabled transforms must not appear in
        # the output at all.
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Dis",
            schema_config=_make_schema({"name": "text", "age": "number"}),
            transforms=[_clean_trim("name", status="disabled")],
        )
        sql = ds.staging_sql
        assert "TRIM" not in sql
        assert sql == 'SELECT * FROM "Dis" AS "t0"'

    def test_staging_sql_cleaning_order_respects_created_at(self):
        # Two cleaning transforms on different columns; the earlier created_at
        # must appear first in the output. This pins the sort-by-created_at
        # ordering that _build_table's MUTATE stage relies on.
        early = _clean_trim("a", created_at=datetime(2024, 1, 1))
        late = _clean_case("b", "upper", created_at=datetime(2024, 1, 2))
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Ord",
            schema_config=_make_schema({"a": "text", "b": "text"}),
            transforms=[late, early],  # intentionally reversed input order
        )
        sql = ds.staging_sql
        trim_pos = sql.index("TRIM(")
        upper_pos = sql.index("UPPER(")
        assert trim_pos < upper_pos, f"expected TRIM before UPPER, got: {sql}"


# ---------------------------------------------------------------------------
# display_sql (pretty SQL with dataset-name alias + unquoting)
# ---------------------------------------------------------------------------


class TestDisplaySql:
    """``display_sql`` post-processes Ibis pretty output: t0 -> alias, unquoted
    column refs, and SELECT * expansion to explicit columns."""

    def test_display_sql_empty_schema_returns_error_comment(self):
        # characterization pin
        ds = Dataset(id="ds-1", project_id="p", name="Empty")
        assert (
            ds.display_sql
            == "-- Error generating SQL: No data or schema available for this dataset"
        )

    def test_display_sql_expands_select_star_and_applies_alias(self):
        # characterization pin — refactor must preserve this output verbatim.
        # Note: t0 -> "s" (initials of "Simple"); SELECT * expands to explicit
        # columns; column refs are unquoted (s.name, not s."name").
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Simple",
            schema_config=_make_schema({"name": "text", "age": "number"}),
        )
        assert ds.display_sql == 'SELECT\n  s.name,\n  s.age\nFROM "Simple" AS s'

    def test_display_sql_with_cleaning_trim_transform(self):
        # characterization pin — alias is "c" (initials of "Clean"). Aliased
        # column from TRIM stays quoted (AS "name") because the unquoting
        # regex only targets bare column references, not output aliases.
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Clean",
            schema_config=_make_schema({"name": "text", "age": "number"}),
            transforms=[_clean_trim("name")],
        )
        assert ds.display_sql == (
            "SELECT\n  TRIM(c.name, ' \t\n\r\x0b\x0c') AS \"name\",\n"
            '  c.age\nFROM "Clean" AS c'
        )

    def test_display_sql_with_filter_transform(self):
        # characterization pin
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="FilterSet",
            schema_config=_make_schema({"name": "text", "age": "number"}),
            transforms=[_filter_transform(condition_json=_age_gt_filter_json())],
        )
        assert ds.display_sql == (
            'SELECT\n  f.name,\n  f.age\nFROM "FilterSet" AS f\nWHERE\n  f.age > 18'
        )

    def test_display_sql_with_alias_transform(self):
        # characterization pin
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Aliased",
            schema_config=_make_schema({"name": "text", "age": "number"}),
            transforms=[_alias_transform("age", "person_age")],
        )
        assert ds.display_sql == (
            'SELECT\n  a.name,\n  a.age AS "person_age"\nFROM "Aliased" AS a'
        )

    def test_display_sql_alias_uses_lowercase_initials_of_multi_word_name(self):
        # "Customer Purchase History" -> initials "cph"
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Customer Purchase History",
            schema_config=_make_schema({"col": "text"}),
        )
        sql = ds.display_sql
        assert "AS cph" in sql
        assert "cph.col" in sql


# ---------------------------------------------------------------------------
# serialize
# ---------------------------------------------------------------------------


class TestSerialize:
    """``serialize()`` returns a JSON-friendly dict."""

    def test_serialize_minimal_dataset_returns_expected_shape(self):
        # characterization pin — note `staging_sql` key exposes the DISPLAY SQL
        # (not the compact staging form). Refactor must preserve this quirk.
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Simple",
            schema_config=_make_schema({"name": "text"}),
        )
        result = ds.serialize()

        assert result["id"] == "ds-1"
        assert result["project_id"] == "p"
        assert result["name"] == "Simple"
        assert result["description"] is None
        assert result["schema_config"] == {"fields": {"name": {"type": "text"}}}
        assert result["partition_fields"] == []
        assert result["transforms"] == []
        assert result["preview_rows"] == []
        assert result["column_profiles"] is None
        assert result["format_context"] is None
        # characterization pin — `staging_sql` key exposes display_sql output
        assert result["staging_sql"] == 'SELECT\n  s.name\nFROM "Simple" AS s'

    def test_serialize_empty_schema_returns_error_comment_under_staging_sql_key(self):
        # characterization pin
        ds = Dataset(id="ds-1", project_id="p", name="Empty")
        result = ds.serialize()
        assert (
            result["staging_sql"]
            == "-- Error generating SQL: No data or schema available for this dataset"
        )

    def test_serialize_includes_transforms_via_their_serialize_method(self):
        tx = Transform(
            id="t1",
            name="Filter",
            condition_json=QueryBuilderJSON({"k": "v"}),
            condition_sql=None,
            description="d",
            status="enabled",
            transform_type="filter",
        )
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="S",
            schema_config=_make_schema({"x": "text"}),
            transforms=[tx],
        )
        result = ds.serialize()

        assert result["transforms"] == [
            {
                "id": "t1",
                "name": "Filter",
                "condition_json": {"k": "v"},
                "condition_sql": None,
                "description": "d",
                "status": "enabled",
                "transform_type": "filter",
                "target_column": None,
                "expression_sql": None,
                "expression_config": None,
            }
        ]

    def test_serialize_with_all_fields_populated(self):
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="Full",
            description="desc",
            schema_config=_make_schema({"a": "text"}),
            partition_fields=["a"],
            preview_rows=[{"a": "val"}],
            column_profiles={"a": {"min": "val"}},
            format_context="HL7v2",
        )
        result = ds.serialize()

        assert result["description"] == "desc"
        assert result["partition_fields"] == ["a"]
        assert result["preview_rows"] == [{"a": "val"}]
        assert result["column_profiles"] == {"a": {"min": "val"}}
        assert result["format_context"] == "HL7v2"


# ---------------------------------------------------------------------------
# display_name_to_filename (staticmethod)
# ---------------------------------------------------------------------------


class TestDisplayNameToFilename:
    """``display_name_to_filename`` converts display names to snake_case."""

    @pytest.mark.parametrize(
        "display,expected",
        [
            # Common happy path: spaces become underscores, lowercased.
            ("My Dataset", "my_dataset"),
            ("UPPER CASE", "upper_case"),
            # Symbols and punctuation collapse to single underscore.
            ("Foo/Bar.Baz-Qux", "foo_bar_baz_qux"),
            # Already simple -> unchanged.
            ("alreadysimple", "alreadysimple"),
            # Leading/trailing non-alnum stripped.
            ("_leading_trailing_", "leading_trailing"),
            # Multiple internal spaces collapse to single underscore.
            ("with   spaces", "with_spaces"),
            # Empty / whitespace-only / symbol-only -> 'dataset' fallback.
            ("", "dataset"),
            ("   ", "dataset"),
            ("!!!@@@###", "dataset"),
            # characterization pin — current regex is ASCII-only; non-ASCII
            # characters are stripped (café -> caf). A future i18n-aware
            # refactor would need a decision, not a silent fix.
            ("café", "caf"),
        ],
    )
    def test_display_name_to_filename_cases(self, display: str, expected: str) -> None:
        assert Dataset.display_name_to_filename(display) == expected


# ---------------------------------------------------------------------------
# query_preview_rows (async, driven port = asyncpg pool)
# ---------------------------------------------------------------------------


class _FakeConnection:
    """Minimal asyncpg-connection stand-in.

    Records every ``execute`` / ``fetch`` call so tests can pin (a) whether
    custom macros were registered, and (b) the exact SELECT the Dataset
    handed to the driver.
    """

    def __init__(self, fetch_rows: list[dict[str, Any]] | None = None) -> None:
        self.executed_sql: list[str] = []
        self.fetched_sql: list[str] = []
        self._fetch_rows = fetch_rows or []

    async def execute(self, sql: str) -> None:
        self.executed_sql.append(sql)

    async def fetch(self, sql: str) -> list[dict[str, Any]]:
        self.fetched_sql.append(sql)
        return list(self._fetch_rows)


class _FakePool:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    def acquire(self) -> "_FakePoolAcquireCtx":
        return _FakePoolAcquireCtx(self._connection)


class _FakePoolAcquireCtx:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    async def __aenter__(self) -> _FakeConnection:
        return self._connection

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


@pytest.fixture
def fake_pool_factory(monkeypatch: pytest.MonkeyPatch):
    """Install a fake asyncpg pool in place of get_query_engine_pool.

    Returns a helper that builds the pool lazily so tests can stage their
    expected rows before triggering ``query_preview_rows``.
    """

    def _install(fetch_rows: list[dict[str, Any]] | None = None) -> _FakeConnection:
        connection = _FakeConnection(fetch_rows=fetch_rows)
        pool = _FakePool(connection)

        async def _fake_get_pool():
            return pool

        # The method does `from ..database import get_query_engine_pool` inside
        # its body, so we patch the symbol on app.database where it lives.
        monkeypatch.setattr("app.database.get_query_engine_pool", _fake_get_pool)
        return connection

    return _install


class TestQueryPreviewRows:
    """``query_preview_rows`` — async, hits the query engine pool."""

    @pytest.mark.asyncio
    async def test_query_preview_rows_when_staging_sql_errors_returns_empty_list(
        self, fake_pool_factory
    ):
        # Empty schema -> staging_sql starts with "-- Error" -> short-circuits.
        connection = fake_pool_factory(fetch_rows=[])
        ds = Dataset(id="ds-1", project_id="p", name="N")  # no schema

        rows = await ds.query_preview_rows()

        assert rows == []
        # Crucially, the pool must NOT be touched on the error path.
        assert connection.executed_sql == []
        assert connection.fetched_sql == []

    @pytest.mark.asyncio
    async def test_query_preview_rows_uses_read_parquet_with_s3_path_and_limit(
        self, fake_pool_factory, monkeypatch: pytest.MonkeyPatch
    ):
        # Stub get_settings so _s3_path has a deterministic bucket.
        from app.config import Settings

        def _fake_get_settings() -> Settings:  # type: ignore[override]
            return Settings(storage_bucket="test-bucket")  # type: ignore[call-arg]

        monkeypatch.setattr("app.config.get_settings", _fake_get_settings)

        # Post-dc-f8m: rows are wrapped in ``to_json(t) AS row`` to satisfy
        # pg_duckdb's Describe phase, and decoded by ``decode_wrapped_rows``.
        connection = fake_pool_factory(
            fetch_rows=[{"row": '{"a": 1}'}, {"row": '{"a": 2}'}]
        )
        ds = Dataset(
            id="ds-x",
            project_id="proj-y",
            name="N",
            schema_config=_make_schema({"a": "text"}),
        )

        rows = await ds.query_preview_rows(limit=5)

        # characterization pin — exact SQL sent through
        # ``build_read_parquet_preview_query``.
        assert connection.fetched_sql == [
            "SELECT to_json(t) AS row FROM read_parquet('s3://test-bucket/datasets/proj-y/ds-x/**/*.parquet') t LIMIT 5"
        ]
        # No macros needed: no clean/map transforms with snake/kebab/title mode
        assert connection.executed_sql == []
        # Rows are decoded from the single ``row`` JSON column.
        assert rows == [{"a": 1}, {"a": 2}]

    @pytest.mark.asyncio
    async def test_query_preview_rows_registers_macros_when_custom_case_mode_used(
        self, fake_pool_factory, monkeypatch: pytest.MonkeyPatch
    ):
        from app.config import Settings
        from app.utils.sql_functions import ALL_MACROS

        monkeypatch.setattr(
            "app.config.get_settings",
            lambda: Settings(storage_bucket="b"),  # type: ignore[call-arg]
        )

        connection = fake_pool_factory(fetch_rows=[])
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="N",
            schema_config=_make_schema({"name": "text"}),
            transforms=[_clean_case("name", "snake")],
        )

        await ds.query_preview_rows(limit=10)

        # Macros must be registered exactly once, in ALL_MACROS order.
        assert connection.executed_sql == list(ALL_MACROS)

    @pytest.mark.asyncio
    async def test_query_preview_rows_does_not_register_macros_for_builtin_case_modes(
        self, fake_pool_factory, monkeypatch: pytest.MonkeyPatch
    ):
        from app.config import Settings

        monkeypatch.setattr(
            "app.config.get_settings",
            lambda: Settings(storage_bucket="b"),  # type: ignore[call-arg]
        )

        connection = fake_pool_factory(fetch_rows=[])
        ds = Dataset(
            id="ds-1",
            project_id="p",
            name="N",
            schema_config=_make_schema({"name": "text"}),
            # "upper" and "lower" are built-in, not custom macros
            transforms=[_clean_case("name", "upper")],
        )

        await ds.query_preview_rows(limit=10)

        assert connection.executed_sql == []
