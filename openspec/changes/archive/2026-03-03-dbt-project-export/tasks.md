## 1. Setup & Dependencies

- [ ] 1.1 Verify PyYAML is in `backend/pyproject.toml` dependencies. If not, add it via `uv add pyyaml` and regenerate the lockfile with `uv lock`. Confirm import works with `uv run python -c "import yaml"`.
- [ ] 1.2 Create the `backend/app/use_cases/project/dbt/` package directory with `__init__.py`. The `__init__.py` should export a single public function: `generate_dbt_project_zip(project: Project) -> tuple[bytes, str]` that delegates to the individual generators and returns `(zip_bytes, snake_case_project_name)`.

## 2. Naming Utility

- [ ] 2.1 Create `backend/app/use_cases/project/dbt/naming.py` with two functions: `to_snake_case(name: str) -> str` (lowercase, replace non-alphanumeric with underscore, strip edges, fallback to `"dataset"`) and `deduplicate_names(names: list[str]) -> list[str]` (append `_1`, `_2` suffixes for collisions, first occurrence keeps base name).
- [ ] 2.2 Write unit tests for naming in `backend/tests/use_cases/project/dbt/test_naming.py`: simple conversion, special characters, empty-after-conversion fallback, duplicate detection with numeric suffixes, triple duplicates, mixed case inputs.

## 3. YAML Generators

- [ ] 3.1 Create `backend/app/use_cases/project/dbt/project_yml.py` with a function `generate_project_yml(project_name_snake: str) -> str` that produces a valid `dbt_project.yml` string with `name`, `version: "1.0.0"`, `profile` (matching name), and `model-paths: ["models"]`. Use `yaml.dump()` with `default_flow_style=False`.
- [ ] 3.2 Create `backend/app/use_cases/project/dbt/profiles_yml.py` with a function `generate_profiles_yml(project_name_snake: str) -> str` that produces a `profiles.yml` string with DuckDB target, `:memory:` path, `httpfs` extension, and S3 settings using literal `{{ env_var('...') }}` Jinja placeholders. Handle YAML serialization carefully to preserve `{{ }}` as literal strings.
- [ ] 3.3 Create `backend/app/use_cases/project/dbt/sources_yml.py` with a function `generate_sources_yml(project_name_snake: str, datasets: list[tuple[str, Dataset]]) -> str` where each tuple is `(snake_name, dataset)`. Each dataset becomes a source table with its deduplicated snake_case name, `meta.dataset_id`, and storage path metadata.
- [ ] 3.4 Create `backend/app/use_cases/project/dbt/schema_yml.py` with a function `generate_schema_yml(datasets: list[tuple[str, Dataset]]) -> str` where each tuple is `(snake_name, dataset)`. Each dataset becomes a model named `stg_{snake_name}` with columns derived from `schema_config.fields`. Type mapping: `text` -> `string`, `number` -> `float64`, `boolean` -> `boolean`, `select` -> `string`. Empty schema_config produces empty columns list.
- [ ] 3.5 Write unit tests for all YAML generators in `backend/tests/use_cases/project/dbt/test_yaml_generators.py`: verify project_yml name/profile/version/model-paths, verify profiles_yml contains env_var placeholders and no real credentials, verify sources_yml maps datasets to tables with metadata, verify sources_yml with empty dataset list, verify schema_yml maps columns with correct types, verify schema_yml handles missing/empty schema_config.

## 4. Model SQL Generator

- [ ] 4.1 Create `backend/app/use_cases/project/dbt/model_sql.py` with a function `generate_model_sql(project_name_snake: str, dataset_name_snake: str, dataset: Dataset) -> str` that produces a CTE-based SQL file. Build the CTE pipeline conditionally: source CTE always present (using `{{ source() }}`), cleaned CTE only if enabled clean/map transforms exist, filtered CTE only if enabled filter transforms exist, final SELECT with aliases only if enabled alias transforms exist. Passthrough case (no transforms) produces `SELECT * FROM {{ source() }}`.
- [ ] 4.2 Implement the transform-to-SQL mapping within `model_sql.py` (or a helper): trim -> `TRIM(col)`, case upper/lower/title -> `UPPER`/`LOWER`/`INITCAP`, case snake/kebab -> `REGEXP_REPLACE`-based, fill_null -> `COALESCE` (quoted for text, unquoted for numeric based on `fill_type`), map_values -> `CASE WHEN ... ELSE col END`. Unknown operations produce a SQL comment `-- unsupported operation: ...`. Only transforms with `status == 'enabled'` are included.
- [ ] 4.3 Implement filter transform handling: combine enabled filter transforms' `condition_sql` with `AND` in the WHERE clause of the filtered CTE. The filtered CTE selects from `cleaned` if cleaning exists, otherwise from `source`.
- [ ] 4.4 Implement alias handling in the final SELECT: convert alias names to snake_case, list all columns with aliased columns using `col AS alias_snake`, unaliased columns listed as-is. If no aliases, use `SELECT * FROM {last_cte}`.
- [ ] 4.5 Write unit tests for model SQL generator in `backend/tests/use_cases/project/dbt/test_model_sql.py`: passthrough (no transforms), only cleaning transforms, only filter transforms, only alias transforms, all transform types combined, disabled transforms excluded, multiple filters combined with AND, multiple cleaning transforms on same column, unknown operation produces comment, fill_null text vs numeric quoting, value mapping CASE WHEN generation.

