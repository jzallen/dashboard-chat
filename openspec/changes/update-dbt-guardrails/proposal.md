## Why

The dbt layer guardrails were implemented with basic operation allowlists but do not reflect the full set of official dbt best practices from [docs.getdbt.com/best-practices/how-we-structure](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview). Key gaps include: no project-level materialization defaults in `dbt_project.yml`, incorrect Report default materialization ("view" instead of "table"), missing best-practice guidance in chat prompts (entity-grain, complexity limits, Golden Rule of materializations), and intermediate models omitted from `schema.yml`. Aligning with the official guide ensures exported dbt projects follow industry-standard structure and that the AI assistant gives guidance consistent with how practitioners actually build dbt projects.

## What Changes

- **Add materialization defaults to `dbt_project.yml`** — Generated projects will include `+materialized: view` for staging, `+materialized: ephemeral` for intermediate, and `+materialized: table` for marts. This is the idiomatic dbt approach: set layer defaults at the project level, override per-model only when needed.
- **Change Report default materialization from "view" to "table"** — Per dbt best practices, marts should default to table materialization since they are end-user-facing and frequently queried. Existing reports are unaffected (materialization is persisted per-row).
- **Enrich chat prompt guardrails with best-practice guidance** — Dataset prompts add 1-to-1 source mapping rule and DRY principle. Intermediate prompts add ephemeral purpose framing, complexity simplification guidance (4-6 entities), and naming conventions. Report prompts add entity-grain guidance, table default, complexity limit (4+ joins should use intermediates), and the Golden Rule of materializations (view -> table -> incremental).
- **Add intermediate models to `schema.yml`** — Views will appear in `schema.yml` with `int_` prefix and column definitions, enabling dbt documentation and testing.
- **Update `layer-sql-guardrails` spec** — Formal requirements updated to reflect all new best-practice guidance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `layer-sql-guardrails`: Add materialization guidance, entity-grain rules, complexity limits, and Golden Rule to per-layer AI prompt requirements. Add scenario for AI advising against overly complex marts.
- `dbt-project-generation`: Add requirement for `models` section in `dbt_project.yml` with per-layer `+materialized` defaults. Add requirement for intermediate models in `schema.yml`.
- `report-mart-layer`: Update default materialization from "view" to "table" in domain model, ORM record, and API schema.

## Impact

### Backend
- **`backend/app/use_cases/project/_dbt/project_yml.py`** — Add `models` section with layer materialization defaults
- **`backend/app/use_cases/project/_dbt/schema_yml.py`** — Accept views parameter, generate `int_` model entries
- **`backend/app/use_cases/project/_dbt/__init__.py`** — Pass view_pairs to `generate_schema_yml`
- **`backend/app/models/report.py`** — Change default materialization from "view" to "table"
- **`backend/app/repositories/metadata/report_record.py`** — Change column default from "view" to "table"
- **`backend/app/routers/schemas/report.py`** — Change Pydantic default from "view" to "table"
- **`backend/migrations/versions/`** — New migration to update `server_default` on reports.materialization column

### Agent
- **`agent/lib/chat/prompts.ts`** — Update `getLayerSection()` with enriched best-practice guidance for all three layers

### Specs
- **`openspec/specs/layer-sql-guardrails/spec.md`** — Add materialization, entity-grain, complexity, and Golden Rule requirements

### Frontend
- No changes required. Frontend already supports all materialization values in the type union.

### Infrastructure
- No new services or dependencies.
