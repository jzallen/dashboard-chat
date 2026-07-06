# JTBD Job Stories — lakekeeper-catalog-backend

**Wave:** DISCUSS · **Mode:** light JTBD bridge (no DIVERGE) · **Area:** backend (repository seam) + infrastructure/operator aspect

This is a *bridge*, not a full ODI study. The opportunity was already validated in
the DISCOVER wave (`../discover/`): opportunity **O1** (reduce per-org/per-project BI
provisioning surface) is REAL and code-demonstrated (`../discover/opportunity-tree.md`
O1; `../discover/problem-validation.md` P2). The corrected DISCOVER finding
(`../discover/buy-vs-build.md`) reframes the whole question as a **buy-vs-build
across four planes** rather than "does LakeKeeper fit our internals". This file
formalizes that reframed job into job-story form, names its three dimensions, runs a
light four-forces, and records the SSOT job it lands as (**JOB-005** in
`docs/product/jobs.yaml`). A full DIVERGE Phase-1 study (real-user interviews,
measured satisfaction) was not run because the opportunity is already validated and
the design decision is a scoped buy-vs-build across ratified planes, not a contested
product opportunity. Scoring is provisional and **DISCUSS-derived** (flagged as such
on JOB-005).

> **Framing inherited from DISCOVER (authoritative: `../discover/buy-vs-build.md`).**
> The DISCOVER wave separates four planes and lands on a **scoped BUY** of the
> catalog/management/audit plane while **keeping Ibis on the compile plane**
> (ADR-026 hard invariant). The original DISCOVER recommendation (DECLINE) is
> **explicitly superseded** by `buy-vs-build.md` (see the ⚠️ banner atop
> `../discover/wave-decisions.md`); its Constraints [K1]–[K7] remain useful, its
> recommendation does not. This job story builds on the scoped-BUY conclusion.

---

## Primary job (JOB-005)

> **When** I run a per-org data stack and need a data engineer to consume our
> chat-authored datasets in their own tools — **I want** each org's catalog,
> physical table schema, storage credentials, and data-version history to be carried
> by a standard Iceberg REST catalog (LakeKeeper) that materializes tables from our
> Ibis-compiled SQL, **so I can** hand a data engineer real, evolvable Iceberg tables
> in a protocol their tools already speak — **without** hand-rolling `schema_config`
> JSON, without standing up a bespoke per-org BI-provisioning dance, and **without
> ever** letting the catalog become a render-time authority that would break the
> operations-as-data determinism invariant.

### Three dimensions

| Dimension | Content |
|---|---|
| **Functional** | Stand up one org's Iceberg REST catalog authenticated against the same WorkOS IdP; represent a dc project as a LakeKeeper Project with a default Warehouse (the project's S3 prefix); replace hand-rolled `schema_config` JSON-in-a-column (`backend/app/models/dataset.py:94`) with a real Iceberg table schema + partition spec; materialize a dataset by running `INSERT INTO <iceberg_table> SELECT <ibis-compiled-sql>` from DuckDB (no dbt runtime); let a reader query the materialized table via the catalog; guarantee the materialized table is a *derived cache* that is always re-derivable from the persisted operations. |
| **Emotional** | Confidence that the determinism invariant is intact — that materializing a table did **not** quietly turn the catalog into a source of truth. The operator wants to *prove* (a probe passes with LakeKeeper offline; the re-derived table equals the materialized one) rather than *hope*. And relief at not carrying a second identity/tenancy authority that must be kept in sync by hand. |
| **Social** | The catalog should *read* to a data-engineer peer like the Iceberg lakehouse they already live in — a standard REST catalog, evolvable table schemas, snapshot history for free — not a proprietary Parquet-on-S3 layout plus a hand-rolled `schema_config` blob and a dbt-zip export. Buying the catalog plane makes our handoff *more* credible to a data engineer, not less. |

---

## The anchor (carry through every artifact)

