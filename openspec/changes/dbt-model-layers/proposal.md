## Why

The platform currently exports only two dbt layers (source + staging). Users cannot build derived models that join, aggregate, or reshape data — blocking the intermediate and mart layers that a complete analytics pipeline requires. Adding these two layers with constrained SQL operation sets completes the four-layer dbt export and positions the platform for MetricFlow integration.

## What Changes

- Introduce **Views** as the intermediate layer (`int_` prefix in dbt export): supports JOIN, UNION, WINDOW operations; blocked from aggregations
- Introduce **Reports** as the mart layer (`fct_`/`dim_` prefix): supports GROUP BY, aggregations, semantic column metadata (dimension/measure/entity) for MetricFlow readiness
- Each layer enforces its SQL operation constraints via the existing `layer-sql-guardrails` spec
- Chat-driven SQL generation is aware of which layer it is generating for and constrains tool outputs accordingly
- dbt-specific prefixes and terminology are used only in the export artifact, not in the platform UI

## Capabilities

### New Capabilities

None — capabilities already exist as specs.

### Modified Capabilities
- `view-intermediate-layer`: Add full specification for JOIN/UNION/WINDOW operation set and guardrail rules
- `report-mart-layer`: Add full specification for aggregation operation set and semantic column metadata (dimension/measure/entity)
- `dbt-export-views`: Update to emit `int_` prefixed models using view SQL
- `dbt-project-generation`: Update manifest to include intermediate and mart model references
- `report-column-metadata`: Finalize dimension/measure/entity annotation spec for MetricFlow readiness
- `layer-sql-guardrails`: Update to cover intermediate and mart constraint rules

## Impact

- `backend/app/use_cases/project/export_dbt_project.py` — emit intermediate and mart models
- `backend/app/use_cases/project/_dbt/` — template additions for `int_` and `fct_`/`dim_` models
- `backend/app/routers/` — no new routes; export endpoint already accepts a project
- `shared/chat/` — prompt additions for intermediate and mart SQL generation modes
- Frontend: layer selector UI in dataset/view creation flow
