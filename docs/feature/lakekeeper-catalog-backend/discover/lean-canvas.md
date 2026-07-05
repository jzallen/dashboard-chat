# Lean Canvas (adapted, technical) — LakeKeeper as Catalog Backend (DC-139)

**Wave:** DISCOVER · **Status:** complete · **Date:** 2026-07-05

> Adapted for a brownfield architecture bet. "Customers" = internal engineering
> + external BI consumers. "Revenue/cost" = operational + maintenance cost. This
> canvas frames a **spike**, not a product launch.

---

## 1. Problem (top 3, ranked by evidence)

1. **BI-access provisioning is per-org/per-project heavy** — REAL. Admin-cred
   engine nodes + schema/role/view lifecycle + rotation + sync
   (`enable_sql_access.py:71-114`, `query_engine_provisioner.py:51-76`). `[C4]`
2. **No standard external catalog protocol** — REAL fact, but **no blocked
   client demonstrated** (0 iceberg/rest-catalog matches; Postgres-wire serves
   all BI tools today). `[C4]`
3. **Schema evolution / lineage not first-class** — SPECULATIVE; ADR-051/052
   already give reproducible, sequenced, queryable operation history.

## 2. Existing alternative (what we do today)

Postgres/SQLite metadata store (`[C1]`) as the authoritative catalog + per-org
pg_duckdb (`[C2][C3]`) as the query/BI engine, reading partitioned Parquet on
S3/MinIO. External BI = provisioned per-project schema + read-only role over
Postgres wire (`[C4]`). SQL always re-derived by ibis (ADR-026/007). **This
works today** and is ratified across ADR-003/007/026/051/052.

## 3. Proposed solution (the bet under test)

Introduce Apache LakeKeeper (Iceberg REST catalog + management core) as a
catalog authority behind the backend, disaggregating catalog metadata from query
execution. **Constrained by ADR-026** to an import-time-source / export-sink
role only (see `solution-testing.md` Q1/Q2/Q4).

## 4. Key metrics for a SPIKE (what the spike must prove)

A spike is worthwhile **only if it can answer YES to a trigger and pass two
gates**:

- **Trigger (must exist before spiking):** a *named, concrete* external client
  or requirement that needs an Iceberg REST catalog and that Postgres-wire
  **cannot serve at all** — i.e. the client cannot connect over standard
  Postgres TCP/IP, not merely that it would *prefer* an Iceberg endpoint. A
  client that can fall back to Postgres-wire does not meet the bar. Absent this,
  do not spike.
- **Gate G-A (ADR-026):** a determinism probe passes with LakeKeeper **offline**
  — `compile(ops) == compile(load_and_recompile(ops))` with the catalog
  disconnected (`adr-051...:283-289`). If it can't, STOP — the integration is
  non-compliant.
- **Gate G-B (net surface):** a credible design shows per-tenant provisioning
  surface *reduced*, not increased (Q6/Q7). If LakeKeeper is strictly additive,
  the spike has disproven its own thesis.
- Secondary: measured operational cost of the LakeKeeper service (deploy,
  backup, secure) vs. the provisioning steps it removes (Q7 — currently: removes
  none).

## 5. Unfair advantage / risks

**Advantage (if any):** aligns with a widely-adopted open standard (Iceberg REST)
should an ecosystem client requirement ever appear; our stack (Postgres + DuckDB)
matches LakeKeeper's.

**Risks (dominant):**
- **R1 — ADR-026 violation (structural).** LakeKeeper's core value is a live
  queryable catalog; that mode is forbidden (Q1/Q2/Q4). HIGH.
- **R2 — dual-authority identity/tenancy.** Overlap with our orgs/projects +
  auth-proxy; permanent sync burden (Q6). HIGH.
- **R3 — storage-format migration.** Iceberg tables imply Parquet→Iceberg
  expand/contract, a proposal *non-goal* yet a precondition for value (Q5). MED-HIGH.
- **R4 — timing conflict with `[P2]`/ADR-052.** Designing a catalog schema
  authority against an unbuilt, moving View/Report IR (Q3). MED.
- **R5 — value unproven.** Serves mostly speculative opportunities (O2/O3). HIGH.

## 6. Cost structure (operational, primary)

**Strictly additive** on current evidence (Q7):
- + LakeKeeper always-on service: deploy, monitor, back up its catalog DB,
  secure its REST API (contra ADR-026/051/052's ratified "no new runtime
  dependency" bias — `adr-026...:296`, `adr-051...:248`, `adr-052...:245`).
- + operations→Iceberg export sync loop.
- + identity/tenancy mirror + mapping layer (Q6).
- + second schema authority reconciliation (Q3).
- − **nothing removed**: pg_duckdb, engine nodes, per-project provisioning, and
  the ibis→DuckDB query path all remain (Q4).

**Spike cost (bounded):** a throwaway, flag-gated, non-prod probe answering
G-A/G-B only — days, not a release. No migration, no production service, no
identity re-platforming.

---

## Canvas verdict

The canvas does not support a build. One real problem (BI provisioning weight)
is a poor fit for this solution; the solution's headline value is either
ADR-026-forbidden or unvalidated; the cost is strictly additive. **A spike is
justified only behind a concrete Iceberg-client trigger; otherwise decline.**
See `wave-decisions.md` for the recommendation.
