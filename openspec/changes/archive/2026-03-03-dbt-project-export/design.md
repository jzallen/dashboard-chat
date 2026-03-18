## Context

Dashboard Chat stores project metadata (name, description, org_id), datasets (schema_config, storage_path, transforms), and transforms (filter/clean/alias/map with expression_config) in SQLAlchemy models backed by SQLite or PostgreSQL. Dataset data lives as Parquet files in MinIO/S3, queried via DuckDB/Ibis. The existing SQL generation pipeline in `Dataset._build_table()` compiles transforms into Ibis expressions for live execution — this produces DuckDB-dialect SQL with S3 paths and Ibis internals not suitable for dbt.

The feature file (`features/dbt-project-export.feature`) defines 16 scenarios covering happy path, transform variations, edge cases, auth/multi-tenancy, and file format requirements.

**Key constraint**: The existing `display_sql` and `staging_sql` properties produce Ibis-compiled DuckDB SQL. dbt models need `{{ source() }}` macro references, human-readable CTE chains, and standard SQL — a fundamentally different SQL generation approach is required.

## Goals / Non-Goals

**Goals:**
- Export a complete, valid dbt project as a downloadable zip file from any project with datasets
- Generate purpose-built dbt SQL with CTE pipelines that mirror the transform pipeline order (clean → filter → alias)
- Produce dbt-idiomatic YAML configuration files (dbt_project.yml, profiles.yml, sources.yml, schema.yml)
- Handle all edge cases: empty projects, no transforms, disabled transforms, duplicate snake_case names, missing schema_config
- Enforce org_id multi-tenancy on the export endpoint (same auth pattern as existing project access)

**Non-Goals:**
- No dbt run/test execution from the dashboard
- No custom dbt configuration UI (no user-facing settings for the export)
- No incremental model support — all models generate as simple SELECT statements
- No dbt packages or macros beyond the built-in `source()` macro
- No worker service involvement — this is a synchronous backend operation
- No real-time progress indicators — in-memory generation is fast enough
- No support for dbt Cloud, dbt mesh, or multi-project references

## Decisions

### D1: Purpose-built dbt SQL vs reusing Ibis-compiled SQL

**Decision**: Generate dbt model SQL from scratch using a dedicated `model_sql.py` generator that reads `expression_config` and `condition_sql` from transforms and produces human-readable CTE chains. Do NOT reuse `Dataset.display_sql`, `staging_sql`, or any Ibis compilation output.

**Rationale**: The Ibis pipeline produces DuckDB-specific SQL with:
- Hardcoded S3 paths (e.g., `read_parquet('s3://bucket/datasets/...')`) instead of `{{ source() }}` macro calls
- Ibis internal formatting (compact expressions, auto-generated aliases)
- DuckDB UDF references (e.g., `title_case()`, `snake_case()`) instead of standard SQL (`INITCAP()`)

dbt models need:
- `{{ source('project_name', 'dataset_name') }}` Jinja macro references
- Human-readable CTE chains (`WITH source AS (...), cleaned AS (...), filtered AS (...), final AS (...)`)
- Standard SQL functions compatible with the target adapter (DuckDB adapter in profiles.yml)

Reusing Ibis output would require post-processing to replace S3 paths with source macros, reformat SQL, and translate UDFs — more fragile than generating from the source `expression_config` directly.

**Alternative considered**: Post-process `display_sql` to replace S3 paths with `{{ source() }}` macros. Rejected because it couples the export to Ibis compilation internals, makes the output brittle to Ibis version changes, and produces SQL that is harder to read than purpose-built CTE chains.

### D2: Inline route handler vs controller pattern for binary responses

**Decision**: The export route handler calls the use case directly and returns `StreamingResponse` for success or `JSONResponse` for errors, bypassing the `HTTPController` static method pattern.

```python
@router.get("/{project_id}/export/dbt")
async def export_dbt_project(project_id: str, _: AsyncSession = Depends(use_db_context)):
    result = await export_dbt_project_use_case(project_id)
    match result:
        case Success(data):
            zip_bytes, project_name = data
            return StreamingResponse(
                iter([zip_bytes]),
                media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{project_name}_dbt.zip"'}
            )
        case Failure(error):
            return JSONResponse(
                content=_error_response(error),
                status_code=error._status_code
            )
```

**Rationale**: The existing `HTTPController` pattern returns `tuple[dict, int]` — designed for JSON responses. Binary responses require a `StreamingResponse` with bytes content and custom headers. Forcing this through the controller would require either:
1. A new return type overload on the controller (breaks the clean pattern)
2. Returning base64-encoded content in JSON (wasteful, defeats the purpose)

The inline handler is explicit, simple, and isolated to this one endpoint. If more binary response endpoints appear in the future, a dedicated controller method pattern can be extracted.

**Alternative considered**: Add a `tuple[bytes, int, dict]` return variant to HTTPController. Rejected because it introduces type ambiguity in a class that currently has a clean single return type, and this is the only binary endpoint planned.

### D3: dbt generator module structure

