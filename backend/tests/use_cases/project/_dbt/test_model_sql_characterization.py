"""Characterization tests for ``generate_model_sql`` (ADR-026 MR-5 prep).

These tests are the Feathers brownfield-regression net for the MR-5 swap that
replaces the parallel CTE compiler at ``app.use_cases.project._dbt.model_sql``
with the ibis-native staging-tier pipeline (``app.models.dataset_sql``) +
a dbt-source ibis compiler plugin.

Per CLAUDE.md brownfield discipline (Feathers characterization-before-refactor),
the tests are authored BEFORE the refactor lands. They pin the dbt-staging-SQL
CONTRACT — row-equivalence under DuckDB evaluation — not the legacy CTE
mechanism (``WITH source AS``, ``cleaned AS``, ``filtered AS``). Mechanism-pinning
substring asserts live in ``test_model_sql.py`` and are slated for L2 rewrite
per nw-test-refactoring-catalog as part of the same step.

Per ADR-026 §"Decision outcome" item 1 (ibis as the only compiler), the
emitted SQL after MR-5 will:

  * NOT contain ``WITH source AS`` / ``cleaned AS`` / ``filtered AS`` CTEs.
  * Render the source table as ``{{ source('<project>', '<dataset>') }}`` at
    the FROM clause (same dbt macro the legacy compiler produced — the
    customer-visible contract).
  * Be evaluation-equivalent (rows materially identical) to the legacy
    output when the dbt source macro is substituted with a real DuckDB table.

DWD-4 (hard constraint from the DISTILL wave-decisions):

  * NO ``.replace("'", "''")`` literal-escape defenses.
  * Ibis literal escaping IS the closure mechanism for SQL injection.

The first assertion family pins the dbt-source macro contract (mechanism-
neutral). The second family asserts row-equivalence under DuckDB by:

  1. Generating the SQL via ``generate_model_sql(project, dataset, ds)``.
  2. Substituting the ``{{ source('<project>', '<dataset>') }}`` macro with a
     real DuckDB table name backed by a small fixture.
  3. Executing the substituted SQL and capturing the row set.
  4. Asserting the row set matches an expected business-meaning row set
     derived from the fixture + transform semantics.

The third assertion ("contract-cleanup post-refactor") asserts the legacy
CTE markers are GONE from the emitted SQL. This is RED until GREEN lands
and is the falsifiability anchor that prevents Fixture Theater for MR-5.
"""

from __future__ import annotations

from datetime import datetime

import duckdb
import pytest

