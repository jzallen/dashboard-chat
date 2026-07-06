# Outcome KPIs — lakekeeper-catalog-backend

**Wave:** DISCUSS · **Job:** JOB-005 · Hand-off to DEVOPS (tracking infrastructure) + DESIGN.

KPIs are framed as outcomes (JOB-005 under-served outcomes first), each with a numeric
target and a measurement method. Because this is a single-tenant, non-prod walking
skeleton of a scoped BUY, most targets are **invariant guarantees measured by the
acceptance suite** (the determinism probe, the empty-controller-diff, the no-dbt
inventory) plus a few before/after operational deltas. Baselines are the current
Parquet-on-S3 + `schema_config`-JSON + per-org pg_duckdb world (`../discover/`).

| KPI | JOB-005 outcome | Numeric target | Measurement method | Baseline (today) |
|---|---|---|---|---|
| **K1 — Determinism holds under materialization** | O4 | **100%** of runs: the determinism probe passes with LakeKeeper **offline** (`compile(ops) == compile(load_and_recompile(ops))`) **and** re-derive == materialized | Slice-04 acceptance probe run with the catalog disconnected, on every CI run of the suite | n/a (no materialized catalog today; the invariant is what makes the BUY admissible) |
| **K2 — One identity source (no user-sync)** | O1 | **0** user-sync jobs; **100%** of catalog users auto-provisioned from a WorkOS token | Slice-01 acceptance test: present a real WorkOS token, assert auto-provision; assert no sync job exists | 0 catalog users; identity is WorkOS via auth-proxy (`auth-proxy/lib/auth.ts:94-96`) |
| **K3 — Zero application-layer change for the seam** | O1 | **0** lines changed in routing, controllers, or project use-case logic (adapter-only) | Diff-scope check in Slice 02 + existing project use-case tests pass **unmodified** | project CRUD is ~6 endpoints over the local `projects` table (`routers/projects.py`) |
| **K4 — No new heavy runtime dependency (no dbt in the write path)** | O3 | **0** dbt process invocations in the materialization path; write runtime = DuckDB only | Slice-03 process/dependency inventory during a real materialization | dbt is eject-only (`export_dbt_project.py`); pg_duckdb is the serving engine |
| **K5 — Snapshot commit works end-to-end** | O2 | **100%** of skeleton materializations return a committed `${snapshot_id}`; p95 commit latency **recorded** (target set in DESIGN) | Slice-03 acceptance run; latency captured for the DEVOPS baseline (numeric SLO deferred to DESIGN) | n/a (no snapshots today; version history is a bare `transforms.version` int) |
| **K6 — Schema is evolvable, not JSON-in-a-column** | O2 | The materialized dataset's schema + partition spec are a **real Iceberg table schema**, replacing `schema_config` JSON for that dataset (1 dataset in the skeleton; target for the pattern, not a mass migration) | Inspect the Iceberg table schema/partition spec vs. the `schema_config` JSON it replaces (`models/dataset.py:94`) | `schema_config` + `partition_fields` JSON-in-a-column (`models/dataset.py:94-97`) |
| **K7 — Data engineer time-to-first-Iceberg-read** | O5 | A data engineer reads a materialized dataset via a standard catalog scan in **≤1 step** (a single DuckDB `ATTACH`+`SELECT`), no per-project schema/role provisioning | Slice-05 dogfood: measure the steps from "table exists" to "rows returned" server-side | multi-step per-project pg_duckdb provisioning (schema + reader role + view bootstrap) before any read (`enable_sql_access.py:71-114`) |
| **K8 — Per-org BI-provisioning steps on the consumption path** | O1 | The catalog read path requires **0** of the per-project schema/role/view provisioning steps that pg_duckdb requires (the catalog scan replaces them for the materialized surface) | Count provisioning steps on the catalog read path (Slice 05) vs. the pg_duckdb path | multi-step: engine-node resolve → health → password → schema → reader role → proxy role → view bootstrap → persist creds (`enable_sql_access.py:71-114`) |

## Leading indicators (track during DELIVER)

- Determinism-probe pass rate with LakeKeeper offline (target 100%; any failure blocks
  the slice — it means the integration violated ADR-026).
- Number of application-layer files touched by the LakeKeeper adapter (target 0 outside
  the adapter + wiring).
- dbt process count in the write path (target 0).
- Number of datasets materialized as Iceberg tables (skeleton: 1; the pattern's reach is
  a DESIGN/migration concern).

## Non-KPI guardrails (must-not-regress)

- **ADR-026 invariant:** no story or KPI may reward making the catalog a render-time
  authority. K1 is a hard gate, not a dial.
- **Iceberg Views stay export sinks** — never read back at render.
- **Ibis stays the only compiler** (`[K2]`); the catalog never emits SQL.
- **Multi-tenancy preserved:** one Server per org; no cross-org catalog access.
- **The design-intent audit log** (`assistant_audit_entries`) stays ours — Iceberg
  snapshots complement it (data history), they do not replace it (design rationale).

## Handoff note (DEVOPS + DESIGN)

Numeric SLOs that need a running system to set (K5 p95 commit latency; the reach of K6
across datasets; production provisioning-step reduction) are **baselined here and
finalized in DESIGN/DEVOPS** — the DISCUSS targets above are the invariants and the
walking-skeleton observables, not production SLOs. The three DESIGN open forks
(`wave-decisions.md` §Upstream Changes) will shape the production versions of K3, K7, K8.