**Decision**: Create a `backend/app/use_cases/project/dbt/` package with one file per generated artifact:

```
backend/app/use_cases/project/dbt/
├── __init__.py          # exports generate_dbt_project_zip(project) -> bytes
├── project_yml.py       # dbt_project.yml
├── profiles_yml.py      # profiles.yml (DuckDB target, S3 env var placeholders)
├── sources_yml.py       # models/staging/sources.yml
├── schema_yml.py        # models/schema.yml
├── model_sql.py         # models/staging/stg_{name}.sql per dataset
├── readme.py            # README.md
└── naming.py            # snake_case conversion + deduplication
```

**Rationale**: Each generator is small (20-60 lines), independently testable, and maps 1:1 to a dbt project file. The `__init__.py` orchestrates them into a zip using Python's `zipfile` module with `BytesIO`. This structure:
- Makes it obvious which code generates which file
- Enables isolated unit testing per generator
- Avoids a single monolithic generator function
- Mirrors the dbt project structure conceptually

**Alternative considered**: A single `generate_dbt_project.py` file with helper functions. Rejected because it would grow to 300+ lines and mixing YAML generation, SQL generation, and zip packaging in one file obscures the purpose of each section.

### D4: CTE pipeline structure for model SQL

**Decision**: Each dataset model SQL follows a CTE-based pipeline that mirrors the existing Ibis pipeline order (mutate → filter → rename):

```sql
-- For a dataset with all transform types:
WITH source AS (
    SELECT * FROM {{ source('project_name', 'dataset_name') }}
),

cleaned AS (
    SELECT
        TRIM(name) AS name,
        UPPER(city) AS city,
        COALESCE(department, 'Unknown') AS department,
        *  -- pass through unmodified columns
    FROM source
),

filtered AS (
    SELECT *
    FROM cleaned
    WHERE status = 'active'
      AND salary > 50000
),

final AS (
    SELECT
        name,
        city,
        department AS dept,
        employee_id AS emp_id
    FROM filtered
)

SELECT * FROM final
```

**CTE inclusion is conditional**: Only CTEs with active transforms are generated:
- No transforms → `SELECT * FROM {{ source() }}`
- Only cleaning → source + cleaned + final SELECT
- Only filters → source + filtered + final SELECT
- Only aliases → source + final SELECT with renames
- All types → source + cleaned + filtered + final SELECT

**Transform → SQL mapping** (from `expression_config`):

| Transform Type | expression_config | dbt SQL |
|---|---|---|
| clean/trim | `{"operation": "trim"}` | `TRIM(column_name) AS column_name` |
| clean/upper | `{"operation": "case", "case_type": "upper"}` | `UPPER(column_name) AS column_name` |
| clean/lower | `{"operation": "case", "case_type": "lower"}` | `LOWER(column_name) AS column_name` |
| clean/title | `{"operation": "case", "case_type": "title"}` | `INITCAP(column_name) AS column_name` |
| clean/snake | `{"operation": "case", "case_type": "snake"}` | `REGEXP_REPLACE(LOWER(TRIM(column_name)), '[^a-z0-9]+', '_', 'g') AS column_name` |
| clean/kebab | `{"operation": "case", "case_type": "kebab"}` | `REGEXP_REPLACE(LOWER(TRIM(column_name)), '[^a-z0-9]+', '-', 'g') AS column_name` |
| clean/fill_null | `{"operation": "fill_null", "fill_value": "X"}` | `COALESCE(column_name, 'X') AS column_name` |
| map | `{"operation": "map_values", "mappings": [...]}` | `CASE WHEN col = 'A' THEN 'B' ... ELSE col END AS col` |
| filter | `condition_sql` field | Used in WHERE clause of filtered CTE |
| alias | `{"operation": "alias", "alias_name": "New Name"}` | `column AS new_name` in final SELECT |

**Only enabled transforms** (`status == 'enabled'`) appear in generated SQL. Disabled and deleted transforms are excluded entirely.

### D5: Snake_case naming with deduplication

**Decision**: Dataset names are converted to snake_case for dbt model filenames and identifiers using the same regex logic as `Dataset.display_name_to_filename()`. When two datasets produce the same snake_case name, a numeric suffix (`_1`, `_2`, etc.) disambiguates them.

```python
# naming.py
def to_snake_case(name: str) -> str:
    safe = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return safe or "dataset"

def deduplicate_names(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    result = []
    for name in names:
        snake = to_snake_case(name)
        if snake in seen:
            seen[snake] += 1
            result.append(f"{snake}_{seen[snake]}")
        else:
            seen[snake] = 0
            result.append(snake)
    return result
```

**Rationale**: dbt requires valid Python/SQL identifiers for model names. The existing `display_name_to_filename()` method already handles the conversion but doesn't handle collisions. The deduplication uses a simple counter — deterministic ordering based on the dataset list order (which is `created_at DESC` from the repository).

### D6: YAML generation strategy

**Decision**: Use PyYAML's `yaml.dump()` with `default_flow_style=False` for all YAML file generation. Build Python dicts representing the YAML structure, then serialize.

