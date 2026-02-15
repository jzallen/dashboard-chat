## 1. Data Model Extension (Backend)

- [ ] 1.1 Create Alembic migration adding `transform_type` (VARCHAR(20), NOT NULL, DEFAULT 'filter'), `target_column` (VARCHAR(255), NULL), `expression_sql` (TEXT, NULL), `expression_config` (JSON, NULL) to the `transforms` table. Verify on both SQLite and PostgreSQL. Include downgrade that drops all four columns.
- [ ] 1.2 Add `TransformType = Literal['filter', 'clean', 'alias', 'map']` to `backend/app/models/transform.py`. Add `transform_type`, `target_column`, `expression_sql`, `expression_config` fields to the Transform dataclass. Update `serialize()`, `keys()`, and `__iter__()` to include the new fields.
- [ ] 1.3 Add corresponding ORM columns to `TransformRecord` in `backend/app/repositories/metadata/transform_record.py`. Map `expression_config` as a JSON column and `expression_sql` as Text.
- [ ] 1.4 Extend Pydantic schemas in `backend/app/routers/schemas/dataset.py`: add optional fields to `TransformCreate`, `TransformResponse`, and `TransformUpdate`. Add `@model_validator(mode='after')` to `TransformCreate` enforcing cross-field rules per transform_type (see design D6).

## 2. Expression Builder (Backend)

- [ ] 2.1 Create `CleaningExpression` class in `backend/app/types.py` (alongside `QueryBuilderJSON`). Implement `as_ibis_expr(table)` method that converts `expression_config` JSON → Ibis column expressions: trim → `.strip()`, case → `.upper()`/`.lower()`/DuckDB `INITCAP`, fill_null → `.fillna()`, map_values → `ibis.case()` chain. Include input validation for missing fields and unknown operations.
- [ ] 2.2 Add server-side `expression_sql` generation in the transform creation use case. When `transform_type != 'filter'`, use `CleaningExpression` to generate the Ibis expression, compile it to SQL via DuckDB backend, and store as `expression_sql`. Ignore any client-provided `expression_sql` (design D1).
- [ ] 2.3 Write unit tests for `CleaningExpression`: one test per operation type (trim, upper, lower, title, fill_null, map_values, alias), plus tests for invalid configs (missing operation, unknown operation, missing required fields, SQL-special characters in fill values).

## 3. SQL Generation Pipeline (Backend)

- [ ] 3.1 Extend `Dataset._build_table()` with the three-stage pipeline: (1) MUTATE — apply enabled cleaning transforms sorted by `created_at` via Ibis `.mutate()`, (2) FILTER — apply enabled filter transforms via Ibis `.filter()` (existing, unchanged), (3) RENAME — apply enabled alias transforms via Ibis `.rename()`. See design D3.
- [ ] 3.2 Update `staging_sql` and `display_sql` properties to reflect cleaning expressions in the SELECT and aliases in column output.
- [ ] 3.3 Write unit tests for the extended pipeline: filter-only dataset produces identical SQL (regression), cleaning + filter composability (filter operates on cleaned values), multiple cleaning transforms on same column compose in created_at order, alias transforms rename output columns, disabled transforms excluded from all stages.

## 4. Preview Endpoint (Backend)

- [ ] 4.1 Add DuckDB preview query logic to the lake repository: given a Parquet path, target column, and operation config, return `{ affected_count, total_count, samples[] }`. Implement per-operation affected-row predicates (trim: `col != TRIM(col)`, case: `col != FN(col)`, fill_null: `col IS NULL OR col = ''`, map_values: `col IN (source_values)`). Limit samples to 5.
- [ ] 4.2 Add `preview_cleaning_transform` use case in `backend/app/use_cases/transform/` using `@with_repositories` + `@handle_returns`. Verify dataset access via parent project `org_id`. Resolve column type from Parquet schema. Return 422 for type mismatches (trim/case on numeric), 400 for invalid config, 400 for alias operations.
- [ ] 4.3 Add `POST /api/datasets/{dataset_id}/transforms/preview` route in `backend/app/routers/transforms.py`. Wire to the preview use case. Add request/response Pydantic schemas (`PreviewRequest`, `PreviewResponse`).
- [ ] 4.4 Write unit tests for preview: each operation type returns correct affected_count and samples, type mismatch returns 422, alias returns 400, nonexistent column returns 400, zero affected returns empty samples, auth/org scoping verified.

