# Product Vision

Dashboard Chat is a **chat-first data platform** that takes users from raw files to production-ready analytics in three stages — each accessible via natural language.

## The End-to-End Journey

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   1. UPLOAD  │    │  2. MODEL    │    │  3. ACCESS   │    │  4. VISUALIZE│
│              │───►│              │───►│              │───►│              │
│  CSV, Excel, │    │ Clean, join, │    │ dbt export + │    │ Auto-generate│
│  JSON, HL7v2 │    │ filter, view │    │ SQL/ODBC     │    │ dashboards   │
│              │    │ via chat     │    │ via pg_duckdb │    │ via chat     │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       ▲                   ▲                   ▲                   ▲
    COMPLETE            COMPLETE            COMPLETE            PLANNED
```

### Stage 1: Upload (complete)

Users upload structured files (CSV, Excel, JSON, Parquet) through the UI. The system auto-detects format, converts to Parquet, stores in S3, and generates previews with column profiles. Multi-sheet Excel files prompt for sheet selection.

Healthcare users can ingest HL7v2 messages via Mirth Connect for FHIR conversion.

### Stage 2: Model with Natural Language (complete)

With a dataset loaded, users interact entirely through chat:

- **Clean** — trim whitespace, standardize casing, fill nulls, map values
- **Filter** — any column with operators (equals, contains, gt, lt, between, etc.)
- **Transform** — rename columns, sort, add/delete rows
- **Build views** — join multiple datasets, add filters, set grain and materialization
- **Build reports** — define dimensions, measures, and aggregations *(agent tools not yet wired — backend ready)*

Every operation is captured as a reproducible transform in the 3-stage Ibis pipeline (MUTATE → FILTER → RENAME). Nothing is destructive — transforms can be disabled and re-enabled.

### Stage 3: Access (complete)

The modeled data becomes accessible two ways:

1. **dbt export** — Export the entire project as a 4-layer dbt archive (sources → staging → intermediate → marts) with YAML schemas, macros, and model SQL. This plugs directly into existing dbt workflows and BI pipelines.

2. **External SQL access** — Enable SQL access on a project to provision a dedicated pg_duckdb schema with foreign tables reading directly from Parquet in S3. Any SQL client, BI tool, or ODBC driver can connect via standard PostgreSQL wire protocol. PgBouncer handles connection pooling.

The combination means users go from "I have a CSV" to "my BI tool is querying a governed, version-controlled data model" without writing SQL or managing infrastructure.

### Stage 4: Visualize (planned)

The **layout planner** service (`planner/`) generates Vizro dashboard layouts from natural language prompts. It uses a multi-agent LangGraph pipeline (planner → section → filter → assembler → validation) powered by Anthropic Claude to produce chart configurations from a semantic data manifest.

Currently standalone — the integration path is:
1. User builds views and reports through chat (Stage 2)
2. Views/reports produce a manifest describing available dimensions and measures
3. User describes the dashboard they want in natural language
4. Planner generates a Vizro dashboard plan and renders it

This stage bridges the gap from "data is modeled" to "data is visualized" without requiring users to learn a BI tool.

## Target Users

**Primary:** Data analysts and business users who need to wrangle, model, and share tabular data but don't write SQL.

**Vertical focus:** Healthcare — HL7v2/FHIR ingestion, Mirth Connect integration, and clinical data modeling workflows.

## What Makes This Different

1. **Chat-native** — Every operation from cleaning to view modeling happens through natural language. The LLM sees the actual schema and produces structured tool calls, not generated SQL.
2. **Non-destructive transforms** — All operations are reversible. The raw Parquet is never modified.
3. **dbt as the output format** — Models export as standard dbt projects, not a proprietary format. Users aren't locked in.
4. **SQL access without ETL** — pg_duckdb reads Parquet directly from S3. No data copying, no sync jobs, no stale caches.
