# Problem Validation — LakeKeeper as Catalog Backend (DC-139)

**Wave:** DISCOVER · **Status:** complete · **Date:** 2026-07-05

> **Framing.** This is brownfield technical/architecture discovery. There are no
> external customers. The "customer" is the internal engineering system, and its
> "needs" are the invariants and constraints already ratified in code and ADRs.
> Mom-Test rigor is applied by grounding every claim in `file:line` / ADR
> evidence, not vendor promise. A pain is **REAL** only if code demonstrates it;
> a benefit is **SPECULATIVE** if it rests on a vendor claim not yet demonstrated
> against our constraints. Past behavior (what the code does today) outranks
> future intent (what LakeKeeper might let us do).

---

## The three pains the proposal names

The DC-139 body asserts three problems LakeKeeper would address. Each is
validated or invalidated against code below.

### Pain 1 — "pg_duckdb fuses metadata + query concerns in one engine"

**Claim (proposal):** pg_duckdb couples catalog metadata and query execution;
LakeKeeper would disaggregate them (Postgres for catalog, DuckDB for query).

**Evidence — the fusion claim is only partly true, and the untrue part is the
load-bearing part.**

- Catalog metadata does **not** live in pg_duckdb today. It lives in the app's
  own relational store (SQLite dev / Postgres prod) via SQLAlchemy ORM:
  `organizations`, `projects`, `datasets`, `transforms`, `views`, `reports`,
  `external_access` — `backend/migrations/versions/001_initial_schema.py`,
  `005_add_views_table.py`, `006_add_reports_table.py`; repositories in
  `backend/app/repositories/metadata/`. **[C1]**
- pg_duckdb is used **only** as the per-org query/BI-access engine, provisioned
  per project as a schema + read-only role:
  `query_engine_provisioner.py:51-65` (`create_project_access`),
  `enable_sql_access.py:78-91` (bootstrap views). **[C2][C4]**
- The pg_duckdb node record (`query_engine_nodes`,
  `008_add_query_engine_nodes.py:34-50`) stores host/port/admin creds — it is a
  **query-engine registry**, not a metadata catalog.

**Finding: PARTIALLY REAL, MOSTLY MISATTRIBUTED.** The genuine coupling inside
pg_duckdb is that a single Postgres-wire engine both *catalogs the BI-exposed
views* (schema + view DDL, `sql_access_service.py:36-48`) and *executes* queries
over them. That is a narrow BI-surface coupling, not an app-wide
"metadata+query" fusion. The app's authoritative catalog is already a separate
store from the query engine. **The headline "disaggregate catalog from query"
is largely already true in our architecture** — the DuckDB engine is a
*materialization/serving* surface, and the operations IR (`transforms`, `views`,
`reports`) is the catalog. LakeKeeper would not be splitting a fused monolith;
it would be inserting a *third* metadata authority beside the one we already
have.

### Pain 2 — "the external-BI story is per-org provisioning-heavy"

**Claim (proposal):** the SQL-access feature is heavy because it provisions a
project-scoped schema + role per project in each org's pg_duckdb.

**Evidence — REAL and code-demonstrated.**

- Enabling BI access performs a multi-step provisioning dance per project:
  resolve org engine node → health check → generate password → create schema +
  internal reader role + proxy role → bootstrap view DDL → persist creds.
  `enable_sql_access.py:71-114`, `query_engine_provisioner.py:51-76`.
- Each org needs a registered engine node with admin credentials
  (`008_add_query_engine_nodes.py:37-50`); selection is per-org
  (`resolve_engine_node_for_org`, `enable_sql_access.py:71`).
- Views must be re-synced when datasets change
  (`/sql-access/sync`, `sql_access.py:46-53`).

**Finding: REAL.** There is genuine per-org, per-project operational surface:
admin-credentialed engine nodes, schema/role lifecycle, credential rotation
(`sql_access.py:56-66`), and view sync. This is a legitimate complexity pain.

**BUT — the pain is not evidence that *LakeKeeper* is the remedy.** The pain is
"provisioning schemas+roles+views per project on a stateful per-org engine."
LakeKeeper replaces the *catalog protocol* (how a client discovers tables), not
the *tenancy/access provisioning* (which org, which project, which reader can
see which rows). Whichever way tables are cataloged, per-project access control
and per-tenant isolation still have to be provisioned. LakeKeeper offers its own
Projects/Roles/Warehouses (see ownership-overlap, `solution-testing.md` Q6) —
which is *additional* provisioning surface to reconcile, not a subtraction.