The backend is **already hexagonal**: use cases receive per-aggregate ports via
`RepositoryContainer` (ADR-020) and `@with_repositories` injects the adapters
(`create_project.py` never names a concrete store — `../discover/buy-vs-build.md`
Q2 "Delegation shape"). LakeKeeper integrates as a **repository adapter behind the
port the project use cases already depend on** — a `LakeKeeperProjectRepository`
implementing the same port slots in with **zero change to routing, controllers, or
use-case logic**. This is the same pattern the codebase already uses to hide
Parquet-on-S3 (`backend/app/repositories/lake/`). The seam is not a new abstraction
to design — it is an existing one to implement an adapter for. **The authority model
that adapter encodes (dual-write mirror vs. LakeKeeper-as-SoT) is an OPEN FORK for
DESIGN — this DISCUSS wave surfaces it, does not decide it.**

---

## The one load-bearing rule (bake into every acceptance criterion)

**The ADR-026 materialization corollary** (`../discover/buy-vs-build.md` Q-dbt
"ADR-026 boundary"): materializing an Iceberg *table* is **not** what ADR-026
forbids (that is storing the *definition* and reading it back). A materialized
Iceberg table is **derived data** — a cache/build output — provided:

1. the SQL is **always regenerated from operations via Ibis**, never hand-edited or
   read back, and
2. the table is **rebuilt when operations change** — it is never the authority for
   *what a transform is*.

Iceberg **Views** remain export **sinks** only — never read back at render. Every
story's acceptance criteria must assert this corollary: **re-derive == materialized**,
and the determinism probe must **pass with LakeKeeper offline**.

---

## Sub-jobs (the job decomposed — these become the journey steps and stories)

| # | Sub-job (job-story form) | Feeds story | Plane (from buy-vs-build) |
|---|---|---|---|
| SJ-1 | When I provision an org's data stack, I want the org's Iceberg catalog to authenticate against the same WorkOS IdP we already use, so a WorkOS token that works for the app also works for the catalog and users auto-provision — no second identity store to sync. | US-1 | Auth (proven OIDC path; authZ boundary is the open unknown) |
| SJ-2 | When I create a dc project, I want it represented as a LakeKeeper Project with a default Warehouse at the project's S3 prefix — behind the existing project repository port — so the application layer is untouched and the project's storage location is a first-class catalog object, not a hand-rolled path. | US-2 | Management + Catalog/storage |
| SJ-3 | When a dataset's staging operations are settled, I want to materialize it as an Iceberg table by running the Ibis-compiled SQL through DuckDB directly into the catalog (`INSERT INTO … SELECT`, no dbt), so a committed snapshot exists that a data engineer can read — while the operations stay the only source of truth. | US-3 | Execution/materialization + Catalog/storage |
| SJ-4 | When a materialized Iceberg table exists, I want to *prove* it is a derived cache — a reader queries it, and re-deriving from the operations reproduces it byte-for-byte-equivalent — with the determinism probe passing while the catalog is offline, so I know materialization did not turn the catalog into a render-time authority. | US-4 | Compile plane invariant (ADR-026 corollary) |
| SJ-5 | When a data engineer (or a browser preview) wants the data, I want a reader to query the materialized Iceberg table straight from the catalog (server-side DuckDB scan; stretch: DuckDB-WASM in the browser), so the handoff is a live standard catalog rather than a dbt-zip — retiring per-org pg_duckdb provisioning as the consumption surface. | US-5 | Catalog / handoff / client-side |

Every story in `user-stories.md` traces to exactly one sub-job; every sub-job traces
to a plane in `../discover/buy-vs-build.md` with `file:line`/ADR evidence. Standing
up the LakeKeeper container itself is `@infrastructure` (folded into US-1's slice, not
a slice of its own — see `story-map.md`).

---

## Light four-forces (adoption forces for the scoped BUY)

Forces are extracted from the DISCOVER evidence base (`../discover/`), not from new
interviews. The behavior being displaced is **hand-rolled `schema_config` JSON +
Parquet-on-S3 + per-org pg_duckdb BI provisioning**, with no standard catalog
protocol.