**profiles.yml** uses `env_var()` Jinja macro for S3 credentials — no real values ever appear in the export:

```yaml
<project_name>:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: ":memory:"
      extensions:
        - httpfs
      settings:
        s3_region: "{{ env_var('S3_REGION', 'us-east-1') }}"
        s3_access_key_id: "{{ env_var('S3_ACCESS_KEY_ID') }}"
        s3_secret_access_key: "{{ env_var('S3_SECRET_ACCESS_KEY') }}"
        s3_endpoint: "{{ env_var('S3_ENDPOINT', '') }}"
```

**Note**: The `{{ env_var() }}` Jinja syntax in profiles.yml must be written as literal strings — PyYAML will not interpret them as Jinja. This is correct behavior since dbt processes Jinja at runtime.

### D7: Use case return type

**Decision**: The `export_dbt_project` use case returns `Result[tuple[bytes, str], str]` where the tuple is `(zip_bytes, project_name)`. The project name is needed by the route handler for the `Content-Disposition` filename.

```python
@with_repositories
@handle_returns
async def export_dbt_project(
    project_id: str,
    *,
    repositories: 'RepositoryContainer',
) -> Result[tuple[bytes, str], str]:
    # 1. Fetch project (org_id verified)
    # 2. Generate zip bytes
    # 3. Return (zip_bytes, snake_case_project_name)
```

**Rationale**: The route handler needs both the zip content and the project name for the filename header. Returning a tuple keeps the use case focused on data generation while giving the handler everything it needs.

## Risks / Trade-offs

**[PyYAML Jinja escaping]** → profiles.yml contains `{{ env_var() }}` syntax that looks like Jinja but must be treated as literal strings by PyYAML. **Mitigation**: PyYAML does not interpret `{{ }}` — it serializes them as plain strings. This is correct behavior. Add a test that verifies the output contains literal `{{ env_var(` strings.

**[Large project performance]** → A project with many datasets generates many SQL files and YAML entries. The zip is built in memory. **Mitigation**: Even 100 datasets would produce a zip well under 1MB. In-memory generation with `BytesIO` + `zipfile` is efficient. No streaming or chunking needed for v1.

**[expression_config schema drift]** → The dbt SQL generator reads `expression_config` JSON directly. If the config schema changes (new operations, renamed fields), the generator must be updated. **Mitigation**: The generator uses a match/case dispatch on the `operation` field. Unknown operations fall through to a comment (`-- unsupported operation: X`) rather than failing. New operations are additive — old configs remain valid.

**[SQL dialect compatibility]** → The generated SQL uses DuckDB functions (INITCAP, TRIM, COALESCE, REGEXP_REPLACE) since the profiles.yml targets dbt-duckdb. If users change the target adapter, some SQL may not work. **Mitigation**: This is by design — the export targets the same DuckDB engine the dashboard uses. The README documents this assumption. Supporting multiple adapters is a non-goal for v1.

**[condition_sql injection in filter CTEs]** → Filter transforms store `condition_sql` (generated by the frontend query builder). This SQL is embedded directly in the WHERE clause of the filtered CTE. **Mitigation**: `condition_sql` is already generated by RAQB (a trusted client-side library) and used in live Ibis execution. The dbt export does not introduce new trust boundaries — the same SQL is just written to a file instead of executed immediately.

**[First binary response endpoint]** → The `StreamingResponse` pattern is new to the codebase. Future developers may not immediately understand the inline handler pattern. **Mitigation**: Clear docstring on the route handler explaining why it bypasses the controller pattern. If a second binary endpoint appears, extract a shared pattern.

## Migration Plan

No migration needed. This feature:
1. Reads existing data only (no schema changes, no new tables, no new columns)
2. Adds a new endpoint (additive — no breaking changes to existing API surface)
3. Adds new backend modules (no modifications to existing modules)
4. Adds a thin frontend download function and UI element

**Deployment order**: Backend first (new endpoint + generators), then frontend (button + API function). The endpoint is independent — deploying backend first has no impact on existing functionality.

**Rollback**: Remove the route from `projects.py` and delete the `dbt/` generator package. No data cleanup needed.

## Open Questions

1. **PyYAML dependency**: Is PyYAML already in the backend's `pyproject.toml` dependencies? If not, it needs to be added via `uv add pyyaml`. Resolve during task 1 setup.

2. **Column pass-through in cleaned CTE**: When only some columns have cleaning transforms, the cleaned CTE needs to pass through unmodified columns. Should this use `SELECT *, TRIM(name) AS name` (implicit override) or explicitly list all columns? The `SELECT *, expr AS col` pattern relies on DuckDB's behavior of later columns overriding earlier ones with the same name — verify this works correctly with dbt-duckdb.

3. **Fill null numeric type handling**: When `fill_value` is numeric (e.g., `0`), the COALESCE expression should not quote the value (`COALESCE(col, 0)` not `COALESCE(col, '0')`). The `expression_config` includes a `fill_type` field — the SQL generator should use this to determine quoting.