### Pain 3 — "no standard catalog protocol"

**Claim (proposal):** there is no Iceberg REST catalog / standard external-access
protocol; BI access is Postgres-wire only.

**Evidence — REAL as a factual statement.**

- `grep -ri "lakekeeper|iceberg|rest catalog"` across the repo → **0 matches**
  (verified this pass). No Iceberg, no REST catalog, no Power Query/OData
  connector exists anywhere.
- External access is exclusively Postgres wire protocol: BI tools connect as
  ordinary Postgres clients to the provisioned schema/role
  (`enable_sql_access.py:78-91`, `build_connection_response`
  referenced at `enable_sql_access.py:116-122`). **[C4]**

**Finding: REAL (fact), SPECULATIVE (benefit).** It is a true fact that no
standard catalog protocol exists. Whether that *absence is a problem* is
**unvalidated** — there is no evidence in the codebase or brief of a customer,
BI tool, or integration that is blocked by the lack of an Iceberg REST catalog.
Postgres-wire is itself a widely-supported standard that every BI tool speaks.
"We lack protocol X" is only a problem if something needs protocol X. No such
need is demonstrated. This is a **solution in search of a problem** until a
concrete Iceberg-consuming client requirement appears.

---

## Speculative benefits (vendor promises, not yet grounded)

Flagged explicitly so they are not mistaken for validated pains:

| Proposal claim | Status | Why |
|---|---|---|
| "Iceberg REST catalog makes schema evolution easier" | SPECULATIVE | Our schema evolution today is operations-as-data (`transforms`, ADR-051); no demonstrated pain with schema versioning that Iceberg snapshots would fix. |
| "Management entities (Projects/Roles/Warehouses) could be adopted rather than reinvented" | SPECULATIVE + RISK | These *overlap and contend with* orgs/projects + auth-proxy identity (ownership-overlap Q6). Adoption is a re-platforming of identity, not a free extension. |
| "DuckDB-WASM opens a client-side preview path" | SPECULATIVE + ORTHOGONAL | DuckDB-WASM needs no LakeKeeper; it can read Parquet/Iceberg directly. This benefit does not require adopting LakeKeeper as catalog backend. |
| "Postgres-catalog / DuckDB-query split simplifies BI" | INVALIDATED as stated | The split largely already exists (Pain 1); LakeKeeper adds a metadata authority, not removes one. |

---

## The invariant that dominates the assessment

**ADR-026 (Accepted, hard invariant):** operations are the source of truth; all
customer-visible SQL is *always re-derived* by ibis; nothing downstream is read
back as authority (`adr-026...:73-95`, `230-242`). ADR-051 restates it as "the
hard invariant" (`adr-051...:60-71`) and ADR-052 inherits it verbatim
(`adr-052...:68-71`).

Any catalog whose *reflected schema/state* is read back during rendering
violates ADR-026. LakeKeeper's core value proposition — a live, evolving,
queryable catalog of table/schema/partition state — is precisely a
read-back-authority surface. **The proposal itself acknowledges this**
(open question 1: "`[A26]` forbids reading catalog state back during
rendering"). This is not a peripheral risk; it is the central architectural
tension. See `solution-testing.md` Q1/Q2 for the source-vs-sink resolution that
keeps LakeKeeper compliant (import-time-only), and note that compliance forces
LakeKeeper into a narrow role that erodes most of its claimed benefit.

---

## Problem-validation verdict

| Pain | Grounded? | Load-bearing for LakeKeeper? |
|---|---|---|
| P1 metadata+query fusion | Partially real, mostly misattributed | No — split already largely exists |
| P2 per-org BI provisioning heavy | **Real** | Weak — LakeKeeper doesn't remove tenancy provisioning |
| P3 no standard catalog protocol | Real fact, unvalidated as a problem | No — no blocked client demonstrated |

**There is one real, code-demonstrated pain (P2: BI-access provisioning
weight).** It is genuine but LakeKeeper is a poor fit for it — it addresses the
catalog-protocol axis, not the tenancy-provisioning axis. The two headline
justifications for LakeKeeper specifically (P1 disaggregation, P3 protocol) are
either already satisfied or unvalidated. Against this sits ADR-026's hard
determinism invariant, which constrains LakeKeeper to an import-time-only role
that strips most of its value.

**This does not clear the bar for ADOPT.** It clears the bar for a **bounded,
time-boxed SPIKE** only if a concrete Iceberg-consuming requirement materializes
— otherwise **DECLINE**. See `lean-canvas.md` and `wave-decisions.md` for the
recommendation and its trade-offs.
