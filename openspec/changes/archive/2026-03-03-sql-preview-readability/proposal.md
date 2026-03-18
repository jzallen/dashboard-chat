## Why

The SQL Preview panel has a correctness defect and two capability gaps in case standardization. Title case currently uses `col.capitalize()` (Ibis), which only capitalizes the first character of the entire string — "san francisco" becomes "San francisco" instead of "San Francisco." The display SQL shows `INITCAP(city)`, which misleadingly suggests correct per-word behavior. Beyond correctness, users performing data normalization need snake_case and kebab-case modes that the system does not yet offer. All three operations share a common challenge: no standard SQL function name exists for them, so without an intentional pattern, their SQL Preview output would be verbose and unreadable. This change fixes the title case defect, adds snake/kebab modes, and establishes a DuckDB macro + Ibis builtin UDF pattern that ensures readable, accurate SQL Preview output for all current and future cleaning operations.

Business requirements are fully documented in `docs/backlog/sql-preview-readability-requirements.md` (6 user stories, affected operations matrix, success metrics). Updated Gherkin scenarios are in `features/data-cleaning-chat.feature` (lines 56-97 add snake/kebab case scenarios). A proposed technical approach is in `docs/backlog/sql-preview-readability.md`.

## What Changes

- **Fix title case correctness and display**: Replace `col.capitalize()` with a DuckDB macro `title_case(s)` that properly capitalizes the first letter of each word. Update `expression_sql` from `INITCAP(column)` to `title_case(column)`.
- **Add snake_case mode**: New DuckDB macro `snake_case(s)` that trims, lowercases, and replaces non-alphanumeric character runs with underscores. Available via chat as a new case standardization mode.
- **Add kebab-case mode**: New DuckDB macro `kebab_case(s)` that trims, lowercases, and replaces non-alphanumeric character runs with hyphens. Available via chat as a new case standardization mode.
- **Establish DuckDB macro + Ibis builtin UDF pattern**: New `backend/app/utils/sql_functions.py` module containing macro SQL definitions, `@ibis.udf.scalar.builtin` declarations, and a `register_duckdb_macros(conn)` function. This pattern ensures any future operation that lacks a clean standard SQL function name gets a readable, named function in the SQL Preview.
- **Extend chat tool definitions**: Add `"snake"` and `"kebab"` to the `standardizeCase` tool's mode enum and the `applyCleaningTransform` tool's operation enum in `shared/chat/prompts.ts`. Update mode descriptions and system prompt.
- **Extend frontend and worker tool call mapping**: Expand `isCase` checks in both `frontend/src/lib/table-tools/executeToolCall.ts` and `worker/lib/executeToolCall.ts` to include `"snake"` and `"kebab"`.

## Capabilities

### New Capabilities
- `sql-functions`: DuckDB SQL macro definitions (`title_case`, `snake_case`, `kebab_case`), Ibis `@udf.scalar.builtin` declarations, macro registration on DuckDB connection, and the reusable pattern for adding readable SQL functions to future operations

### Modified Capabilities
- `cleaning-sql-generation`: Title case Ibis expression changes from `col.capitalize()` to `title_case(col)` UDF; new snake/kebab case modes added to `CleaningExpression.as_ibis_expr()` and `to_display_sql()`; `valid_modes` extended from `("upper", "lower", "title")` to `("upper", "lower", "title", "snake", "kebab")`; lake repository preview updated for new modes
- `cleaning-chat-tools`: `standardizeCase` tool mode enum extended with `"snake"` and `"kebab"`; `applyCleaningTransform` operation enum extended with `"snake"` and `"kebab"`; system prompt updated with new mode descriptions; ambiguous casing clarification lists all five modes; frontend and worker `isCase` mappings extended

## Impact

- **Backend** (`backend/app/utils/sql_functions.py`): New module with macro SQL, Ibis builtin UDFs, and `register_duckdb_macros()` helper
- **Backend** (`backend/app/types.py`): `CleaningExpression` — extended `valid_modes`, updated `as_ibis_expr()` (title/snake/kebab use UDFs), updated `to_display_sql()` (title/snake/kebab emit function-call syntax)
- **Backend** (`backend/app/repositories/lake/repository.py`): Register macros on DuckDB connection; update `preview_cleaning_operation()` for snake/kebab modes
- **Backend** (`backend/app/use_cases/transform.py`): Update `_build_operation_description()` for snake/kebab
- **Shared** (`shared/chat/prompts.ts`): `standardizeCase` and `applyCleaningTransform` tool definitions extended; system prompt case mode descriptions updated
- **Worker** (`worker/`): `isCase` check expanded to include `"snake"` and `"kebab"` in tool call mapping
- **Frontend** (`frontend/src/lib/table-tools/executeToolCall.ts`): `isCase` check expanded to include `"snake"` and `"kebab"`
- **Database**: No schema migration required — `expression_config` and `expression_sql` columns already exist from migration 012. New transforms store updated function names; existing `INITCAP` values are display-only and do not affect execution.
- **Dependencies**: No new runtime dependencies. Ibis `@udf.scalar.builtin` is part of the existing ibis-framework package.
- **API contract**: No endpoint changes. The preview and transform creation endpoints accept the same payload shapes — new modes are values within `expression_config` JSON.
