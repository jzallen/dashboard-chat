## Context

The Dashboard Chat cleaning toolkit currently supports three case standardization modes: upper, lower, and title. Title case has a correctness defect -- `CleaningExpression.as_ibis_expr()` uses Ibis `.capitalize()`, which only capitalizes the first character of the entire string, not the first character of each word. The display SQL shows `INITCAP(city)`, which misleadingly suggests correct per-word behavior. Additionally, users need snake_case and kebab-case modes for data normalization, and these operations have no standard SQL function name -- meaning without an intentional approach, their SQL Preview output would be verbose and unreadable.

The data cleaning transform system was built in the `data-cleaning-transforms` change. Key architecture points:
- `CleaningExpression` in `backend/app/types.py` converts `expression_config` JSON to Ibis expressions and display SQL strings
- The lake repository's `preview_cleaning_operation()` handles preview queries via DuckDB
- The `_build_table()` pipeline applies transforms in mutate -> filter -> rename order
- `expression_sql` is generated server-side at transform creation time (design D1 from the original change)
- Chat tool definitions in `shared/chat/prompts.ts` drive the AI's ability to invoke operations
- Frontend and worker both map tool call operations to `expression_config` format

The existing transform model schema (migration 012) already has `expression_config` (JSON) and `expression_sql` (TEXT) columns -- no schema migration is needed.

## Goals / Non-Goals

**Goals:**
- Fix title case to correctly capitalize the first letter of each word in multi-word strings
- Add snake_case and kebab-case as new case standardization modes
- Ensure the SQL Preview accurately reflects what actually executes for all case operations
- Establish a reusable pattern (DuckDB macros + Ibis builtin UDFs) for adding readable SQL functions to future operations
- Maintain full backward compatibility with existing transforms

**Non-Goals:**
- Additional case formats (camelCase, PascalCase, CONSTANT_CASE, sentence case) -- deferred to future requests
- Migration of existing stored `INITCAP` display SQL values -- old values are display-only and do not affect execution
- Changes to non-case cleaning operations (trim, fill_null, map_values, alias) -- these already have readable SQL
- UI changes to SQLPreview or TransformCard components -- they already render `expression_sql` directly
- Database schema changes -- the existing columns support the new modes without modification

## Decisions

### AD1: DuckDB Macros + Ibis Builtin UDF Pattern

**Decision**: Register DuckDB SQL macros for operations that lack clean standard SQL function names. Declare matching `@ibis.udf.scalar.builtin` functions in Ibis. When Ibis generates SQL, it emits the function name directly (e.g., `title_case(city)`) without expanding the macro body. This approach is used for `title_case`, `snake_case`, and `kebab_case`.

**Macro implementations:**

```sql
-- title_case: Split on spaces, uppercase first char of each word, lowercase rest, rejoin
CREATE OR REPLACE MACRO title_case(s) AS
    LIST_REDUCE(
        STRING_SPLIT(TRIM(s), ' '),
        (acc, word) -> acc || ' ' || UPPER(word[1]) || LOWER(word[2:]),
        ''
    )[2:]

-- snake_case: Trim, lowercase, replace non-alphanum runs with underscore, strip edges
CREATE OR REPLACE MACRO snake_case(s) AS
    TRIM(REGEXP_REPLACE(LOWER(TRIM(s)), '[^a-z0-9]+', '_', 'g'), '_')

-- kebab_case: Trim, lowercase, replace non-alphanum runs with hyphen, strip edges
CREATE OR REPLACE MACRO kebab_case(s) AS
    TRIM(REGEXP_REPLACE(LOWER(TRIM(s)), '[^a-z0-9]+', '-', 'g'), '-')
```

**Ibis declarations:**

```python
@ibis.udf.scalar.builtin
def title_case(s: str) -> str: ...

@ibis.udf.scalar.builtin
def snake_case(s: str) -> str: ...

@ibis.udf.scalar.builtin
def kebab_case(s: str) -> str: ...
```

**Rationale**: This approach solves both the readability problem (clean function names in SQL Preview) and the correctness problem (macro implements correct multi-word behavior). The `@ibis.udf.scalar.builtin` decorator tells Ibis "this function exists in the backend, emit its name as-is in SQL" -- so `to_sql()` produces `title_case(t0.city)` rather than expanding the macro body. This keeps the SQL Preview human-readable while DuckDB handles the expansion at execution time.

**Alternative considered**: Raw SQL template strings in `to_display_sql()` with Ibis `.capitalize()` for execution. Rejected because it would maintain the display/execution mismatch -- the preview would show one thing while a different Ibis expression executes. The whole point is that what you see IS what executes.

