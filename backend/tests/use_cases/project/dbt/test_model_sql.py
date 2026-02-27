from datetime import datetime

from app.models.dataset import Dataset
from app.models.transform import Transform
from app.use_cases.project.dbt.model_sql import generate_model_sql


def _make_dataset(
    transforms=None,
    schema_fields=None,
):
    schema_config = {}
    if schema_fields:
        schema_config = {"fields": {f: {"type": "text"} for f in schema_fields}}
    return Dataset(
        id="ds-1",
        project_id="proj-1",
        name="Test Dataset",
        schema_config=schema_config,
        transforms=transforms or [],
    )


def _trim(col, status="enabled", created_at=None):
    return Transform(
        id="t-trim",
        name=f"Trim {col}",
        condition_json=None,
        transform_type="clean",
        target_column=col,
        expression_config={"operation": "trim"},
        status=status,
        created_at=created_at,
    )


def _case(col, mode, status="enabled", created_at=None):
    return Transform(
        id=f"t-case-{mode}",
        name=f"Case {mode} {col}",
        condition_json=None,
        transform_type="clean",
        target_column=col,
        expression_config={"operation": "case", "mode": mode},
        status=status,
        created_at=created_at,
    )


def _fill_null(col, fill_value, status="enabled"):
    return Transform(
        id="t-fill",
        name=f"Fill null {col}",
        condition_json=None,
        transform_type="clean",
        target_column=col,
        expression_config={"operation": "fill_null", "fill_value": fill_value},
        status=status,
    )


def _map_values(col, mappings, status="enabled"):
    return Transform(
        id="t-map",
        name=f"Map {col}",
        condition_json=None,
        transform_type="map",
        target_column=col,
        expression_config={"operation": "map_values", "mappings": mappings},
        status=status,
    )


def _filter(condition_sql, status="enabled"):
    return Transform(
        id="t-filter",
        name="Filter",
        condition_json=None,
        transform_type="filter",
        condition_sql=condition_sql,
        status=status,
    )


def _alias(col, alias_name, status="enabled"):
    return Transform(
        id=f"t-alias-{col}",
        name=f"Alias {col}",
        condition_json=None,
        transform_type="alias",
        target_column=col,
        expression_config={"operation": "alias", "alias": alias_name},
        status=status,
    )


class TestPassthrough:
    def test_no_transforms(self):
        ds = _make_dataset()
        sql = generate_model_sql("my_project", "my_dataset", ds)
        assert sql == "SELECT * FROM {{ source('my_project', 'my_dataset') }}"

    def test_empty_transforms_list(self):
        ds = _make_dataset(transforms=[])
        sql = generate_model_sql("my_project", "my_dataset", ds)
        assert sql == "SELECT * FROM {{ source('my_project', 'my_dataset') }}"


