# Shared Artifacts Registry — lakekeeper-catalog-backend

Every artifact passed between journey steps (and across the app ↔ catalog ↔ engine
boundary), with its **single** source of truth. The governing rule, inherited from
DISCOVER (`../discover/buy-vs-build.md`, ADR-026):

> **Persisted operations are the ONLY source of truth. Ibis is the only compiler.
> The catalog is downstream — a derived store — and is NEVER consulted at
> compile/render time. Materialized Iceberg tables are derived caches; Iceberg Views
> are export sinks only.**

| Artifact (`${...}`) | Single source of truth | Owner / writer | Derived? | Consumers | Notes |
|---|---|---|---|---|---|
| `${workos_token}` | WorkOS AuthKit (the org's IdP), already consumed by auth-proxy (`auth-proxy/lib/auth.ts:94-96`) | WorkOS; auth-proxy forwards the user token or mints an M2M token for backend→LakeKeeper calls | No | the org's LakeKeeper Server (authN) | Presented to LakeKeeper with `OPENID_PROVIDER_URI` = AuthKit issuer; LakeKeeper **auto-provisions** the user keyed `oidc~<sub\|oid>` — no user-sync job. |
| `${lakekeeper_project_id}` | the LakeKeeper Project created for a dc project via the Management API | the `LakeKeeperProjectRepository` adapter, behind `RepositoryContainer.projects` (ADR-020) | No | the project use cases (via the port); the Warehouse; the Iceberg table ref | Maps 1:1 to a dc `projects` row. **Whether it is authoritative or a mirror of the local row is the project-authority-model DESIGN open fork** (`../discover/buy-vs-build.md` Q2). |
| `${warehouse_prefix}` | the project's S3 prefix (`datasets/{project_id}/…` today; `config.py:27-33`) | the default Warehouse of the LakeKeeper Project | No | DuckDB (`ATTACH` + `CREATE SECRET`); the Iceberg table ref | One default Warehouse per Project; extra Warehouses for domain segregation deferred. |
| `${ibis_compiled_sql}` | **Ibis**, compiling the persisted operations (`transforms` IR; ADR-051/026) — the **only** compiler (`[K2]`) | the backend compile path (unchanged) | **Yes** | DuckDB (as the `SELECT` in the write); the determinism probe | **Always re-derived from operations; never hand-edited; never read back from the catalog.** This is the ADR-026 fence. |
| `${iceberg_table_ref}` | the Iceberg table registered in LakeKeeper (`Project.Warehouse.Namespace.table`) | LakeKeeper catalog | **Yes** | the reader (server-side DuckDB scan; stretch DuckDB-WASM); the data engineer | A **derived cache** materialized from `${ibis_compiled_sql}`; **rebuilt when operations change**. Replaces `schema_config` JSON-in-a-column (`models/dataset.py:94`) + `partition_fields` JSON (`:97`) with a real evolvable schema + partition spec. |
| `${snapshot_id}` | the Iceberg snapshot committed by the DuckDB `INSERT` | LakeKeeper catalog (Iceberg snapshot log) | **Yes** | operators (observable "it committed"); data/version history consumers | Gives **data/physical history for free** (Q-audit = BUY). The **design-intent** audit log (`assistant_audit_entries`) stays ours (keep-build) — a different kind of history. |
| `${determinism_probe_result}` | the ADR-026 determinism probe run (re-derive == materialized; compile passes with catalog offline) | the acceptance suite (DISTILL) / the materialization slice | **Yes** | the operator; the DoR/handoff gate | **PASS is the observable that discharges the ADR-026 anxiety.** Must pass with LakeKeeper **OFFLINE** (`adr-051...:283-289`). |

## Single-source check

- ✅ **SQL has exactly one compiler** — Ibis, from the persisted operations. The
  catalog never emits SQL; `${ibis_compiled_sql}` is never read back from
  `${iceberg_table_ref}`. (ADR-026 `[K1][K2]`.)
- ✅ **Identity has one source** — the WorkOS IdP. The catalog auto-provisions from
  the same `${workos_token}`; there is no second user list to sync.
- ✅ **The project mapping goes through one port** — `RepositoryContainer.projects`
  (ADR-020). The application layer never names LakeKeeper. (Authority *model* behind
  the port is the DESIGN fork — the *port* is single.)
- ✅ **The materialized table is a derived cache, not an authority** — its truth is
  `re-derive(operations)`, proven by `${determinism_probe_result}`.
- ✅ **Iceberg Views (if any) are export sinks only** — never a source Ibis reads back.

## Cross-boundary hand-offs

- **auth-proxy → LakeKeeper:** `${workos_token}` (forwarded user token, or a minted
  M2M token) authenticates the catalog against the same IdP.
- **backend (project use case) → LakeKeeper Management API:** via the
  `LakeKeeperProjectRepository` adapter behind the port; produces
  `${lakekeeper_project_id}` + `${warehouse_prefix}`.
- **backend (compile) → DuckDB → LakeKeeper:** `${ibis_compiled_sql}` is handed to
  DuckDB, which runs `INSERT INTO ${iceberg_table_ref} SELECT …` and commits
  `${snapshot_id}`. No dbt in the path.
- **LakeKeeper → reader:** `${iceberg_table_ref}` is scanned server-side (stretch:
  DuckDB-WASM in the browser over catalog OAuth + `httpfs`).

## What is deliberately NOT a shared artifact

- **A "stored SQL" / "stored view definition"** — forbidden by ADR-026. The catalog
  stores table *metadata + snapshots*, never the executable definition read back at
  render.
- **A second schema-of-record** — the operations IR (`transforms`; ADR-051) and, when
  it lands, `relation_*` (ADR-052) remain authoritative; the Iceberg table schema is
  derived from them, not beside them. Reconciling the Iceberg-sink export with ADR-052
  is a DESIGN open fork (`[K7]`).