**Alternative considered**: Python-side string transformation (not SQL). Rejected because it would bypass DuckDB, break the SQL Preview contract, and not work with the existing Ibis pipeline.

### AD2: New Module -- `backend/app/utils/sql_functions.py`

**Decision**: Create a dedicated module that owns all DuckDB macro definitions and Ibis builtin UDF declarations. The module exports the UDF functions (for use in `CleaningExpression`) and a `register_duckdb_macros(conn)` function (called from the lake repository).

**Rationale**: Keeping macros and UDFs in a single module makes the pattern discoverable. A developer adding a future operation can look at this file, see the three examples, and follow the same pattern. The module has no application dependencies (only `ibis` and `duckdb`), making it easy to test in isolation.

**Alternative considered**: Inline macro registration in the lake repository and UDF declarations in `types.py`. Rejected because it scatters related code across two files and obscures the pattern.

### AD3: No Schema Migration Required

**Decision**: No Alembic migration is needed. The database schema does not change. New title case transforms will store `title_case(city)` in `expression_sql` instead of `INITCAP(city)`. Existing `INITCAP` values remain in the database as-is.

**Rationale**: The `expression_sql` column is display-only -- it is never executed. The actual execution path uses `as_ibis_expr()`, which will now use the corrected UDF. Old transforms with `INITCAP` display strings are historical records; changing them would modify audit history. If a user re-applies title case to the same column, the new transform will store the correct `title_case()` display SQL.

**Alternative considered**: SQL UPDATE script to fix existing `INITCAP` values. Deferred as optional -- the old values are not incorrect in the sense of causing execution errors; they are only misleading as display strings. A data correction script can be provided for teams that want audit trail accuracy for historical transforms.

### AD4: Changes by Service Layer

**Backend changes (4 files):**

1. **New `backend/app/utils/sql_functions.py`**: Macro SQL constants, `@ibis.udf.scalar.builtin` declarations, `register_duckdb_macros(conn)` function.

2. **`backend/app/types.py` -- `CleaningExpression`**:
   - `valid_modes` extended from `("upper", "lower", "title")` to `("upper", "lower", "title", "snake", "kebab")`
   - `as_ibis_expr()`: title case changes from `col.capitalize()` to `title_case(col)`. Snake case uses `snake_case(col)`. Kebab case uses `kebab_case(col)`.
   - `to_display_sql()`: title case changes from `f"INITCAP({column})"` to `f"title_case({column})"`. Snake: `f"snake_case({column})"`. Kebab: `f"kebab_case({column})"`.

3. **`backend/app/repositories/lake/repository.py`**:
   - Call `register_duckdb_macros(conn)` at connection establishment time (before any queries).
   - Update `preview_cleaning_operation()`: title case preview uses `title_case(col)` instead of `col.capitalize()`. Snake and kebab modes use `snake_case(col)` and `kebab_case(col)` respectively, with affected predicate `col != fn(col)`.

4. **`backend/app/use_cases/transform.py`**:
   - Update `_build_operation_description()` to return `"Convert to snake_case"` for snake mode and `"Convert to kebab-case"` for kebab mode.

**Shared changes (1 file):**

5. **`shared/chat/prompts.ts`**:
   - `standardizeCase` tool: mode enum `["title", "upper", "lower", "snake", "kebab"]`. Add descriptions for snake ("converts to snake_case, e.g. Product Name -> product_name") and kebab ("converts to kebab-case, e.g. Product Name -> product-name").
   - `applyCleaningTransform` tool: operation enum extended with `"snake"` and `"kebab"`.
   - System prompt: Update mode descriptions in cleaning instructions to list all five modes. Mention "underscore case" and "hyphen case" as alternate terminology.

**Worker changes (1 file):**

6. **Worker tool call mapping**: Expand `isCase` check from `["upper", "lower", "title"]` to `["upper", "lower", "title", "snake", "kebab"]`.

**Frontend changes (1 file):**

7. **`frontend/src/lib/table-tools/executeToolCall.ts`**: Expand `isCase` check from `["upper", "lower", "title"]` to `["upper", "lower", "title", "snake", "kebab"]`.

### AD5: Edge Case Handling

**Decision**: Define specific edge case behavior that the DuckDB macros must handle. These become test cases.

