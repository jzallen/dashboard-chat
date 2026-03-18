## Context

The Dashboard Chat app currently supports filter transforms (WHERE clauses) driven by chat. Users can filter and sort tables through natural language. The Transform model stores RAQB JSON trees (`condition_json`) and generated SQL (`condition_sql`), applied as Ibis filter expressions in `Dataset._build_table()`.

The BA has fully specified a data cleaning feature (30 Gherkin scenarios, 8 model gaps, API contracts, 8 chat tools, 5-phase backlog). This design addresses **how** to implement those requirements within the existing architecture.

**Key constraint**: The existing transform system is in production with filter data. All changes must be backward-compatible — existing filter transforms must continue to work without migration of stored data.

## Goals / Non-Goals

**Goals:**
- Extend the Transform model to support cleaning, alias, and value-mapping operations alongside existing filters
- Build a preview mechanism that evaluates proposed cleaning operations against real data before persisting
- Compose cleaning transforms (SELECT expressions) with filter transforms (WHERE clauses) in deterministic order
- Maintain full backward compatibility — zero impact on existing filter functionality
- Keep the chat-driven interaction pattern: preview → confirm → apply (except aliases, which apply immediately)

**Non-Goals:**
- User-reorderable transforms (v1 uses `created_at` ordering; explicit ordinal deferred)
- Regex-based or fuzzy value mapping (exact match only in v1)
- Computed/derived columns (cleaning transforms modify existing columns, not create new ones)
- Bulk cleaning across multiple datasets
- Undo history beyond single-step disable/re-enable (no multi-step undo stack)

## Decisions

### D1: Server-generated `expression_sql` from `expression_config`

**Decision**: The client sends `expression_config` (structured JSON) only. The backend generates `expression_sql` from it. The `expression_sql` field in create requests is ignored if provided.

**Rationale**: The existing filter pattern has the client generate `condition_sql` because RAQB (a client-side library) produces it. Cleaning transforms have no client-side SQL library. Generating SQL server-side:
- Eliminates SQL injection risk from client-supplied expressions
- Keeps DuckDB SQL dialect ownership on the server (where Ibis already handles it)
- Simplifies the frontend — it only needs to know operation types, not SQL syntax

**Alternative considered**: Client generates `expression_sql` (matching the filter pattern). Rejected because it would require a client-side SQL generation library, duplicate DuckDB dialect knowledge, and introduce an injection surface.

### D2: Ibis expression builder — `CleaningExpression` class

**Decision**: Create a `CleaningExpression` class in `backend/app/types.py` (alongside `QueryBuilderJSON`) that converts `expression_config` JSON into Ibis column expressions.

**Mapping:**
| Operation | expression_config | Ibis Expression |
|-----------|------------------|-----------------|
| trim | `{"operation": "trim"}` | `table[column].strip()` |
| upper | `{"operation": "case", "mode": "upper"}` | `table[column].upper()` |
| lower | `{"operation": "case", "mode": "lower"}` | `table[column].lower()` |
| title | `{"operation": "case", "mode": "title"}` | `table[column].capitalize()` (per-word via custom logic or DuckDB `INITCAP`) |
| fill_null | `{"operation": "fill_null", "fill_value": "X"}` | `table[column].fillna("X")` |
| map_values | `{"operation": "map_values", "mappings": [...]}` | `ibis.case().when(table[col] == "A", "B").when(...).else_(table[col]).end()` |
| alias | `{"operation": "alias", "alias": "Name"}` | Handled via `.rename()` not `.mutate()` |

**Rationale**: Mirrors the `QueryBuilderJSON.as_ibis_filter(table)` pattern. Keeps all SQL generation in Ibis, which handles DuckDB dialect translation. Testable in isolation.

**Alternative considered**: Raw SQL template strings. Rejected because it bypasses Ibis (inconsistent), requires manual dialect handling, and is harder to test.

### D3: `_build_table()` pipeline — mutate → filter → rename

**Decision**: Extend `Dataset._build_table()` with a three-stage pipeline:

```
1. MUTATE stage: Apply cleaning transforms as column expressions
   table = table.mutate(**{t.target_column: t.expression_config.as_ibis_expr(table) for t in cleaning_transforms})

2. FILTER stage: Apply filter transforms as WHERE clauses (existing behavior)
   table = table.filter(*[t.condition_json.as_ibis_filter(table) for t in filter_transforms])

3. RENAME stage: Apply alias transforms as column renames
   table = table.rename(**{t.expression_config.alias: t.target_column for t in alias_transforms})
```

**Ordering within MUTATE stage**: Multiple cleaning transforms on the same column compose in `created_at` order. Each mutate replaces the column, so subsequent transforms operate on the already-transformed value. This is handled by sorting cleaning transforms by `created_at` and applying them sequentially.

**Rationale**: Filters operate on cleaned values (per Gherkin scenario "filter operates on cleaned values"). Aliases apply last so they don't break column references in cleaning/filter expressions. This ordering is deterministic and matches user expectations.

### D4: Frontend `ToolCallContext` interface

**Decision**: Expand `executeToolCall` with a context object instead of individual parameters:

```typescript
interface ToolCallContext {
  // Existing
  setColumnFilters: (filters: ColumnFiltersState) => void;
  setSorting: (sorting: SortingState) => void;
  setData: (updater: (prev: Row[]) => Row[]) => void;
  // New
  datasetId: string;
  transforms: TransformResponse[];
  queryClient: QueryClient;
}
```

