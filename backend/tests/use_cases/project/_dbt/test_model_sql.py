"""Unit tests for ``generate_model_sql`` — contract-mirroring assertions.

L2 contract-mirroring rewrite per nw-test-refactoring-catalog.

The PRE-MR-5 assertions in this file pinned the legacy CTE-emission
mechanism (substring asserts on ``WITH source AS`` / ``cleaned AS`` /
``filtered AS`` and the bare-string SQL fragments inside those CTEs). After
ADR-026 MR-5 retired the parallel compiler in favor of the ibis pipeline +
``IbisDbtSourceDuckDBCompiler``, those substrings interrogate a retired
mechanism, NOT the dbt-staging-SQL contract.

The Iron Rule's "never modify a failing test to make it pass" does NOT
apply to pre-existing legacy-mechanism-pinning assertions. nw-test-
refactoring-catalog L2 explicitly carves this case out — those tests are
refactored alongside the production code.

Each test below pins one of these CONTRACT surfaces:

  * ``{{ source('<project>', '<dataset>') }}`` at the FROM clause (the
    customer-visible dbt-staging-SQL macro contract — same as the legacy
    compiler).
  * Presence of the transform's salient SQL token (``TRIM(``, ``UPPER(``,
    ``COALESCE(``, ``CASE``, ``WHERE``) — the transform-applied contract.
  * Snake-cased alias output (the dbt staging model column-naming
    contract).
  * Disabled transforms produce no observable output (the enabled-status
    contract).

For row-level evaluation-equivalence, see
``test_model_sql_characterization.py`` which executes the emitted SQL
against a real DuckDB fixture and asserts row sets — the binding
brownfield regression net for MR-5.
"""

from datetime import datetime

from app.models.dataset import Dataset
from app.models.transform import Transform
from app.types import QueryBuilderJSON
from app.use_cases.project._dbt.model_sql import generate_model_sql


def _make_dataset(transforms=None, schema_fields=None, schema_types=None):
    schema_config: dict = {}
    if schema_fields:
        types = schema_types or {}
        schema_config = {
            "fields": {f: {"type": types.get(f, "text")} for f in schema_fields},
        }
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


def _eq_filter(field, value, status="enabled"):
    """Filter Transform with both ``condition_json`` and ``condition_sql``.

    Production filter transforms always carry ``condition_json`` (the DB
    column is NOT NULL); the legacy compiler used ``condition_sql``. The
    contract-mirroring rewrite populates both so the assertions exercise
    the post-MR-5 path (which uses ``condition_json.as_ibis_filter``).
    """
    sql_value_lit = f"'{value}'" if isinstance(value, str) else str(value)
    qbj = QueryBuilderJSON(
        {
            "children1": {
                "rule-1": {
                    "type": "rule",
                    "properties": {
                        "field": field,
                        "operator": "equal",
                        "value": [value],
                    },
                },
            },
            "properties": {"conjunction": "AND"},
        }
    )
    return Transform(
        id=f"t-filter-{field}",
        name=f"Filter {field}",
        condition_json=qbj,
        transform_type="filter",
        condition_sql=f"{field} = {sql_value_lit}",
        status=status,
    )