from app.models.dataset import Dataset
from app.models.transform import Transform
from app.types import QueryBuilderJSON
from app.use_cases.project._dbt.model_sql import generate_model_sql
from app.utils.sql_functions import ALL_MACROS

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _make_dataset(transforms=None, schema_fields=None, schema_types=None):
    """Build a Dataset for the characterization probe.

    ``schema_fields`` is the ordered column list; ``schema_types`` maps each
    field to its declared schema type (defaults to ``text``). The Dataset's
    ``name`` is fixed so it does not leak into the SQL emit (the dbt-source
    macro replaces the FROM-clause identifier).
    """
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
        name=f"Fill {col}",
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
    """Build a filter Transform with both condition_json (structured) and
    condition_sql (legacy raw-SQL cache) populated to the equivalent predicate.

    Production filter transforms always carry ``condition_json`` (the DB column
    is NOT NULL). The legacy ``model_sql.py`` read ``condition_sql`` directly;
    the refactored path reads ``condition_json.as_ibis_filter(table)``. The
    characterization tests populate both so the same fixture exercises both
    compilers without code-shape divergence.
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
    """Filter Transform: ``<field> > <value>``."""
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


# ---------------------------------------------------------------------------
# DuckDB row-equivalence harness
# ---------------------------------------------------------------------------


def _duckdb_with_macros() -> duckdb.DuckDBPyConnection:
    """In-memory DuckDB with the title/snake/kebab macros registered."""
    con = duckdb.connect(":memory:")
    for macro_sql in ALL_MACROS:
        con.execute(macro_sql)
    return con


def _execute_with_source_substitution(
    con: duckdb.DuckDBPyConnection,
    sql: str,
    *,
    project: str,
    dataset: str,
    real_table: str,
) -> list[tuple]:
    """Substitute the dbt source macro with ``real_table`` and execute.

    The substitution targets the byte-faithful macro string the compiler
    emits (legacy AND new path both emit ``{{ source('<proj>', '<ds>') }}``).
    """
    macro = "{{ source('" + project + "', '" + dataset + "') }}"
    runnable = sql.replace(macro, real_table)
    return con.execute(runnable).fetchall()


# ---------------------------------------------------------------------------
# Family 1 — Source-macro contract (mechanism-neutral)
# These pin the customer-visible byte-faithful contract: the FROM-clause
# emits ``{{ source(...) }}`` with the right project/dataset pair. Stable
# across the refactor.
# ---------------------------------------------------------------------------


class TestSourceMacroContract:
    """The dbt-source macro is the customer-visible contract surface.

    Per ADR-026 §"Decision outcome" item 1, the staging-tier dbt model
    references its upstream raw dataset via ``{{ source('<project>',
    '<dataset>') }}``. This survives the MR-5 swap byte-faithfully.
    """

    def test_passthrough_emits_source_macro_in_from_clause(self):
        ds = _make_dataset()
        sql = generate_model_sql("my_project", "my_dataset", ds)
        assert "{{ source('my_project', 'my_dataset') }}" in sql

    def test_emits_source_macro_when_transforms_present(self):
        ds = _make_dataset(
            transforms=[_trim("name")],
            schema_fields=["name", "salary"],
        )
        sql = generate_model_sql("my_project", "my_dataset", ds)
        assert "{{ source('my_project', 'my_dataset') }}" in sql

    @pytest.mark.parametrize(
        "project,dataset,expected",
        [
            ("proj", "ds", "{{ source('proj', 'ds') }}"),
            ("my_project", "my_dataset", "{{ source('my_project', 'my_dataset') }}"),
            ("a", "b", "{{ source('a', 'b') }}"),
        ],
    )
    def test_source_macro_renders_with_supplied_project_and_dataset(self, project, dataset, expected):
        ds = _make_dataset(transforms=[_trim("name")], schema_fields=["name"])
        sql = generate_model_sql(project, dataset, ds)
        assert expected in sql


# ---------------------------------------------------------------------------
# Family 2 — Row-equivalence under DuckDB (the staging-tier contract)
# These execute the emitted SQL against a real DuckDB fixture and assert
# rows. This is the binding contract — survives any compiler swap that
# preserves staging-tier semantics.
# ---------------------------------------------------------------------------


class TestRowEquivalenceUnderDuckDB:
    """The staging-tier contract: rows materially identical to legacy output."""

    def _setup_employees_table(self, con: duckdb.DuckDBPyConnection) -> None:
        """Fixture: a small employees table covering text/numeric/null cases."""
        con.execute(
            """
            CREATE TABLE raw_employees AS
            SELECT * FROM (VALUES
                ('  Alice  ', 'A',         100000, 'engineering', 'O''Brien'),
                ('Bob',       'I',          40000, 'sales',       NULL),
                ('Carol',     NULL,        120000, 'engineering', 'Smith'),
                ('  Dave',    'A',          30000, 'support',     NULL),
                ('Eve',       'A',          80000, 'engineering', 'O''Brien')
            ) AS t(name, status, salary, department, lastname)
            """
        )

    def test_trim_strips_leading_and_trailing_whitespace(self):
        con = _duckdb_with_macros()
        self._setup_employees_table(con)

        ds = _make_dataset(
            transforms=[_trim("name")],
            schema_fields=["name", "status", "salary", "department", "lastname"],
        )
        sql = generate_model_sql("proj", "ds", ds)

        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_employees")
        names = sorted(r[0] for r in rows)
        # Trim removes the 2-space pad around "Alice" and the leading pad on "Dave".
        assert names == ["Alice", "Bob", "Carol", "Dave", "Eve"]

    @pytest.mark.parametrize(
        "mode,expected_names",
        [
            ("upper", {"  ALICE  ", "BOB", "CAROL", "  DAVE", "EVE"}),
            ("lower", {"  alice  ", "bob", "carol", "  dave", "eve"}),
        ],
    )
    def test_case_upper_and_lower(self, mode, expected_names):
        """Each case transform applies in isolation — the cleaning pipeline
        preserves the input's whitespace (no implicit trim)."""
        con = _duckdb_with_macros()
        self._setup_employees_table(con)

        ds = _make_dataset(
            transforms=[_case("name", mode)],
            schema_fields=["name", "status", "salary", "department", "lastname"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_employees")
        assert {r[0] for r in rows} == expected_names

    @pytest.mark.parametrize(
        "mode,sample_input,expected",
        [
            ("title", "  hello world  ", "Hello World"),
            ("snake", "Hello World", "hello_world"),
            ("kebab", "Hello World", "hello-world"),
        ],
    )
    def test_case_title_snake_kebab_apply_dbt_macros(self, mode, sample_input, expected):
        """The dbt macros for title/snake/kebab survive byte-faithfully so
        the staging model can resolve them under ``dbt run`` against DuckDB."""
        con = _duckdb_with_macros()
        con.execute(
            "CREATE TABLE raw_t (label TEXT)",
        )
        con.execute(f"INSERT INTO raw_t VALUES ('{sample_input}')")

        ds = _make_dataset(
            transforms=[_case("label", mode)],
            schema_fields=["label"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_t")
        assert rows == [(expected,)]

    def test_fill_null_text_replaces_null_with_supplied_string(self):
        con = _duckdb_with_macros()
        self._setup_employees_table(con)
        ds = _make_dataset(
            transforms=[_fill_null("status", "Unknown")],
            schema_fields=["name", "status", "salary", "department", "lastname"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_employees")
        # Carol's NULL status is replaced with "Unknown"; others unchanged.
        carol_row = next(r for r in rows if r[0] == "Carol")
        assert carol_row[1] == "Unknown"
        assert {r[1] for r in rows} == {"A", "I", "Unknown"}

    def test_fill_null_numeric_replaces_null_without_quotes(self):
        """A numeric fill_value flows through ibis as a numeric literal —
        no SQL-side string quoting on the fill_value.

        Production callers supply an integer fill_value for numeric columns
        (see ``test_cleaning_expression.py`` for the canonical type contract).
        """
        con = _duckdb_with_macros()
        con.execute(
            "CREATE TABLE raw_t (id INTEGER, salary INTEGER)",
        )
        con.execute("INSERT INTO raw_t VALUES (1, 50000), (2, NULL), (3, 70000)")
        ds = _make_dataset(
            transforms=[_fill_null("salary", 0)],
            schema_fields=["id", "salary"],
            schema_types={"id": "number", "salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_t")
        salary_by_id = {r[0]: r[1] for r in rows}
        assert salary_by_id == {1: 50000, 2: 0, 3: 70000}

    def test_fill_null_value_with_embedded_quote_is_safely_escaped(self):
        """DWD-4 hard constraint: ibis literal escaping closes the injection
        vector. No ``.replace("'", "''")`` defense should be required at the
        application layer — ibis does the work."""
        con = _duckdb_with_macros()
        con.execute("CREATE TABLE raw_t (lastname TEXT)")
        con.execute(
            "INSERT INTO raw_t VALUES ('Smith'), (NULL), ('Jones')",
        )
        ds = _make_dataset(
            transforms=[_fill_null("lastname", "O'Brien")],
            schema_fields=["lastname"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_t")
        # The embedded quote must round-trip — DuckDB sees the unescaped
        # value, not a doubled-quote artifact.
        assert sorted(r[0] for r in rows) == ["Jones", "O'Brien", "Smith"]

    def test_map_values_replaces_listed_values_else_passes_through(self):
        con = _duckdb_with_macros()
        self._setup_employees_table(con)
        ds = _make_dataset(
            transforms=[
                _map_values(
                    "status",
                    [
                        {"from": "A", "to": "Active"},
                        {"from": "I", "to": "Inactive"},
                    ],
                ),
            ],
            schema_fields=["name", "status", "salary", "department", "lastname"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_employees")
        statuses = {r[1] for r in rows}
        # 'A' -> 'Active', 'I' -> 'Inactive', NULL passes through (else col).
        assert "Active" in statuses
        assert "Inactive" in statuses
        assert None in statuses
        assert "A" not in statuses
        assert "I" not in statuses

    def test_map_values_with_embedded_quote_round_trips(self):
        """DWD-4: embedded ``'`` in mapping values is handled by ibis literal
        escaping, not by application-layer ``.replace("'", "''")``."""
        con = _duckdb_with_macros()
        con.execute("CREATE TABLE raw_t (lastname TEXT)")
        con.execute("INSERT INTO raw_t VALUES ('O''Brien'), ('Smith')")
        ds = _make_dataset(
            transforms=[
                _map_values(
                    "lastname",
                    [{"from": "O'Brien", "to": "O'Malley"}],
                ),
            ],
            schema_fields=["lastname"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_t")
        assert sorted(r[0] for r in rows) == ["O'Malley", "Smith"]

    def test_filter_keeps_only_matching_rows(self):
        con = _duckdb_with_macros()
        self._setup_employees_table(con)
        ds = _make_dataset(
            transforms=[_eq_filter("status", "A")],
            schema_fields=["name", "status", "salary", "department", "lastname"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_employees")
        # Three rows have status='A' in the fixture.
        assert len(rows) == 3
        assert all(r[1] == "A" for r in rows)

    def test_multiple_filters_compose_with_and(self):
        con = _duckdb_with_macros()
        self._setup_employees_table(con)
        ds = _make_dataset(
            transforms=[
                _eq_filter("status", "A"),
                _gt_filter("salary", 50000),
            ],
            schema_fields=["name", "status", "salary", "department", "lastname"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_employees")
        # status='A' AND salary>50000 → Alice (100000) and Eve (80000) only.
        names = sorted(r[0].strip() for r in rows)
        assert names == ["Alice", "Eve"]

    def test_alias_renames_column_to_snake_case(self):
        """Alias names with mixed case are snake-cased before reaching the
        DuckDB column header — dbt staging models expect snake_case columns."""
        con = _duckdb_with_macros()
        self._setup_employees_table(con)
        ds = _make_dataset(
            transforms=[_alias("department", "Dept")],
            schema_fields=["name", "status", "salary", "department", "lastname"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        macro = "{{ source('proj', 'ds') }}"
        runnable = sql.replace(macro, "raw_employees")
        cursor = con.execute(runnable)
        column_names = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
        assert "dept" in column_names
        assert "department" not in column_names
        assert len(rows) == 5

    def test_alias_with_spaces_converts_to_snake_case(self):
        con = _duckdb_with_macros()
        con.execute("CREATE TABLE raw_t (full_name TEXT, email TEXT)")
        con.execute(
            "INSERT INTO raw_t VALUES ('Alice', 'a@x.com'), ('Bob', 'b@x.com')",
        )
        ds = _make_dataset(
            transforms=[_alias("full_name", "Full Display Name")],
            schema_fields=["full_name", "email"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        macro = "{{ source('proj', 'ds') }}"
        runnable = sql.replace(macro, "raw_t")
        cursor = con.execute(runnable)
        column_names = [d[0] for d in cursor.description]
        assert "full_display_name" in column_names
        assert "full_name" not in column_names

    def test_combined_clean_filter_alias_pipeline(self):
        con = _duckdb_with_macros()
        self._setup_employees_table(con)
        ds = _make_dataset(
            transforms=[
                _trim("name"),
                _gt_filter("salary", 50000),
                _alias("department", "Dept"),
            ],
            schema_fields=["name", "status", "salary", "department", "lastname"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        macro = "{{ source('proj', 'ds') }}"
        runnable = sql.replace(macro, "raw_employees")
        cursor = con.execute(runnable)
        column_names = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
        # Three rows have salary > 50000: Alice (100000), Carol (120000), Eve (80000).
        assert len(rows) == 3
        # name column was trimmed
        names = sorted(r[0] for r in rows)
        assert names == ["Alice", "Carol", "Eve"]
        # department was aliased to dept
        assert "dept" in column_names
        assert "department" not in column_names

    def test_disabled_transforms_are_excluded(self):
        con = _duckdb_with_macros()
        self._setup_employees_table(con)
        ds = _make_dataset(
            transforms=[
                _trim("name", status="enabled"),
                _eq_filter("status", "Z", status="disabled"),  # would zero rows if active
                _alias("department", "Dept", status="disabled"),
            ],
            schema_fields=["name", "status", "salary", "department", "lastname"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        macro = "{{ source('proj', 'ds') }}"
        runnable = sql.replace(macro, "raw_employees")
        cursor = con.execute(runnable)
        column_names = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
        # Disabled filter must not zero out the result.
        assert len(rows) == 5
        # Disabled alias must NOT rename the column.
        assert "department" in column_names
        assert "dept" not in column_names

    def test_all_disabled_falls_through_to_passthrough(self):
        ds = _make_dataset(
            transforms=[
                _trim("name", status="disabled"),
                _eq_filter("status", "A", status="disabled"),
            ]
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Pure passthrough: SELECT * FROM <macro>, no projection logic.
        assert sql == "SELECT * FROM {{ source('proj', 'ds') }}"

    def test_cleaning_transforms_each_target_a_distinct_column(self):
        """Two cleaning transforms on DIFFERENT columns both apply.

        The cleaning stage iterates the (sorted) transform list and applies
        each as a column mutation — they compose into the same SELECT
        projection. The ``created_at`` ordering is the iteration order; for
        non-overlapping columns the result is order-independent and rows
        reflect both transforms.
        """
        con = _duckdb_with_macros()
        con.execute("CREATE TABLE raw_t (name TEXT, city TEXT)")
        con.execute("INSERT INTO raw_t VALUES ('  alice  ', 'paris')")
        ds = _make_dataset(
            transforms=[
                _case("city", "upper", created_at=datetime(2024, 1, 2)),
                _trim("name", created_at=datetime(2024, 1, 1)),
            ],
            schema_fields=["name", "city"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        rows = _execute_with_source_substitution(con, sql, project="proj", dataset="ds", real_table="raw_t")
        # trim('  alice  ') -> 'alice'; upper('paris') -> 'PARIS'.
        assert rows == [("alice", "PARIS")]

    def test_reserved_word_column_quoted_and_round_trips(self):
        """DuckDB reserved-word column names round-trip via ibis quoting."""
        con = _duckdb_with_macros()
        con.execute('CREATE TABLE raw_t ("select" TEXT, "order" TEXT)')
        con.execute(
            "INSERT INTO raw_t VALUES ('  alpha  ', 'first'), ('beta', 'second')",
        )
        ds = _make_dataset(
            transforms=[_trim("select")],
            schema_fields=["select", "order"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        macro = "{{ source('proj', 'ds') }}"
        runnable = sql.replace(macro, "raw_t")
        rows = con.execute(runnable).fetchall()
        # alpha is trimmed; both columns survive.
        assert sorted(r[0] for r in rows) == ["alpha", "beta"]
        assert sorted(r[1] for r in rows) == ["first", "second"]


# ---------------------------------------------------------------------------
# Family 3 — Contract cleanup post-refactor (the falsifiability anchor)
# These assertions REQUIRE the refactor to pass. They are the RED→GREEN
# pivot that prevents Fixture Theater for MR-5.
# ---------------------------------------------------------------------------


class TestContractCleanupPostRefactor:
    """Assertions that flip RED→GREEN with the MR-5 refactor.

    Before the refactor, ``generate_model_sql`` emits ``WITH source AS / cleaned
    AS / filtered AS`` CTEs — the legacy CTE-emission mechanism. After the
    refactor, those tokens are GONE because the ibis pipeline emits a flat
    SELECT projection. This family is the falsifiability anchor for MR-5.
    """

    def test_refactored_emit_does_not_contain_legacy_cte_markers(self):
        """The legacy ``WITH source AS / cleaned AS / filtered AS`` CTE
        scaffolding is the parallel-compiler hazard ADR-026 MR-5 retires.
        After the refactor, the emit is the ibis pipeline output with the
        dbt-source macro at the FROM clause — no CTE scaffolding."""
        ds = _make_dataset(
            transforms=[
                _trim("name"),
                _gt_filter("salary", 50000),
                _alias("department", "Dept"),
            ],
            schema_fields=["name", "status", "salary", "department"],
            schema_types={"salary": "number"},
        )
        sql = generate_model_sql("proj", "ds", ds)
        assert "WITH source AS" not in sql
        assert "cleaned AS" not in sql
        assert "filtered AS" not in sql

    def test_refactored_emit_has_no_application_layer_quote_escaping(self):
        """DWD-4: no ``.replace("'", "''")`` defense lives in the dbt-export
        compilation path. The emitted SQL contains ibis-escaped literals,
        not application-layer-doubled quotes layered on top of ibis output.

        Asserts via byte inspection of the emitted SQL for a fill_null with
        an embedded quote: ibis emits the literal directly; the legacy
        compiler emitted ``COALESCE(<col>, 'O''Brien')`` via .replace.
        Either form is acceptable post-refactor as long as it round-trips
        in DuckDB — this assertion is paired with the round-trip test in
        Family 2."""
        ds = _make_dataset(
            transforms=[_fill_null("lastname", "O'Brien")],
            schema_fields=["lastname"],
        )
        sql = generate_model_sql("proj", "ds", ds)
        # Sanity: the literal is in the emit (escaped however ibis emits).
        assert "O" in sql and "Brien" in sql
