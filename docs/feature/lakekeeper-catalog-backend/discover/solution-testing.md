# Solution Testing — the 7 DISCOVER Open Questions (DC-139)

**Wave:** DISCOVER · **Status:** complete · **Date:** 2026-07-05

> Each question is treated as an assumption to test. "Test/evidence" is the code
> or ADR examined (brownfield analog of an experiment); "finding" is the
> evidence-based conclusion. **ADR-026 violations are flagged explicitly.**

---

## Q1 — Source vs. sink

**Assumption under test:** the Iceberg catalog can *feed* our operations IR
(schema imported once at ingest) rather than being read back during rendering.

**Evidence.** ADR-026 mandates: "operations are the source of truth; ibis/SQL
are always derived… Nothing downstream is ever read back or stored as
authority" (`adr-026...:73-95`, `230-234`; restated `adr-051...:60-71`;
`adr-052...:68-71`). Ingestion today imports schema at write time
(`schema_config` typed at ingest, ADR-026 `:232-235`; ingestion pipeline
`_pipeline/ingestion.py:175-194`). Rendering reads *only* the persisted
operations (`transforms`/`views`/`reports`), never a live external store.

**Finding.** LakeKeeper is admissible **only as a SINK, or as an import-time-only
SOURCE** — never as a live catalog consulted during render. As a *sink*: after
operations are compiled, we may export the resulting table/lineage/schema to
LakeKeeper for external consumers. As an *import-time source*: at ingest we may
read a schema *once*, materialize it into `schema_config`/operations, and then
never consult LakeKeeper again for that dataset. **The moment any render path
resolves a column, type, or partition by querying LakeKeeper, that path is
incompatible with ADR-026** — the fault is the live-catalog usage mode, not
ADR-026 itself (which stands and is sound). LakeKeeper's headline value (a live
evolving catalog you query) is exactly the mode ADR-026 excludes. Compliant use is the *narrow* mode that discards
most of the value. `FLAG: ADR-026 violation risk is structural, not incidental.`

---

## Q2 — Determinism invariant vs. ADR-026

**Assumption under test:** an external catalog can coexist with
"operations-as-data, SQL always re-derived" if schema reflection is import-time
only.

**Evidence.** ADR-026's reproducibility invariant: "the compiled ibis
expression must always be reproducible from the persisted operations alone"
(`adr-051...:283-286`; `adr-052...:278-280`). Import-time reflection that
*materializes* the reflected schema into persisted operations preserves this
(the operations remain self-contained and reproducible). Render-time reflection
breaks it (SQL would depend on external mutable state).