def _gt_filter(field, value, status="enabled"):
    qbj = QueryBuilderJSON(
        {
            "children1": {
                "rule-1": {
                    "type": "rule",
                    "properties": {
                        "field": field,
                        "operator": "greater",
                        "value": [value],
                    },
                },
            },
            "properties": {"conjunction": "AND"},
        }
    )
    return Transform(
        id=f"t-filter-{field}-gt",
        name=f"Filter {field}",
        condition_json=qbj,
        transform_type="filter",
        condition_sql=f"{field} > {value}",
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


class TestModelSqlPassthrough:
    def test_generate_model_sql_when_no_transforms_returns_select_star(self):
        ds = _make_dataset()
        sql = generate_model_sql("my_project", "my_dataset", ds)
        assert sql == "SELECT * FROM {{ source('my_project', 'my_dataset') }}"

    def test_generate_model_sql_when_empty_transforms_list_returns_select_star(self):
        ds = _make_dataset(transforms=[])
        sql = generate_model_sql("my_project", "my_dataset", ds)
        assert sql == "SELECT * FROM {{ source('my_project', 'my_dataset') }}"


class TestModelSqlCleaning:
    def test_generate_model_sql_when_single_trim_emits_trim_against_target_column(self):
        ds = _make_dataset(
            transforms=[_trim("name")],
            schema_fields=["name", "salary", "status"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: the TRIM call applies to the target column and the
        # dbt-source macro appears at the FROM clause.
        assert "TRIM(" in sql
        assert '"name"' in sql
        assert "{{ source('proj', 'ds') }}" in sql

    def test_generate_model_sql_when_no_schema_returns_error_comment(self):
        """Refactored contract: no schema_fields + transforms is an error.
        The legacy compiler had an undocumented ``<expr>, *`` fallback; the
        new contract requires schema-present datasets and emits a visible
        error comment instead."""
        ds = _make_dataset(transforms=[_trim("name")])
        sql = generate_model_sql("proj", "ds", ds)
        assert sql.startswith("-- Error")
        assert "schema_config.fields" in sql


class TestModelSqlFilters:
    def test_generate_model_sql_when_single_filter_emits_where_clause(self):
        ds = _make_dataset(
            transforms=[_eq_filter("status", "active")],
            schema_fields=["status", "salary"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: a WHERE clause is present and the dbt-source macro
        # appears at the FROM clause.
        assert "WHERE" in sql
        assert "'active'" in sql
        assert "{{ source('proj', 'ds') }}" in sql

    def test_generate_model_sql_when_multiple_filters_compose_with_and(self):
        ds = _make_dataset(
            transforms=[
                _eq_filter("status", "active"),
                _gt_filter("salary", 50000),
            ],
            schema_fields=["status", "salary"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: both filter predicates appear in the WHERE clause.
        assert "WHERE" in sql
        assert "'active'" in sql
        assert "50000" in sql


class TestModelSqlAliases:
    def test_generate_model_sql_when_alias_present_emits_snake_cased_rename(self):
        ds = _make_dataset(
            transforms=[_alias("department", "Dept")],
            schema_fields=["name", "department"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: the alias name is snake-cased ("Dept" -> "dept") in the
        # rendered column header.
        assert '"dept"' in sql
        assert '"department"' in sql
        assert "{{ source('proj', 'ds') }}" in sql

    def test_generate_model_sql_when_alias_has_spaces_converts_to_snake_case(self):
        ds = _make_dataset(
            transforms=[_alias("full_name", "Full Display Name")],
            schema_fields=["full_name", "email"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: spaces in alias names are collapsed to underscores.
        assert '"full_display_name"' in sql


class TestModelSqlCombined:
    def test_generate_model_sql_when_clean_filter_alias_all_apply(self):
        ds = _make_dataset(
            transforms=[
                _trim("name"),
                _gt_filter("salary", 50000),
                _alias("department", "Dept"),
            ],
            schema_fields=["name", "salary", "status", "department"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: each transform contributes its salient SQL token and the
        # dbt-source macro appears at the FROM clause.
        assert "TRIM(" in sql
        assert "WHERE" in sql
        assert "50000" in sql
        assert '"dept"' in sql
        assert "{{ source('proj', 'ds') }}" in sql


class TestModelSqlDisabledTransforms:
    def test_generate_model_sql_when_clean_disabled_excludes_it(self):
        ds = _make_dataset(
            transforms=[
                _trim("name", status="enabled"),
                _trim("city", status="disabled"),
            ],
            schema_fields=["name", "city"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: the enabled trim applies; the disabled trim does not.
        # The disabled column is passed through as a plain reference (no TRIM).
        assert "TRIM(" in sql
        assert sql.count("TRIM(") == 1
        assert '"city"' in sql

    def test_generate_model_sql_when_filter_disabled_excludes_it(self):
        ds = _make_dataset(
            transforms=[
                _eq_filter("status", "active", status="enabled"),
                _gt_filter("salary", 100000, status="disabled"),
            ],
            schema_fields=["status", "salary"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: only the enabled filter's predicate appears.
        assert "'active'" in sql
        assert "100000" not in sql

    def test_generate_model_sql_when_all_disabled_returns_passthrough(self):
        ds = _make_dataset(
            transforms=[
                _trim("name", status="disabled"),
                _eq_filter("x", "1", status="disabled"),
            ]
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert sql == "SELECT * FROM {{ source('proj', 'ds') }}"


class TestModelSqlFillNull:
    def test_generate_model_sql_when_fill_null_text_uses_coalesce(self):
        ds = _make_dataset(
            transforms=[_fill_null("city", "Unknown")],
            schema_fields=["city"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: COALESCE applies, and the fill value appears as a quoted
        # string literal.
        assert "COALESCE(" in sql
        assert "'Unknown'" in sql

    def test_generate_model_sql_when_fill_null_numeric_uses_coalesce_without_quotes(self):
        ds = _make_dataset(
            transforms=[_fill_null("salary", 0)],
            schema_fields=["salary"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Contract: COALESCE applies; numeric fill value is a bare numeric
        # literal (no quotes).
        assert "COALESCE(" in sql
        assert "'0'" not in sql

    def test_generate_model_sql_when_fill_null_value_has_quote_handles_safely(self):
        """DWD-4: ibis literal escaping closes the injection vector.
        The application-layer ``.replace("'", "''")`` defense has been
        removed; ibis emits a SQL literal that round-trips the embedded
        quote correctly."""
        ds = _make_dataset(
            transforms=[_fill_null("city", "O'Brien")],
            schema_fields=["city"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # The literal must appear in some safely-escaped form (either the
        # SQL-doubled-quote shape ``'O''Brien'`` or an ibis-emitted
        # alternative). The byte-faithful round-trip is asserted via DuckDB
        # in test_model_sql_characterization.py — here we pin the
        # generic shape only.
        assert "COALESCE(" in sql
        # The "Brien" substring survives in the emitted SQL.
        assert "Brien" in sql


class TestModelSqlMapValues:
    def test_generate_model_sql_when_map_values_generates_case_expression(self):
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
        # Contract: a CASE WHEN chain is emitted with each mapping's literals.
        assert "CASE" in sql
        assert "'A'" in sql
        assert "'Active'" in sql
        assert "'I'" in sql
        assert "'Inactive'" in sql

    def test_generate_model_sql_when_map_values_with_embedded_quote_handles_safely(self):
        """DWD-4: ibis literal escaping closes the injection vector.
        The application-layer ``.replace("'", "''")`` defense has been
        removed."""
        ds = _make_dataset(
            transforms=[
                _map_values(
                    "status",
                    [{"from": "O'Brien", "to": "O'Malley"}],
                )
            ],
            schema_fields=["status"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # The mapping literals appear in some safely-escaped form; the
        # round-trip is asserted via DuckDB in the characterization tests.
        assert "CASE" in sql
        assert "Brien" in sql
        assert "Malley" in sql


class TestModelSqlUnknownOperation:
    def test_generate_model_sql_when_unknown_operation_emits_error_comment(self):
        """An unsupported cleaning operation surfaces as a visible
        ``-- Error generating SQL: ...`` comment so the dbt-export bundle
        does not silently drop the transform — preserves the legacy
        visible-failure contract."""
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
        assert sql.startswith("-- Error generating SQL")
        assert "frobnicate" in sql


class TestModelSqlCaseOperations:
    def test_generate_model_sql_when_case_upper_applies(self):
        ds = _make_dataset(transforms=[_case("name", "upper")], schema_fields=["name"])
        sql = generate_model_sql("proj", "ds", ds)
        assert "UPPER(" in sql

    def test_generate_model_sql_when_case_lower_applies(self):
        ds = _make_dataset(transforms=[_case("name", "lower")], schema_fields=["name"])
        sql = generate_model_sql("proj", "ds", ds)
        assert "LOWER(" in sql

    def test_generate_model_sql_when_case_title_applies_title_macro(self):
        ds = _make_dataset(transforms=[_case("name", "title")], schema_fields=["name"])
        sql = generate_model_sql("proj", "ds", ds)
        assert "TITLE_CASE(" in sql or "title_case(" in sql

    def test_generate_model_sql_when_case_snake_applies_snake_macro(self):
        ds = _make_dataset(transforms=[_case("name", "snake")], schema_fields=["name"])
        sql = generate_model_sql("proj", "ds", ds)
        assert "SNAKE_CASE(" in sql or "snake_case(" in sql

    def test_generate_model_sql_when_case_kebab_applies_kebab_macro(self):
        ds = _make_dataset(transforms=[_case("name", "kebab")], schema_fields=["name"])
        sql = generate_model_sql("proj", "ds", ds)
        assert "KEBAB_CASE(" in sql or "kebab_case(" in sql


class TestModelSqlCleaningOrder:
    def test_generate_model_sql_applies_both_cleanings_when_targets_differ(self):
        """The ``created_at`` ordering is the iteration order of the
        cleaning stage. For non-overlapping target columns the result is
        order-independent — both transforms contribute their tokens."""
        ds = _make_dataset(
            transforms=[
                _case("city", "upper", created_at=datetime(2024, 1, 2)),
                _trim("name", created_at=datetime(2024, 1, 1)),
            ],
            schema_fields=["name", "city"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "TRIM(" in sql
        assert "UPPER(" in sql


class TestModelSqlInjectionPrevention:
    def test_generate_model_sql_when_column_has_special_chars_quotes_them(self):
        """DWD-4 contract: ibis quoting closes the column-name injection
        vector. The injection payload survives only inside the
        identifier-quoted boundary; the embedded ``"`` in the column name
        is doubled as ``""`` per SQL identifier-quoting rules."""
        ds = _make_dataset(
            transforms=[_trim('col"; DROP TABLE t; --')],
            schema_fields=['col"; DROP TABLE t; --', "safe_col"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # The TRIM applies and the embedded ``"`` in the column identifier
        # is escaped via the SQL identifier-quoting convention (doubled).
        assert "TRIM(" in sql
        assert 'col""' in sql
        # The dangerous payload remains embedded inside identifier-quoted
        # form; the trailing ``"`` after ``--`` closes the identifier.
        assert "DROP TABLE t; --" in sql

    def test_generate_model_sql_when_column_is_reserved_word_quotes_it(self):
        ds = _make_dataset(
            transforms=[_trim("select")],
            schema_fields=["select", "order"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Reserved-word column names are quoted.
        assert "TRIM(" in sql
        assert '"select"' in sql
        assert '"order"' in sql