| Input | title_case | snake_case | kebab_case |
|-------|-----------|------------|------------|
| `"san francisco"` | `"San Francisco"` | `"san_francisco"` | `"san-francisco"` |
| `"  hello  world  "` | `"Hello World"` | `"hello_world"` | `"hello-world"` |
| `"Product Name"` | `"Product Name"` | `"product_name"` | `"product-name"` |
| `"FIRST NAME"` | `"First Name"` | `"first_name"` | `"first-name"` |
| `"already_snake"` | `"Already_snake"` | `"already_snake"` | `"already-snake"` |
| `"already-kebab"` | `"Already-kebab"` | `"already_kebab"` | `"already-kebab"` |
| `"Product #1"` | `"Product #1"` | `"product_1"` | `"product-1"` |
| `"hello"` | `"Hello"` | `"hello"` | `"hello"` |
| `""` | `""` | `""` | `""` |

**Rationale**: Pre-defining edge cases prevents ambiguity during implementation and testing. The snake_case and kebab_case macros use regex replacement, which naturally handles consecutive special characters and multiple spaces by collapsing them into a single delimiter. Title case preserves non-space delimiters (hyphens, underscores) within words because it only splits on spaces.

## Risks / Trade-offs

**[DuckDB macro portability]** The macros use DuckDB-specific functions (`LIST_REDUCE`, `STRING_SPLIT`, `REGEXP_REPLACE` with `'g'` flag). If the project ever moves to a different SQL engine, the macro bodies would need rewriting. **Mitigation**: The Ibis builtin UDF declarations are engine-agnostic -- only the macro registration is DuckDB-specific. The `register_duckdb_macros()` function can be swapped for a PostgreSQL equivalent (`CREATE FUNCTION`) if needed. For this project, DuckDB is the only execution engine.

**[title_case splits on spaces only]** The `title_case` macro splits on spaces, so hyphenated words like `"smith-jones"` become `"Smith-jones"` (hyphen preserved, second word not capitalized). This matches the standard `INITCAP` behavior in most databases and is consistent with user expectations for data cleaning. **Mitigation**: If users need hyphen-aware title case, a future macro variant can be added without changing the existing one.

**[Macro registration on every connection]** `register_duckdb_macros()` runs `CREATE OR REPLACE MACRO` on every new DuckDB connection. For the lake repository pattern (connection per query), this adds three DDL statements per request. **Mitigation**: DuckDB macro registration is lightweight (no I/O, pure in-memory). Three `CREATE OR REPLACE MACRO` calls add negligible overhead compared to Parquet I/O. If profiling shows otherwise, macros could be registered once per process via a connection pool hook.

**[Existing INITCAP display values not migrated]** Old title case transforms retain `INITCAP(column)` in `expression_sql`. Users reviewing historical transforms will see the old display string. **Mitigation**: This is cosmetic only -- execution uses the corrected UDF regardless. An optional data correction script can be provided for teams that want retroactive display accuracy. The script would be a simple `UPDATE transforms SET expression_sql = REPLACE(expression_sql, 'INITCAP(', 'title_case(') WHERE expression_sql LIKE 'INITCAP(%'`.

**[Empty string and NULL handling]** The macros operate on string values. NULL inputs return NULL (DuckDB's default NULL propagation). Empty strings pass through unchanged (TRIM of empty is empty, regex on empty produces empty). **Mitigation**: This is correct behavior -- NULL should stay NULL, empty should stay empty. No special handling needed.

## Migration Plan

No database migration is required. Deployment order:

1. **Backend first**: Deploy the new `sql_functions.py` module, updated `types.py`, updated lake repository, and updated use case. This is backward-compatible -- existing transforms continue to work because `as_ibis_expr()` still handles all existing modes. New title case transforms will use the corrected UDF.

2. **Shared + Worker**: Deploy the extended tool definitions in `shared/chat/prompts.ts` and the worker's expanded `isCase` check. The AI can now invoke snake/kebab modes.

3. **Frontend**: Deploy the expanded `isCase` check in `executeToolCall.ts`. The frontend can now handle snake/kebab tool calls.

All three can be deployed simultaneously since the changes are additive and backward-compatible. There are no breaking changes to APIs or data formats.

**Rollback**: Revert all three deployments. Existing transforms with `title_case()`, `snake_case()`, or `kebab_case()` in `expression_sql` will display the function name but execution will fail if the macros are not registered. To handle this edge case, the rollback should either (a) re-register the macros even on the old code, or (b) accept that transforms created during the rollback window need manual cleanup.

## Open Questions

1. **title_case with hyphens**: Should `"smith-jones"` become `"Smith-Jones"` (split on hyphens too) or `"Smith-jones"` (split on spaces only)? The current design splits on spaces only, matching standard INITCAP behavior. Revisit if users report this as an issue.

2. **Optional data correction script**: Should we ship a SQL script that updates existing `INITCAP(column)` values to `title_case(column)` in the transforms table? The design defers this as optional, but it could be included as a non-blocking follow-up task.
