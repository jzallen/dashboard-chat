# Product Vision

Dashboard Chat is a **chat-first prototyping tool** for data models and dashboards. Users go from raw files (or synthetic data) to a working prototype — then hand off dbt projects to data engineers and renderable dashboard code to software engineers.

It's built for people who have domain expertise and maybe know some SQL, but don't want to manage data infrastructure just to explore an idea.

## The Prototyping Workflow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   1. UPLOAD  │    │  2. MODEL    │    │  3. PREVIEW  │    │  4. HANDOFF  │
│              │───►│              │───►│              │───►│              │
│  CSV, Excel, │    │ Clean, join, │    │ Live dashboard│    │ dbt project  │
│  Synthea,    │    │ filter, view │    │ preview with  │    │ + renderable │
│  FHIR        │    │ via chat     │    │ hot reload    │    │ dashboard    │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       ▲                   ▲                   ▲                   ▲
    COMPLETE            COMPLETE            PLANNED             COMPLETE
                    (reports in progress)                    (dbt export +
                                                             SQL access)
```

### Stage 1: Upload

Users upload structured files through the UI. The system auto-detects format, converts to Parquet, stores in S3, and generates previews with column profiles. Multi-sheet Excel files prompt for sheet selection.

**Supported formats:** CSV, Excel (.xlsx/.xls), JSON, Parquet, FHIR bundles

**For healthcare prototyping:** Generate synthetic patient data via Synthea (patients, encounters, observations, conditions) and upload the output directly. No real patient data needed — prototype your data model against realistic synthetic populations before committing to production infrastructure.

Mirth Connect integration is available for organizations that want to test with HL7v2 message formats (optional `healthcare` Docker Compose profile).

### Stage 2: Model with Natural Language

With a dataset loaded, users interact entirely through chat:

- **Clean** — trim whitespace, standardize casing, fill nulls, map values
- **Filter** — any column with operators (equals, contains, gt, lt, between, etc.)
- **Transform** — rename columns, sort, add/delete rows
- **Build views** — join multiple datasets, add filters, set grain and materialization
- **Build reports** — define dimensions, measures, and aggregations *(agent tools in progress — backend ready)*

Every operation is captured as a reproducible transform in the 3-stage Ibis pipeline (MUTATE → FILTER → RENAME). Nothing is destructive — transforms can be disabled and re-enabled. The user is sketching a data model, not committing to one.

### Stage 3: Preview (planned)

The **layout planner** generates dashboard layouts from natural language prompts. It uses a multi-agent LangGraph pipeline powered by Anthropic Claude to produce renderable Vizro dashboard code.

**Two interaction modes in the preview tab:**

1. **Layout changes via chat (hot reload)** — User describes what they want ("add a readmission trend by department"). The planner generates updated Vizro code and the preview tab hot-reloads with the new layout. This is seconds, not minutes.

2. **Dashboard interaction (local-first)** — The preview dashboard is interactive, not static. Users click filters, drill down, adjust time ranges, and explore the data to get a feel for whether the model works. These interactions execute against a **DuckDB WASM** instance running in the browser — the backend loads a pre-aggregated extract once (shaped by the dashboard's MetricFlow data contract), and all subsequent queries run locally with sub-10ms latency. No round-trips.

**The prototyping loop:**
```
Chat: "show me readmission rates by department"
  → Planner generates layout → hot reload (seconds)
    → User clicks "Cardiology" filter in preview → instant drill-down (milliseconds)
      → Chat: "add a 30-day rolling trend"
        → Planner updates layout → hot reload (seconds)
          → User explores the trend → instant interaction (milliseconds)
            → Looks right → hand off
```

This is normal UX testing workflow. The user isn't just visually reviewing a static render — they're interacting with the dashboard to validate that the data model supports the questions they care about. The combination of chat-driven layout changes and instant local interaction is what makes prototyping fast enough to be useful.

### Stage 4: Handoff

The prototype produces two handoff artifacts for engineering teams:

**For data engineers — dbt project:**
- Export the entire project as a 4-layer dbt archive (sources → staging → intermediate → marts)
- Includes YAML schemas, macros, model SQL, and `profiles.yml`
- Plugs directly into existing dbt workflows — `dbt run` works out of the box
- Data engineers take the model and build it against real data in their production warehouse

**For software engineers — renderable dashboard code:**
- The Vizro plan is renderable Python code, not a screenshot or wireframe
- Engineers can take the generated dashboard, connect it to real data sources, and deploy
- The prototype communicates intent precisely because it's a working artifact, not a mockup

**For immediate exploration — SQL access:**
- Enable SQL access on a project to provision a pg_duckdb schema with foreign tables
- Any SQL client, BI tool, or ODBC driver connects via standard PostgreSQL wire protocol
- Useful for validating the data model before handoff ("does this join actually make sense?")

## Target Users

**Primary:** Product owners, data professionals, and domain experts who want to prototype data models and dashboards without managing infrastructure. They may know SQL and are comfortable in Excel — they don't need the platform to replace their skills, they need it to eliminate the infrastructure between their idea and a working prototype.

**The handoff model:** Users are not the ones who build the production system. They prototype, then hand off:
- dbt projects → data engineers
- Dashboard code → software engineers
- SQL access → analysts who want to validate the model

**Healthcare vertical:** Healthcare POs and analysts prototyping clinical data models against synthetic data (Synthea). The workflow is: generate synthetic patient populations → upload → model with natural language → prototype dashboards → hand the dbt project to the data engineering team who builds it against real EHR data. This sidesteps HIPAA concerns entirely — synthetic data isn't PHI.

## What Makes This Different

1. **Prototyping, not production** — The output is a handoff artifact (dbt project + dashboard code), not a hosted analytics platform. Users sketch ideas; engineers build the real thing.
2. **Chat-native** — Every operation from cleaning to dashboard design happens through natural language. The LLM sees the actual schema and produces structured tool calls, not generated SQL.
3. **Non-destructive exploration** — All operations are reversible. Raw Parquet is never modified. Users can try things without consequence.
4. **Live preview with hot reload** — Dashboard changes render immediately in a preview tab. The feedback loop is seconds, not sprint cycles.
5. **Standard handoff formats** — dbt projects and renderable Vizro code, not proprietary exports. Engineers receive artifacts they already know how to work with.
6. **Synthetic-first for healthcare** — Prototype against Synthea data, hand off to engineers who connect real EHR data. No PHI in the prototyping environment.