class TestOnlyCleaning:
    def test_single_trim(self):
        ds = _make_dataset(
            transforms=[_trim("name")],
            schema_fields=["name", "salary", "status"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "WITH source AS" in sql
        assert "cleaned AS" in sql
        assert "TRIM(name) AS name" in sql
        assert "salary" in sql
        assert "status" in sql
        assert "SELECT * FROM cleaned" in sql
        assert "filtered" not in sql

    def test_no_schema_uses_star(self):
        ds = _make_dataset(transforms=[_trim("name")])
        sql = generate_model_sql("proj", "ds", ds)
        assert "TRIM(name) AS name" in sql
        assert ",\n    *" in sql


class TestOnlyFilters:
    def test_single_filter(self):
        ds = _make_dataset(transforms=[_filter("status = 'active'")])
        sql = generate_model_sql("proj", "ds", ds)
        assert "WITH source AS" in sql
        assert "filtered AS" in sql
        assert "FROM source" in sql
        assert "WHERE status = 'active'" in sql
        assert "SELECT * FROM filtered" in sql
        assert "cleaned" not in sql

    def test_multiple_filters(self):
        ds = _make_dataset(
            transforms=[
                _filter("status = 'active'"),
                _filter("salary > 50000"),
            ]
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "WHERE status = 'active'" in sql
        assert "AND salary > 50000" in sql


class TestOnlyAliases:
    def test_single_alias(self):
        ds = _make_dataset(
            transforms=[_alias("department", "Dept")],
            schema_fields=["name", "department"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "WITH source AS" in sql
        assert "department AS dept" in sql
        assert "    name" in sql
        assert "FROM source" in sql
        assert "cleaned" not in sql
        assert "filtered" not in sql

    def test_alias_name_to_snake_case(self):
        ds = _make_dataset(
            transforms=[_alias("full_name", "Full Display Name")],
            schema_fields=["full_name", "email"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "full_name AS full_display_name" in sql


class TestAllCombined:
    def test_clean_filter_alias(self):
        ds = _make_dataset(
            transforms=[
                _trim("name"),
                _filter("salary > 50000"),
                _alias("department", "Dept"),
            ],
            schema_fields=["name", "salary", "status", "department"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # All CTEs present
        assert "WITH source AS" in sql
        assert "cleaned AS" in sql
        assert "filtered AS" in sql
        # cleaned sources from source
        assert "FROM source" in sql
        # filtered sources from cleaned
        assert "FROM cleaned" in sql
        # WHERE clause
        assert "WHERE salary > 50000" in sql
        # final SELECT with alias
        assert "department AS dept" in sql
        assert "FROM filtered" in sql


class TestDisabledTransforms:
    def test_disabled_transform_excluded(self):
        ds = _make_dataset(
            transforms=[
                _trim("name", status="enabled"),
                _trim("city", status="disabled"),
            ],
            schema_fields=["name", "city"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "TRIM(name) AS name" in sql
        assert "TRIM(city)" not in sql

    def test_disabled_filter_excluded(self):
        ds = _make_dataset(
            transforms=[
                _filter("status = 'active'", status="enabled"),
                _filter("salary > 100000", status="disabled"),
            ]
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "status = 'active'" in sql
        assert "salary > 100000" not in sql

    def test_all_disabled_produces_passthrough(self):
        ds = _make_dataset(
            transforms=[
                _trim("name", status="disabled"),
                _filter("x = 1", status="disabled"),
            ]
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert sql == "SELECT * FROM {{ source('proj', 'ds') }}"


class TestFillNull:
    def test_fill_null_text(self):
        ds = _make_dataset(
            transforms=[_fill_null("city", "Unknown")],
            schema_fields=["city"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "COALESCE(city, 'Unknown') AS city" in sql

    def test_fill_null_numeric(self):
        ds = _make_dataset(
            transforms=[_fill_null("salary", "0")],
            schema_fields=["salary"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "COALESCE(salary, 0) AS salary" in sql

    def test_fill_null_text_with_quotes(self):
        ds = _make_dataset(
            transforms=[_fill_null("city", "O'Brien")],
            schema_fields=["city"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "COALESCE(city, 'O''Brien') AS city" in sql


class TestMapValues:
    def test_map_values(self):
        ds = _make_dataset(
            transforms=[
                _map_values(
                    "status",
                    [
                        {"from": "A", "to": "Active"},
                        {"from": "I", "to": "Inactive"},
                    ],
                )
            ],
            schema_fields=["status"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "CASE" in sql
        assert "WHEN status = 'A' THEN 'Active'" in sql
        assert "WHEN status = 'I' THEN 'Inactive'" in sql
        assert "ELSE status END AS status" in sql

    def test_map_values_with_quotes(self):
        ds = _make_dataset(
            transforms=[
                _map_values(
                    "status",
                    [
                        {"from": "O'Brien", "to": "O'Malley"},
                    ],
                )
            ],
            schema_fields=["status"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "WHEN status = 'O''Brien' THEN 'O''Malley'" in sql


class TestUnknownOperation:
    def test_unknown_operation_produces_comment(self):
        ds = _make_dataset(
            transforms=[
                Transform(
                    id="t-unknown",
                    name="Unknown",
                    condition_json=None,
                    transform_type="clean",
                    target_column="col",
                    expression_config={"operation": "frobnicate"},
                    status="enabled",
                )
            ],
            schema_fields=["col"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "-- unsupported operation: frobnicate for column col" in sql


class TestCaseOperations:
    def test_upper(self):
        ds = _make_dataset(
            transforms=[_case("name", "upper")],
            schema_fields=["name"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "UPPER(name) AS name" in sql

    def test_lower(self):
        ds = _make_dataset(
            transforms=[_case("name", "lower")],
            schema_fields=["name"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "LOWER(name) AS name" in sql

    def test_title(self):
        ds = _make_dataset(
            transforms=[_case("name", "title")],
            schema_fields=["name"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "title_case(name) AS name" in sql

    def test_snake(self):
        ds = _make_dataset(
            transforms=[_case("name", "snake")],
            schema_fields=["name"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "snake_case(name) AS name" in sql

    def test_kebab(self):
        ds = _make_dataset(
            transforms=[_case("name", "kebab")],
            schema_fields=["name"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "kebab_case(name) AS name" in sql


class TestCleaningOrder:
    def test_transforms_sorted_by_created_at(self):
        ds = _make_dataset(
            transforms=[
                _case("city", "upper", created_at=datetime(2024, 1, 2)),
                _trim("name", created_at=datetime(2024, 1, 1)),
            ],
            schema_fields=["name", "city"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # TRIM(name) should come before UPPER(city) since created_at is earlier
        trim_pos = sql.index("TRIM(name)")
        upper_pos = sql.index("UPPER(city)")
        assert trim_pos < upper_pos