**Finding.** Coexistence is **possible but fragile**. It holds iff every schema
read is (a) at import time only and (b) *frozen into the operations/schema_config
at that instant*, so recompilation never re-reads LakeKeeper. This demands a
hard architectural fence and a probe (ADR-051-style: "compile(ops) ==
compile(load_and_recompile(ops))", `adr-051...:283-289`) that must pass with
LakeKeeper *offline*. If that probe cannot pass with the external catalog
disconnected, the integration violates ADR-026. `FLAG: any Iceberg schema
reflection at render time = ADR-026 violation.` The safe design turns LakeKeeper
into a write-only/import-only peripheral — which is a heavy dependency for a
peripheral role.

---

## Q3 — IR alignment with ADR-051/052

**Assumption under test:** Iceberg can own storage/lineage metadata while ibis
keeps owning SQL emission, cleanly beside the three-tier IR.

**Evidence.** ADR-051 makes `transforms` the canonical, sequenced dataset IR
(`adr-051...:78-91`) and permanently rejects "rules-as-data / stored
translation logic" (`adr-051...:147-149`, `192-194`). ADR-052 normalizes
View/Report into `relation_*` component tables on a shared kernel, unimplemented
but designed (`[P2]`; `adr-052...:83-105`). Both keep SQL always derived by ibis.

**Finding.** There is a *conceptually* clean division: Iceberg = storage/
lineage/snapshot metadata; ibis = SQL emission; operations tables = intent.
**But two concrete conflicts arise:**
1. **Authority overlap on schema.** ADR-051's `schema_config`/operations and
   ADR-052's `relation_columns`/`ProjectionColumn` are *already* the
   authoritative typed schema. Iceberg's table schema would be a *second*
   schema representation. Two schemas require a sync contract and a
   tie-breaker; ADR-026 forces our operations to win, making Iceberg's schema
   derivative and largely redundant.
2. **Timing conflict with `[P2]`.** ADR-052 is designed-but-unbuilt and is a
   prerequisite for the M→IR→ibis reconciliation. Introducing an Iceberg schema
   authority *before* ADR-052 lands would design against a moving IR — exactly
   what the proposal's AGENT INSTRUCTIONS warn against ("coordinate with
   `[P2]`"). **Conflict: any catalog-backend work should not precede or
   entangle ADR-052 delivery.**

**Alignment verdict:** compatible only in the narrow "Iceberg owns
snapshot/lineage, never schema-of-record" slicing — and even then it duplicates
schema and must wait behind `[P2]`.

---

## Q4 — Query path

**Assumption under test:** either (a) ibis gains an Iceberg/REST connector, or
(b) Iceberg populates the operations IR and we keep compiling to DuckDB.

**Evidence.** ADR-026 fixes ibis as the *only* SQL compiler and forbids parallel
compilers / escape hatches (`adr-026...:81-84`, `146-150`, `266-268`). ADR-003
fixes DuckDB/pg_duckdb as the analytical engine (`adr-003...:38-44`). ADR-007
fixes ibis→DuckDB and ibis→Postgres dialects (`adr-007...:26-27`).

**Finding.** Path (a) — **ibis gains an Iceberg connector as an alternate query
path — is the higher-risk option and edges toward an ADR-026/ADR-003 tension**:
it introduces a second execution substrate and, if that connector resolves
schema from the live catalog, a render-time read-back (Q1/Q2 violation). Path
(b) — **Iceberg as an import-time metadata source that populates operations,
DuckDB remains the compile target — is the only ADR-compatible path.** Under
(b), the query path is *unchanged*: ibis→DuckDB exactly as today
(`adr-007...:26`), and Iceberg touches nothing at query time. **Recommended
query-path answer: (b), which means LakeKeeper adds no query capability at
all** — it only feeds ingest-time metadata. That reframes the whole proposal:
LakeKeeper's query-path contribution under ADR compliance is *nil*.
`FLAG: path (a) with live schema resolution violates ADR-026.`

---

## Q5 — Migration shape

**Assumption under test:** Parquet-on-S3 → Iceberg is a manageable
expand/contract with a coexistence window.

**Evidence.** Storage today is partitioned Parquet on S3/MinIO written by
`lake_repo.write_csv_as_partitioned_parquet()`
(`repository.py:98`; `ingestion.py:175-194`); presigned uploads
`repository.py:413-430`; config `config.py:27-33`. **[C3]** BI views read
Parquet directly via bootstrap DDL (`sql_access_service.py:36-48`). The proposal
itself lists "not committing to Iceberg as the storage format yet" as a
non-goal.

**Finding.** Iceberg is a **table format layered over Parquet files**, so a
coexistence window is technically feasible (write Iceberg metadata over existing
Parquet, expand/contract per ADR-052's own migration pattern
`adr-052...:168-179`). **But the cost is large and asymmetric to the benefit:**
- Every write path (`ingestion.py`, `repository.py`) must learn to emit Iceberg
  table metadata (snapshots, manifests) alongside/instead of raw partition
  writes.
- Every read path (BI bootstrap DDL, DuckDB preview) must be able to read via
  the Iceberg catalog *or* raw Parquet during coexistence — two code paths to
  maintain for the window's duration.
- The non-goal "not committing to Iceberg storage yet" means this migration is
  *out of scope for the proposal by its own terms* — yet without it, LakeKeeper
  has no Iceberg tables to catalog. **Internal tension: the proposal wants the
  catalog without committing to the storage format the catalog exists to
  describe.** A catalog over non-Iceberg Parquet is a degenerate LakeKeeper.

---

## Q6 — Ownership overlap

**Assumption under test:** LakeKeeper's Projects/Roles/Namespaces/Warehouses map
cleanly onto our orgs/projects + auth-proxy identity.

**Evidence.** Our identity/tenancy is authoritative and already wired:
- Orgs/projects are first-class metadata with `org_id` scoping throughout
  (`[C1]`; `enable_sql_access.py:107-113` persists `org_id`).
- auth-proxy owns identity: JWT verification, M2M token mint, identity-header
  injection (CLAUDE.md Auth section; `AUTH_MODE` dev/workos).
- Per-org query engines carry their own admin credentials
  (`008_add_query_engine_nodes.py:42-43`); access = per-project schema + proxy
  role (`query_engine_provisioner.py:51-65`, `external_access` `:54-61`).

**Finding.** **Direct, contended overlap — this is the sharpest adoption
cost.** LakeKeeper's management core (Projects, Users, Roles, Warehouses,
Namespaces) is a *parallel* identity+tenancy model. For every entity there is a
"who is authoritative?" fork:
- LakeKeeper Project vs our `projects`/`org_id` — our metadata store must stay
  authoritative (`[C1]`), so LakeKeeper Projects become a *mirror* requiring
  sync.
