## 1. SQL Functions Module (Backend)

- [ ] 1.1 Create `backend/app/utils/sql_functions.py` with DuckDB macro SQL constants for `title_case`, `snake_case`, and `kebab_case`. Implement `register_duckdb_macros(conn)` function that executes `CREATE OR REPLACE MACRO` for all three macros on a given DuckDB connection.
- [ ] 1.2 Add `@ibis.udf.scalar.builtin` declarations for `title_case(s: str) -> str`, `snake_case(s: str) -> str`, and `kebab_case(s: str) -> str` in the same module. Verify that Ibis emits the function name directly in generated SQL (not the macro body).

## 2. CleaningExpression Updates (Backend)

- [ ] 2.1 Update `CleaningExpression` in `backend/app/types.py`: extend `valid_modes` from `("upper", "lower", "title")` to `("upper", "lower", "title", "snake", "kebab")`.
- [ ] 2.2 Update `CleaningExpression.as_ibis_expr()`: change title case from `col.capitalize()` to `title_case(col)` using the imported UDF. Add snake case branch using `snake_case(col)`. Add kebab case branch using `kebab_case(col)`.
- [ ] 2.3 Update `CleaningExpression.to_display_sql()`: change title case from `f"INITCAP({column})"` to `f"title_case({column})"`. Add snake case returning `f"snake_case({column})"`. Add kebab case returning `f"kebab_case({column})"`.

## 3. Lake Repository Updates (Backend)

- [ ] 3.1 Update `backend/app/repositories/lake/repository.py` to call `register_duckdb_macros(conn)` when establishing DuckDB connections, before any query execution.
- [ ] 3.2 Update `preview_cleaning_operation()` in the lake repository: change title case preview from `col.capitalize()` to `title_case(col)` UDF for both the expression and the affected predicate. Add snake case handling using `snake_case(col)` with predicate `col != snake_case(col)`. Add kebab case handling using `kebab_case(col)` with predicate `col != kebab_case(col)`.

## 4. Use Case Updates (Backend)

- [ ] 4.1 Update `_build_operation_description()` in `backend/app/use_cases/transform.py` to return `"Convert to snake_case"` for snake mode and `"Convert to kebab-case"` for kebab mode.

## 5. Chat Tool Definitions (Shared)

- [ ] 5.1 Update `standardizeCase` tool definition in `shared/chat/prompts.ts`: extend mode enum from `["title", "upper", "lower"]` to `["title", "upper", "lower", "snake", "kebab"]`. Add descriptions for snake mode ("converts to snake_case format, e.g. Product Name -> product_name; also known as underscore case") and kebab mode ("converts to kebab-case format, e.g. Product Name -> product-name; also known as hyphen case").
- [ ] 5.2 Update `applyCleaningTransform` tool definition in `shared/chat/prompts.ts`: extend the operation enum to include `"snake"` and `"kebab"`.
- [ ] 5.3 Update the system prompt in `shared/chat/prompts.ts`: update the cleaning instructions to list all five case modes (upper, lower, title, snake, kebab). Mention "underscore case" and "hyphen case" as alternate terminology. Update the ambiguous casing clarification to list all five options.

## 6. Worker Tool Call Mapping

- [ ] 6.1 Update the worker's tool call mapping: expand the `isCase` check from `["upper", "lower", "title"]` to `["upper", "lower", "title", "snake", "kebab"]` so that snake and kebab operations are correctly mapped to `{ operation: "case", mode: "<operation>" }`.

## 7. Frontend Tool Call Mapping

- [ ] 7.1 Update `frontend/src/lib/table-tools/executeToolCall.ts`: expand the `isCase` check from `["upper", "lower", "title"]` to `["upper", "lower", "title", "snake", "kebab"]` so that snake and kebab operations are correctly mapped to `{ operation: "case", mode: "<operation>" }`.

## 8. Backend Unit Tests

- [ ] 8.1 Add unit tests for `CleaningExpression` snake case: verify `as_ibis_expr()` returns the `snake_case()` UDF call, verify `to_display_sql()` returns `"snake_case(column)"`, test validation accepts `mode: "snake"`.
- [ ] 8.2 Add unit tests for `CleaningExpression` kebab case: verify `as_ibis_expr()` returns the `kebab_case()` UDF call, verify `to_display_sql()` returns `"kebab_case(column)"`, test validation accepts `mode: "kebab"`.
- [ ] 8.3 Fix existing title case unit tests: update expected `to_display_sql()` from `"INITCAP(column)"` to `"title_case(column)"`, update expected `as_ibis_expr()` to use UDF instead of `.capitalize()`.
- [ ] 8.4 Verify validation error message for invalid mode now lists all five valid modes: `upper`, `lower`, `title`, `snake`, `kebab`.
- [ ] 8.5 Add unit tests for preview with snake/kebab modes: verify correct affected count, verify sample before/after values.

## 9. Integration Tests for DuckDB Macros

- [ ] 9.1 Create integration tests in `backend/tests/` that register macros on a real DuckDB connection and verify `title_case` edge cases: `"san francisco"` -> `"San Francisco"`, `"  hello  world  "` -> `"Hello World"`, `"jOHN dOE"` -> `"John Doe"`, single word, empty string.
- [ ] 9.2 Add integration tests for `snake_case` edge cases: `"Product Name"` -> `"product_name"`, `"FIRST NAME"` -> `"first_name"`, `"already_snake"` -> `"already_snake"`, `"Product #1"` -> `"product_1"`, consecutive spaces, leading/trailing whitespace.
- [ ] 9.3 Add integration tests for `kebab_case` edge cases: `"Product Name"` -> `"product-name"`, `"FIRST NAME"` -> `"first-name"`, `"already-kebab"` -> `"already-kebab"`, `"Product #1"` -> `"product-1"`, consecutive spaces, leading/trailing whitespace.
- [ ] 9.4 Add integration test verifying that Ibis `to_sql()` output contains the function name (e.g., `title_case(`) rather than the macro expansion.

## 10. Optional Data Migration

- [ ] 10.1 Create a standalone SQL script (`scripts/fix_title_case_display_sql.sql` or similar) that updates existing title case transforms: `UPDATE transforms SET expression_sql = REPLACE(expression_sql, 'INITCAP(', 'title_case(') WHERE expression_sql LIKE 'INITCAP(%')`. Document this as optional for teams that want retroactive display accuracy.