## 5. README Generator

- [ ] 5.1 Create `backend/app/use_cases/project/dbt/readme.py` with a function `generate_readme(project_name: str) -> str` that produces a Markdown README including: project title, "Generated by Dashboard Chat" note, required environment variables list (S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT), and `dbt run` usage instructions.
- [ ] 5.2 Write a unit test for the README generator in `backend/tests/use_cases/project/dbt/test_readme.py`: verify project name appears, verify all four env var names appear, verify `dbt run` command appears.

## 6. Zip Orchestrator

- [ ] 6.1 Implement `generate_dbt_project_zip()` in `backend/app/use_cases/project/dbt/__init__.py`. This function accepts a `Project` domain object and a `project_name_snake` string. It: (1) computes deduplicated snake_case names for all datasets, (2) calls each generator to produce file contents, (3) writes all files into an in-memory zip via `zipfile.ZipFile(BytesIO(), 'w')`, (4) returns the zip bytes. File paths in the zip: `dbt_project.yml`, `profiles.yml`, `models/staging/sources.yml`, `models/schema.yml`, `README.md`, and `models/staging/stg_{name}.sql` per dataset.
- [ ] 6.2 Write unit tests for the zip orchestrator in `backend/tests/use_cases/project/dbt/test_zip_orchestrator.py`: verify zip contains expected files for a project with datasets, verify zip contains skeleton files for an empty project, verify deduplicated names are used consistently across all files within the zip, verify all files in zip are valid UTF-8 text.

## 7. Use Case

- [ ] 7.1 Create `backend/app/use_cases/project/export_dbt_project.py` with the `export_dbt_project` use case function using `@with_repositories` + `@handle_returns` decorator stack. Logic: (1) fetch project via metadata repository with datasets and transforms eagerly loaded, (2) verify org_id via `get_auth_user()` (same pattern as `get_project`), (3) convert to domain model, (4) call `generate_dbt_project_zip(project)`, (5) return `Success((zip_bytes, project_name_snake))`. Raise `ProjectNotFound` for missing project, `AuthorizationError` for org_id mismatch.
- [ ] 7.2 Write unit tests for the use case in `backend/tests/use_cases/project/test_export_dbt_project.py`: successful export returns zip bytes and project name, missing project returns Failure with ProjectNotFound, wrong org_id returns Failure with AuthorizationError, empty project (no datasets) returns valid zip. Use `set_session()` and `set_auth_user()` context setup, mock metadata repository.

## 8. API Route

- [ ] 8.1 Add the export route to `backend/app/routers/projects.py`: `@router.get("/{project_id}/export/dbt")` with `use_db_context` dependency. The handler calls the use case, returns `StreamingResponse` with `media_type="application/zip"` and `Content-Disposition: attachment; filename="{name}_dbt.zip"` on Success, or `JSONResponse` with RFC 9457 error format on Failure. Import `StreamingResponse` from `fastapi.responses` and `io.BytesIO`.
- [ ] 8.2 Write integration tests for the route in `backend/tests/routers/test_projects_export.py` (or add to existing project router tests): successful export returns 200 with `application/zip` content type and correct Content-Disposition header, response body is a valid zip, 404 for nonexistent project, 403 for wrong org_id.

## 9. Frontend

- [ ] 9.1 Add `exportDbtProject(projectId: string): Promise<void>` function to `frontend/src/lib/api/projects.ts` (or a new `exports.ts` file). Fetch `GET /api/projects/{projectId}/export/dbt` with auth headers. On success: convert to blob, extract filename from Content-Disposition header (fallback `"export.zip"`), create temporary anchor element, trigger download, revoke object URL. On failure: throw error with meaningful message.
- [ ] 9.2 Add an "Export as dbt" button or menu item to the project view UI. Wire it to call `exportDbtProject()` with the current project ID. Add loading state during download and error display on failure. Keep the UI minimal for v1 — no configuration dialog.
- [ ] 9.3 Write a unit test for the download function in `frontend/src/test/` or alongside the API module: mock fetch to return a blob response with Content-Disposition header, verify anchor element is created and clicked, verify object URL is revoked. Test error case: mock fetch returning 404, verify error is thrown.