- LakeKeeper Roles/Users vs auth-proxy identity — auth-proxy is the ingress
  identity authority; two role systems means a mapping layer and a drift risk.
- LakeKeeper Warehouses vs our S3/MinIO storage config (`config.py:27-33`) and
  per-org engine nodes — another mapping.
Adopting LakeKeeper's management entities is **not** "extend rather than
reinvent"; it is *re-platforming identity onto a second authority* and then
building sync/mapping to keep our authoritative store and auth-proxy in charge.
`FLAG: ownership overlap creates a standing dual-authority + sync burden.`

---

## Q7 — Operational cost

**Assumption under test:** running LakeKeeper as another service is
cost-justified vs the per-org pg_duckdb model we already operate.

**Evidence.** Today's operational surface: per-org pg_duckdb engine nodes with
admin creds (`008_...:34-50`), health checks (`query_engine_provisioner.py:78-97`),
per-project provisioning + credential rotation (`sql_access.py:56-66`), view
sync (`sql_access.py:46-53`). This is already non-trivial (problem-validation
P2).

**Finding.** LakeKeeper is an **additional** always-on stateful service (its own
Postgres-backed catalog + REST API), not a replacement for pg_duckdb — because
BI clients still need a query engine and per-tenant access control, which
LakeKeeper does not provide. So the operational ledger is **strictly additive**:
- + LakeKeeper service (deploy, monitor, back up its catalog DB, secure its API).
- + sync loops (operations→Iceberg export; identity/tenancy mirror, Q6).
- + a second schema authority to reconcile (Q3).
- − nothing removed: pg_duckdb, engine nodes, and per-project provisioning all
  remain (Q4 shows LakeKeeper adds no query path under ADR compliance).

ADR-026's own "Operational" sections repeatedly note the value of "no new
runtime dependency" (`adr-026...:296`; `adr-051...:248`; `adr-052...:245`) — the
codebase has a ratified bias against new always-on substrate. LakeKeeper is a
new always-on substrate. `Net operational cost: clearly positive (worse), with
no demonstrated offsetting removal.`

---

## Cross-question synthesis

| Q | ADR-026-compatible answer | What it costs the proposal's value |
|---|---|---|
| Q1 source/sink | sink or import-time-only source | forbids the "live catalog" value |
| Q2 determinism | freeze schema into ops at import | LakeKeeper becomes write-only peripheral |
| Q3 IR alignment | Iceberg=snapshot only, never schema-of-record | duplicates schema; must wait behind `[P2]` |
| Q4 query path | (b) import-time metadata; DuckDB unchanged | LakeKeeper adds zero query capability |
| Q5 migration | expand/contract feasible | large 2-path cost; storage commit is a proposal non-goal |
| Q6 ownership | our store + auth-proxy stay authoritative | dual-authority + permanent sync burden |
| Q7 op cost | additive service, nothing removed | net worse operationally |

**Every ADR-compatible answer narrows LakeKeeper to a peripheral, write-only,
schema-duplicating, operationally-additive role that delivers none of its
headline value.** The only path that unlocks LakeKeeper's real value (live
queryable catalog, Iceberg query connector, adopted management entities) is the
path that violates ADR-026. That is the decisive finding.
