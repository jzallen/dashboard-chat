# DISCUSS Decisions — lakekeeper-catalog-backend

**Wave:** DISCUSS · **Area:** backend (repository seam) + infrastructure/operator aspect · **Feature type:** Backend · **Walking skeleton:** Yes (the DISCOVER "concrete first slice")

## Source & routing note (read first)

Promoted from **DC-139** ("Integrate Apache LakeKeeper with Catalog Backend"). The
DISCOVER wave is complete (`../discover/`). This DISCUSS wave builds on
`../discover/buy-vs-build.md`, which is **authoritative**, and honors its supersession
of the original DISCOVER recommendation (see §Changed Assumptions). No DIVERGE wave ran
— the opportunity was validated in DISCOVER (O1 REAL) and the design question is a
scoped buy-vs-build across ratified planes, so a light JTBD bridge (JOB-005) was
produced rather than a full ODI study. These `docs/feature/` artifacts are the single
source of truth.

## Key Decisions

- **[D1] Light JTBD bridge, not full DIVERGE.** The opportunity is validated
  (`../discover/opportunity-tree.md` O1 REAL; `../discover/problem-validation.md` P2).
  Added **JOB-005** to `docs/product/jobs.yaml` with three dimensions + a light
  four-forces (anxiety includes the ADR-026 determinism fear and the dual-authority/sync
  burden; habit = today's per-org pg_duckdb + Parquet-on-S3). Provisional, DISCUSS-derived
  scoring, flagged as such. (see: `jtbd-job-stories.md`)
- **[D2] Encode the scoped BUY, keep-build the compile plane.** Per
  `../discover/buy-vs-build.md`: **BUY** the catalog/storage plane (LakeKeeper Iceberg
  REST catalog; Iceberg table schema + partition spec replace `schema_config` JSON —
  `models/dataset.py:94`); **BUY-the-engine** for materialization (DuckDB writes Iceberg
  directly, `INSERT INTO … SELECT`, **no dbt runtime**); **KEEP-BUILD** Ibis as the only
  compiler (ADR-026) and the design-intent audit log. (see: `user-stories.md` §System
  Constraints)
- **[D3] LakeKeeper integrates as a repository adapter behind the existing project port
  (ADR-020).** Zero change to routing, controllers, or use-case logic
  (`LakeKeeperProjectRepository` behind `RepositoryContainer.projects`). (see: US-2;
  `shared-artifacts-registry.md`)
- **[D4] The ADR-026 materialization corollary is load-bearing and baked into AC.** A
  materialized Iceberg table is a **derived cache** (always re-derived from operations
  via Ibis; rebuilt when operations change; never read back). Iceberg **Views** are
  export **sinks** only. Proven by the determinism probe (US-4 / K1), which must pass
  with LakeKeeper **offline**. (see: US-4; `outcome-kpis.md` K1)
- **[D5] Tenancy: one LakeKeeper Server per org; org lifecycle out of scope.** Org =
  tenant = deployment boundary; the catalog hierarchy inside a tenant starts at
  **Project = dc project** with a default **Warehouse** and a single default Namespace.
  Provisioning per-org Servers belongs to a FUTURE control plane. (see: US-2 [SC6];
  `story-map.md` §guardrails)
- **[D6] Walking skeleton = the DISCOVER "concrete first slice", single-tenant/non-prod.**
  Five elephant-carpaccio slices (auth → project → materialize → prove → read back),
  each ≤1 day with a named learning hypothesis; the `@infrastructure` container standup
  is folded into Slice 01 (no pure-infra slice). (see: `story-map.md`,
  `prioritization.md`, `slices/`)
- **[D7] Order by learning leverage.** The two highest-uncertainty unknowns — the
  WorkOS↔LakeKeeper↔DuckDB **credential handshake** and **determinism-under-materialization**
  — go first; the determinism probe (safety net) ships with the first materialization,
  not after it. (see: `prioritization.md`)
- **[D8] Three real forks are surfaced for DESIGN, not chosen here** — project authority
  model, authZ boundary, Parquet→Iceberg migration shape (see §Upstream Changes).
- **[D9] Operator/data-engineer journey is a cross-cutting integration loop, catalogued
  as provisional J-009 — not promoted to product SSOT.** Like J-008 (operator
  observability), it is an operator/data-engineer loop, not an end-user product flow.
  (see: `journeys/_inventory.md`)

## Requirements Summary

- **Primary job:** JOB-005 — carry each org's catalog, table schema, storage
  credentials, and data-version history on a standard Iceberg REST catalog that
  materializes tables from Ibis-compiled SQL, without the catalog ever becoming a
  render-time authority.
- **Walking skeleton scope:** one dataset, one tenant, non-prod — auth → represent →
  materialize → prove → read back.
- **Feature type:** Backend (repository seam) with an infrastructure/operator aspect.

## Technical approach (for DESIGN to ratify)

- **Catalog:** LakeKeeper as the Iceberg REST catalog; Iceberg table schema + partition
  spec replace `schema_config` JSON-in-a-column.
- **Auth:** LakeKeeper OIDC against the WorkOS AuthKit issuer (`OPENID_PROVIDER_URI`),
  audience = our client id; users auto-provision. auth-proxy forwards the user token or
  mints M2M for backend→LakeKeeper calls.
- **Repository seam:** `LakeKeeperProjectRepository` behind `RepositoryContainer.projects`
  (ADR-020); `@with_repositories` injects it; the use case is unchanged.
- **Materialization:** DuckDB `ATTACH`es the Warehouse (`CREATE SECRET` + OAuth2) and
  runs `INSERT INTO <iceberg_table> SELECT <ibis-compiled-sql>` — GA since DuckDB v1.4;
  no dbt runtime.
- **Determinism fence:** the ADR-051-style probe extended to assert re-derive ==
  materialized and to pass with LakeKeeper offline.

## Constraints Established

- **The ADR-026 materialization corollary** (`[D4]`): materialized tables are derived
  caches; Iceberg Views are export sinks only; the catalog is never a render-time
  authority; Ibis stays the only compiler (`[K1][K2]` from DISCOVER).
- **Per-org Server tenancy** (`[D5]`): one LakeKeeper Server per org; org lifecycle in a
  future control plane; Project = dc project; default Warehouse; single default Namespace.
- **One identity source:** the catalog authenticates against the same WorkOS IdP; users
  auto-provision; no user-sync job.
- **The repository seam is behind the existing port** (ADR-020); zero application-layer
  change.
- **No dbt runtime** in the write path; dbt stays the optional eject/handoff format.
- **Must stay compatible with the unbuilt ADR-052 `relation_*` IR** (`[K7]`) — the
  Iceberg-sink export must align with the shared Relation IR (reconciliation is a DESIGN
  fork).

## Changed Assumptions (DISCUSS builds on a superseded-then-corrected DISCOVER recommendation)

The `nw-discuss` skill requires recording where this wave builds on a changed prior
decision. This DISCUSS wave **does not build on the original DISCOVER recommendation**,
which was **DECLINE**. That recommendation is **explicitly superseded** by
`../discover/buy-vs-build.md` (see the ⚠️ banner atop `../discover/wave-decisions.md`).
No DISCOVER file is modified by this wave.

The original DISCOVER recommendation (`../discover/wave-decisions.md` §Recommendation),
verbatim:

> **DECLINE now** as the default, with a **conditional bounded SPIKE** that unlocks
> only if a concrete Iceberg-consuming client requirement is produced first.
> **Do not ADOPT** on current evidence.

**Why it is superseded (from `../discover/buy-vs-build.md` §"The framing error this
document corrects"):** the DECLINE let **ADR-026 veto the whole proposal**, but ADR-026
governs exactly one plane — SQL compilation/render. It framed the exercise as "does
LakeKeeper fit our current internals" (status-quo lens) instead of the buy-vs-build
question the issue actually asks ("which load-bearing features are we reinventing that
Iceberg/LakeKeeper already carry"). The corrected finding separates four planes and
lands on a **scoped BUY** of the catalog/management/audit plane while keeping Ibis on
the compile plane. `buy-vs-build.md` closes: *"the honest buy-vs-build answer is yes,
buy the catalog/management/audit plane, keep building the compile plane. The earlier
DECLINE conflated the two."*

**What survives from the DECLINE analysis (still useful):** the Constraints
`[K1]`–`[K7]` and the validated assumptions — especially `[VA2]` (per-org BI
provisioning is a real pain → opportunity O1), `[VA5]` (dual-authority sync burden → the
authority-model DESIGN fork), and `[K1]` (ADR-026 determinism is a hard invariant → the
materialization corollary + offline probe). These are carried into this wave's
constraints and anxiety analysis. Only the **recommendation** is superseded, not the
evidence.

**Consequence for this wave:** JOB-005, the journey, the stories, and the KPIs are all
built on the **scoped-BUY** conclusion. The one hard invariant the DECLINE correctly
identified (ADR-026) is honored by making it the load-bearing acceptance criterion
(US-4 / K1 — the probe passes with LakeKeeper offline), which is precisely how the
corrected finding admits materialization without violating the invariant.

## Open Questions / Upstream Changes (DESIGN open forks — NOT resolved here)

Handed to DESIGN (`solution-architect` / `platform-architect`), surfaced not chosen:

- **[F1] Project authority model.** Dual-write mirror (low risk) vs. LakeKeeper Project
  as source of truth (full buy). Governs project-create atomicity/compensation (the
  external HTTP call sits outside the SQLAlchemy transaction) and the
  `datasets.project_id`/`views.project_id` FK story. (`../discover/buy-vs-build.md` Q2)
- **[F2] AuthZ boundary.** LakeKeeper OpenFGA-authoritative for catalog objects vs.
  trust-the-proxy. The one authN-vs-**authZ** unknown worth probing hands-on.
  (`../discover/buy-vs-build.md` Q3)
- **[F3] Control-plane shape + Namespace posture.** Where org-create + auth-proxy +
  ui-state consolidate into a control plane that provisions each org's LakeKeeper
  Server; whether Namespaces stay a single default. (`../discover/buy-vs-build.md` open
  forks)
- **[F4] Parquet→Iceberg migration shape.** Register-in-place (cheap) vs. rewrite
  (expand/contract, coexistence). Was a stated non-goal; the skeleton materializes one
  dataset without a bulk migration. (`../discover/buy-vs-build.md` open forks)
- **[F5] ADR-052 reconciliation.** Align the Iceberg-sink export with the shared Relation
  IR (ADR-052 View/Report normalization, PROPOSED) rather than fighting it. (`[K7]`)

## Hand-off

- **To DESIGN** (`/nw-design`): journey artifacts (visual + YAML) + story map +
  `user-stories.md` + `shared-artifacts-registry.md`, with the five open forks
  `[F1]–[F5]` as the decisions to own. The scoped BUY, the repository seam, and the
  ADR-026 materialization corollary are the fixed inputs; the authority/authZ/migration
  shapes are the fork. An ADR ratifying the ADR-026 materialization corollary (materialized
  tables = derived caches; Iceberg Views = sinks) is recommended so materialization is not
  mistaken for stored-SQL.
- **To DISTILL** (`/nw-distill`): BDD acceptance tests from
  `journey-lakekeeper-catalog-backend.feature` (the ADR-026 determinism scenarios and the
  no-dbt/empty-controller-diff assertions are first-class) + the per-slice AC + a
  `roadmap.json` ordered per `prioritization.md`. The determinism probe (passes with
  LakeKeeper offline) is the load-bearing DISTILL deliverable.
- **To DEVOPS** (KPIs only): `outcome-kpis.md` — K1 (determinism probe 100% offline) as
  the hard gate; K5/K7/K8 baselines to finalize as production SLOs.

## Note on the absent DIVERGE

DIVERGE did not run (opportunity validated in DISCOVER; scoped buy-vs-build, not a
contested opportunity). This is consistent with the JOB-003/JOB-004 light-bridge
convention. Risk of the light bridge: outcome scoring on JOB-005 is provisional
(DISCUSS-derived), not ODI-measured — flagged on the job and revisitable if a formal
DIVERGE is ever warranted.