| Force | Direction | Content (evidence) |
|---|---|---|
| **Push** (frustration with today) | toward the buy | `schema_config` is JSON-in-a-column (`models/dataset.py:94`) + `partition_fields` JSON (`:97`) — a hand-rolled, non-evolvable stand-in for exactly what an Iceberg table schema + partition spec give natively (`../discover/buy-vs-build.md` Q1 "Where we're reinventing"). BI access is a heavy per-org/per-project provisioning dance: engine-node admin creds + schema/role/view lifecycle + rotation + sync (`enable_sql_access.py:71-114`; `../discover/problem-validation.md` P2 = REAL). Handoff today is a dbt-zip (`export_dbt_project.py`), less credible than real Iceberg tables to a data engineer (`../discover/buy-vs-build.md` Q-audit). |
| **Pull** (attraction of the new) | toward the buy | A standard Iceberg REST catalog every lakehouse tool speaks; evolvable table schema + partition spec with schema evolution and snapshot history **for free** (`../discover/buy-vs-build.md` Q1, Q-audit); DuckDB→LakeKeeper write is **GA** (v1.4+), so `INSERT INTO … SELECT <ibis-sql>` both computes and commits with **no dbt runtime** (`../discover/buy-vs-build.md` Q-dbt.2); WorkOS OIDC is a **proven** integration path (`../discover/buy-vs-build.md` Q3); LakeKeeper slots behind the **existing** project port (ADR-020) with zero application-layer change; a client-side DuckDB-WASM preview path opens (stretch). |
| **Anxiety** (concern about adopting) | against | **The ADR-026 determinism fear** — materializing tables *looks* like it could turn the catalog into a render-time read-back authority, which is the one hard-invariant violation (`../discover/wave-decisions.md` [K1]; `../discover/solution-testing.md` Q1/Q2). This is answered by the materialization corollary + an offline determinism probe, but the fear is real and must be *proved* away, not asserted. **The dual-authority / sync burden** (`../discover/solution-testing.md` Q6, [VA5]) — LakeKeeper Projects/Roles/Warehouses overlap our orgs/projects + auth-proxy identity; if adopted as authorities they demand a sync contract. **The authZ boundary is a genuine unknown** (LakeKeeper OpenFGA-authoritative vs. trust-the-proxy — `../discover/buy-vs-build.md` Q3). |
| **Habit** (inertia of current behavior) | against | Today's per-org **pg_duckdb provisioning** + **Parquet-on-S3** is the established, working path (`[C4]`; `../discover/lean-canvas.md` §2). It is ratified across ADR-003/007/026 and "works today". Reaching for another Parquet write + another pg_duckdb schema/role is the path of least resistance; the codebase has a ratified **bias against new always-on runtime dependencies** (`[K6]`; `adr-026...:296`). The buy must coexist with — and demonstrably start to retire — that habit, not merely add beside it. |

### Force balance & implication for slicing

Push + Pull are strong and concrete (a hand-rolled schema blob vs. a free evolvable
catalog; a GA one-step write path; a proven auth path). The dominant restraining
forces are **the ADR-026 determinism anxiety** and **the WorkOS↔LakeKeeper↔DuckDB
credential handshake unknown** (the auth + credential-vending path end-to-end). That
drives the slicing:

1. **The highest-uncertainty work goes first.** The credential handshake (US-1) and
   the determinism-under-materialization probe (US-4) are the two highest-variance
   unknowns, so the walking-skeleton slices target them first (see
   `prioritization.md`). The probe is the safety net — it is proved on the first
   materialization, not deferred.
2. **The determinism probe is born inside the materialization slice**, not added
   later — mirroring how the reference features shipped their invariant guard *inside*
   the slice that needed it.

No opportunity-scoring table is produced here (single job, opportunity already
validated in DISCOVER). Outcome scores live on JOB-005 in `docs/product/jobs.yaml`;
the under-served outcomes are the ones the earliest slices target.