## 5. TableSchema & System Prompt (Shared)

- [ ] 5.1 Extend `TableSchema` interface in `shared/chat/types.ts`: add `alias?: string` to column entry, add `activeCleaningTransforms?: Array<{ id: string; column: string; operation: string; details?: string }>` to schema root.
- [ ] 5.2 Add 8 new tool definitions to `getToolDefinitions()` in `shared/chat/prompts.ts`: `trimWhitespace`, `standardizeCase`, `renameColumn`, `fillNulls`, `mapValues`, `applyCleaningTransform`, `undoCleaningTransform`, `reEnableCleaningTransform`. Use text-column-only enum for trim/case/mapValues, all-column enum for fillNulls/renameColumn.
- [ ] 5.3 Update `getSystemPrompt()` in `shared/chat/prompts.ts`: add ACTIVE CLEANING TRANSFORMS section after ACTIVE FILTERS, show column aliases in schema (e.g., `"Employee ID" (string, actual column: emp_id)`), add instructions 7–10 for cleaning operation rules.
- [ ] 5.4 Write tests for tool definitions: verify text-only tools exclude non-string columns from enum, verify all 8 tools are included, verify system prompt includes active cleaning transforms section when present and "No active cleaning transforms." when absent.

## 6. Frontend Tool Execution

- [ ] 6.1 Define `ToolCallContext` interface in `frontend/src/lib/table-tools/types.ts` extending existing `ToolCallHandlers` with `datasetId`, `transforms`, and `queryClient`. Refactor `executeToolCall` signature from `(toolCall, handlers)` to `(toolCall, context: ToolCallContext)`. Existing tools continue working via the same context properties.
- [ ] 6.2 Add `previewCleaningTransform(datasetId, config)` function to `frontend/src/lib/api/datasets.ts` — POST to `/api/datasets/{id}/transforms/preview`.
- [ ] 6.3 Implement preview tool handlers for `trimWhitespace`, `standardizeCase`, `fillNulls`, `mapValues` in `executeToolCall.ts`: call `previewCleaningTransform()`, format the response (affected_count + samples) as a string for the AI, do NOT create transforms.
- [ ] 6.4 Implement `renameColumn` handler: create alias transform(s) directly via `POST /api/datasets/{id}/transforms`, invalidate dataset query cache, return confirmation string.
- [ ] 6.5 Implement `applyCleaningTransform` handler: create cleaning/map transform via `POST /api/datasets/{id}/transforms`, invalidate dataset query cache, return confirmation string.
- [ ] 6.6 Implement `undoCleaningTransform` handler: find most recent cleaning transform from `context.transforms` when no `transformId` provided, call `PATCH` with `status: "disabled"` or `"deleted"`, invalidate cache. Implement `reEnableCleaningTransform` handler: find most recently disabled transform when no `transformId`, PATCH with `status: "enabled"`, invalidate cache.
- [ ] 6.7 Add `generateToolMessage` cases for all 8 new tools.

## 7. Frontend DatasetView Integration

- [ ] 7.1 Update `DatasetView/index.tsx` to build `activeCleaningTransforms` array from non-filter enabled transforms and pass it to `registerTableSchema()`. Include `alias` from active alias transforms in column schema entries.
- [ ] 7.2 Update `useTableConfig.ts` to apply column aliases as table headers when alias transforms are active.
- [ ] 7.3 Update the chat context provider to pass `ToolCallContext` (including `datasetId`, `transforms`, `queryClient`) to `executeToolCall`.

## 8. Testing

- [ ] 8.1 Backend integration tests: create each cleaning transform type end-to-end (API → DB → SQL generation), verify SQL output includes correct expressions.
- [ ] 8.2 Frontend unit tests: test all 8 tool handlers (preview tools return formatted data, apply creates transform, undo/re-enable update status, renameColumn creates immediately). Test `ToolCallContext` passes through correctly to existing tools.
- [ ] 8.3 Shared tests: verify TypeScript compilation with extended `TableSchema`, test tool definitions with mixed column types.