**Rationale**: The current function signature has 3 params. Adding 3+ more individually makes the signature unwieldy. A context object is extensible for future tool categories without signature changes. The `queryClient` enables cache invalidation after mutations.

**Alternative considered**: Separate `executeCleaningToolCall` function. Rejected because it splits tool routing logic and the AI doesn't distinguish between tool categories when making calls.

### D5: Preview endpoint uses lake repository pattern

**Decision**: The preview endpoint (`POST /transforms/preview`) follows the existing backend patterns:
- Use case in `backend/app/use_cases/transform/` with `@with_repositories` + `@handle_returns` decorator stack
- Query the Parquet data via the lake repository (DuckDB)
- Auth: verify dataset access through parent project's `org_id` (existing `DatasetService.fetch_dataset` pattern)

**Preview query strategy** (per operation type):
```sql
-- Count affected + sample (generic pattern)
SELECT column AS before, EXPRESSION(column) AS after
FROM parquet_scan('path')
WHERE column != EXPRESSION(column)  -- or IS NULL for fill_null
LIMIT 5
```

The affected count is a separate `COUNT(*)` on the same predicate. Both queries run on DuckDB — lightweight even on large files since Parquet supports column pruning.

### D6: Cross-field validation in Pydantic schemas

**Decision**: Add a `@model_validator(mode='after')` to `TransformCreate` that enforces:
- `transform_type == 'filter'` → requires `condition_json` + `condition_sql`; rejects expression fields
- `transform_type in ('clean', 'alias', 'map')` → requires `target_column` + `expression_config`; rejects condition fields
- Default `transform_type` to `'filter'` for backward compatibility

**Rationale**: Validation at the schema layer catches invalid payloads before they reach use cases. The model validator can produce clear error messages per field combination. Matches existing Pydantic patterns in the codebase.

### D7: Transform type column validation

**Decision**: Use a VARCHAR(20) column with application-level validation (Pydantic enum + Python `Literal`), not a database-level CHECK constraint.

**Rationale**: SQLite doesn't enforce CHECK constraints the same way PostgreSQL does. The app already validates via Pydantic before persistence. A `TransformType = Literal['filter', 'clean', 'alias', 'map']` type annotation in the domain model provides compile-time and runtime validation.

## Risks / Trade-offs

**[DuckDB expression compatibility]** → Ibis abstracts most dialect differences, but `INITCAP` (title case) may behave differently across DuckDB versions. **Mitigation**: Test title case explicitly in backend unit tests with multi-word strings. Use DuckDB's `INITCAP` function directly if Ibis doesn't expose it (fall back to raw SQL for this one case only).

**[Preview performance on large datasets]** → The preview query scans the full column to count affected rows. On multi-million row Parquet files this could be slow. **Mitigation**: Parquet column pruning means only the target column is read. Add a `LIMIT 100000` to the count query as a sampling cap for v1 — report "at least 100,000 cells affected" for very large datasets.

**[Composability edge cases]** → Multiple cleaning transforms on the same column applied in `created_at` order could produce unexpected results if a user applies case standardization then trim (where the reverse order makes more sense). **Mitigation**: The AI can advise on ordering in the preview message. v2 can add reordering.

**[expression_config schema evolution]** → The JSON structure of `expression_config` is untyped at the database level. If we add new operations later, old configs must remain valid. **Mitigation**: Always include an `operation` field as a discriminator. New operations are additive. Never remove or rename existing operation fields.

**[SQL injection via expression_config values]** → A `fill_value` or `alias` could contain malicious SQL. **Mitigation**: Since we generate SQL via Ibis (parameterized expressions), user-provided strings are treated as values, not SQL fragments. The `expression_sql` is server-generated, never client-supplied. Validate `alias` names to reject SQL-special characters.

## Migration Plan

1. **Alembic migration** (Phase 1): Add 4 nullable columns with `transform_type DEFAULT 'filter'`. This is backward-compatible — all existing rows get `transform_type='filter'` with null expression fields. No data migration needed.

2. **Rollback**: The migration's downgrade drops the 4 columns. Any cleaning transforms created after the migration would lose their expression data, but filter transforms are unaffected.

3. **Deployment order**: Backend first (migration + model + API), then shared types, then frontend. The extended `POST /transforms` endpoint accepts both old and new payloads, so the frontend can deploy at any time after the backend.

4. **Feature flag (optional)**: Not required for v1 since the new tools are additive and the AI only calls them when the user requests cleaning operations. The tools can be conditionally included in the system prompt if a gradual rollout is desired.

## Open Questions

1. **Title case implementation**: Does DuckDB's `INITCAP` handle all Unicode edge cases, or do we need a custom implementation? → Resolve during Task 3.1 with integration tests.

2. **Column type detection for validation**: The preview endpoint needs to reject trim on numeric columns. Where does column type information come from — the Parquet schema via DuckDB, or stored metadata? → Likely Parquet schema, since it's the source of truth for column types.

3. **"All text columns" batch trimming**: The Gherkin scenario "trim whitespace from all columns" implies the tool accepts `column: "all"`. Should this create one transform per column, or a single multi-column transform? → BA spec says "cleaning transforms are applied to each text column" → one transform per column.
