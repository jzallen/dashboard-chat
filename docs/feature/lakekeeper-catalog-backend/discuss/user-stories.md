<!-- markdownlint-disable MD024 -->
# User Stories — lakekeeper-catalog-backend

**Wave:** DISCUSS · **Area:** backend (repository seam) + operator/data-engineer loop · **Job:** JOB-005 (`docs/product/jobs.yaml`)
**Source:** DC-139 DISCOVER (`../discover/buy-vs-build.md` — scoped BUY; the original DECLINE is superseded)
**Anchor:** LakeKeeper behind the existing project repository port (ADR-020); Ibis stays the only compiler (ADR-026).

Each story is a LeanUX story tracing to one sub-job (`jtbd-job-stories.md`) and one
plane in `../discover/buy-vs-build.md`. The "users" are an internal operator and a
data engineer; every Elevator-Pitch "After" line references a **real invocable entry
point** (a WorkOS-authenticated call, a project-create through the port, a DuckDB
`INSERT`/`SELECT`, the determinism probe) and a **concrete observable output** (an
auto-provisioned user, a Project id, a committed snapshot id, a probe PASS line, query
rows). Requirements completeness and DoR are tracked in `dor-validation.md`.

## System Constraints

Cross-cutting constraints every story below inherits (from DISCOVER + the ADRs). Any
AC that would violate one is invalid.

- **[SC1] Ibis is the only SQL compiler; the catalog is never a render-time authority.**
  All SQL is re-derived from persisted operations by Ibis (ADR-026 `[K1][K2]`). No
  story may make LakeKeeper a render-time read-back authority.
- **[SC2] The ADR-026 materialization corollary.** A materialized Iceberg table is a
  **derived cache** — always regenerated from operations via Ibis, never hand-edited or
  read back, rebuilt when operations change. Iceberg **Views** are export **sinks** only.
- **[SC3] One identity source.** The catalog authenticates against the **same** WorkOS
  IdP the app uses; users auto-provision — no second identity store, no user-sync job.
- **[SC4] The repository seam is behind the existing port.** LakeKeeper integrates as a
  repository adapter behind `RepositoryContainer.projects` (ADR-020) with **zero** change
  to routing, controllers, or use-case logic.
- **[SC5] No dbt runtime.** The materialization write path is DuckDB-direct
  (`INSERT INTO … SELECT`, GA since DuckDB v1.4). dbt stays the optional eject/handoff
  format only.
- **[SC6] Per-org Server tenancy; org lifecycle is out of scope.** One LakeKeeper Server
  per org; provisioning per-org Servers belongs to a future control plane. Stories start
  inside one already-provisioned tenant at Project = dc project; single default Namespace.
- **[SC7] Three decisions are DESIGN forks, not story choices.** Project authority model
  (dual-write vs SoT), authZ boundary (OpenFGA-authoritative vs trust-the-proxy), and
  Parquet→Iceberg migration shape are **surfaced**, never silently chosen (see
  `wave-decisions.md`).

---

## US-1 — The catalog trusts the same WorkOS login the app uses

**As** an operator provisioning an org's data stack,
**I want** the org's Iceberg catalog to authenticate against the same WorkOS IdP the app already uses, with users auto-provisioning,
**so that** a WorkOS token that works for the app also works for the catalog — with no second identity store to keep in sync.

Traces to: **SJ-1** · JOB-005 **O1** · Slice **01** · Plane **Auth**

### Elevator Pitch
Before: there is no catalog at all; identity is delegated to WorkOS via auth-proxy (`auth-proxy/lib/auth.ts:94-96`) and a catalog would risk becoming a second user list to sync (`../discover/solution-testing.md` Q6, [VA5]).
After: point the org's LakeKeeper Server at the WorkOS AuthKit issuer, then present a real WorkOS token to the catalog → the request authenticates and a catalog user auto-provisions (keyed `oidc~<sub|oid>`) with no user-sync job; a wrong-audience token is rejected with nothing provisioned.
Decision enabled: the operator confirms identity is a single source across app and catalog, and that the first hop of the credential handshake is sound.

### Acceptance criteria
- [ ] AC1.1: A valid WorkOS token presented to the catalog (issuer = WorkOS AuthKit, audience = our client id) authenticates and **auto-provisions** a catalog user — no user-sync job runs. **[SC3]**
- [ ] AC1.2: A token whose issuer or audience does not match is **rejected** with an authentication error and **no user is provisioned**.
- [ ] AC1.3: The catalog references the WorkOS AuthKit issuer + our audience for identity — not a hand-rolled user list.
- [ ] AC1.4: The authZ boundary (who may do what in the catalog) is **not** decided here; it is recorded as a DESIGN open fork. **[SC7]**

---

## US-2 — A dc project is a LakeKeeper Project, behind the existing port

**As** an operator (and the backend, unchanged),
**I want** creating a dc project to represent it as a LakeKeeper Project with a default Warehouse at the project's S3 prefix, through the existing project repository port,
**so that** the project's storage location becomes a first-class catalog object without touching routing, controllers, or use-case logic.

Traces to: **SJ-2** · JOB-005 **O1, O2** · Slice **02** · Plane **Management + Catalog/storage**

### Elevator Pitch
Before: a dc project's storage is a hand-rolled `datasets/{project_id}/…` path (`ingestion.py:236`; `config.py:27-33`) and its dataset schema is `schema_config` JSON-in-a-column (`models/dataset.py:94`) — non-evolvable, no catalog protocol.
After: create a dc project through the normal port (`repositories.projects.create(...)`) → a LakeKeeper Project appears mapping 1:1 to the dc project, with a default Warehouse at the project's real S3 prefix, and the routing/controllers/use-case diff is empty (only a new adapter behind the port).
Decision enabled: the operator confirms the "LakeKeeper as a repository" seam (ADR-020) holds with zero application-layer change — so the authority-model choice is genuinely localized to one adapter.

### Acceptance criteria
- [ ] AC2.1: Creating a dc project results in a LakeKeeper Project mapped 1:1 to the dc project, with a default Warehouse at the project's S3 prefix. **[SC6]**
- [ ] AC2.2: The project use case still calls `repositories.projects.create(...)`; the new adapter behind the port is the only new code path — **routing, controllers, and use-case logic are unchanged** (asserted by diff scope + the existing use-case tests passing unmodified). **[SC4]**
- [ ] AC2.3: A failed/timed-out LakeKeeper call surfaces a clear failure and leaves **no silent orphan** half-state; the exact atomicity/compensation is deferred to the DESIGN authority-model decision. **[SC7]**

---

## US-3 — Materialize a dataset as an Iceberg table, no dbt

**As** an operator materializing a chat-authored dataset,
**I want** to write it into an Iceberg table by running its Ibis-compiled SQL through DuckDB directly into the catalog (no dbt),
**so that** a committed snapshot exists that a data engineer can read — while the operations stay the only source of truth.

Traces to: **SJ-3** · JOB-005 **O2, O3** · Slice **03** · Plane **Execution/materialization + Catalog/storage**

### Elevator Pitch
Before: consumption goes through a per-org pg_duckdb BI-provisioning dance (`enable_sql_access.py:71-114`) over raw Parquet, and the handoff is a dbt-zip (`export_dbt_project.py`) — no real cataloged tables.
After: run `INSERT INTO ${iceberg_table_ref} SELECT ${ibis_compiled_sql}` from DuckDB `ATTACH`ed to the Warehouse (`CREATE SECRET` + OAuth2) → an Iceberg snapshot commits and `${snapshot_id}` is returned, with **no dbt process** anywhere in the write path.
Decision enabled: the operator confirms the minimal materialization runtime is backend → DuckDB → LakeKeeper — no new heavy runtime dependency.

### Acceptance criteria
- [ ] AC3.1: Running the dataset's Ibis-compiled SQL through DuckDB into the Warehouse commits an Iceberg snapshot and returns `${snapshot_id}`. **[SC5]**
- [ ] AC3.2: **No dbt process is invoked** at any point in the write path (asserted by process/dependency inventory). **[SC5]**
- [ ] AC3.3: The SQL executed is the Ibis-compiled SQL derived from the persisted operations — **not** a hand-edited or catalog-sourced string. **[SC1][SC2]**

---

## US-4 — Prove the materialized table is a derived cache (ADR-026)

**As** an operator (and every future maintainer),
**I want** to prove the materialized table is a derived cache — re-derivable from operations, with compilation passing while the catalog is offline,
**so that** I know materialization did not turn the catalog into a render-time authority and the determinism invariant is intact.

Traces to: **SJ-4** · JOB-005 **O3, O4** · Slice **04** · Plane **Compile invariant (ADR-026)**

### Elevator Pitch
Before: the determinism anxiety is unanswered — materializing tables *looks* like it could make the catalog a source of truth, the one ADR-026 violation (`../discover/wave-decisions.md` [K1]; `../discover/solution-testing.md` Q1/Q2).
After: run the determinism probe → it prints PASS: re-deriving the table from the persisted operations reproduces the materialized table, and `compile(ops) == compile(load_and_recompile(ops))` **with LakeKeeper switched off**.
Decision enabled: the operator (and DESIGN) confirms materialization is a safe derived cache — the ADR-026 anxiety is discharged by proof, so the scoped BUY can proceed.

### Acceptance criteria
- [ ] AC4.1: Re-deriving the table from the persisted operations (recompile via Ibis + re-run the write) produces a table **equivalent** to the materialized one. **[SC2]**
- [ ] AC4.2: With **LakeKeeper offline**, compilation succeeds without contacting the catalog and `compile(ops) == compile(load_and_recompile(ops))` — the determinism probe **PASSES with the catalog disconnected**. **[SC1]**
- [ ] AC4.3: No compile/render path resolves any column, type, or partition from the live catalog; any exported Iceberg View is a sink only. **[SC1][SC2]**

---

## US-5 — Hand a data engineer a real Iceberg table (read it back)

**As** a data engineer consuming chat-authored datasets,
**I want** to query the materialized Iceberg table through a standard catalog (server-side; stretch: in-browser),
**so that** I get real, evolvable Iceberg tables in a protocol my tools already speak — not a dbt-zip.

Traces to: **SJ-5** · JOB-005 **O2, O5** · Slice **05** · Plane **Catalog / handoff / client-side**

### Elevator Pitch
Before: to consume the data a BI tool must connect over Postgres-wire to a per-project provisioned pg_duckdb schema/role (`[C4]`); there is no standard catalog protocol (0 iceberg/rest-catalog matches, `../discover/problem-validation.md` P3).
After: run a server-side DuckDB Iceberg scan of `${iceberg_table_ref}` through the catalog → rows come back matching the committed snapshot; (stretch) attach the catalog from DuckDB-WASM in the browser over OAuth + `httpfs` and get the same rows.
Decision enabled: the data engineer confirms the catalog is a live standard consumption surface — the handoff is real Iceberg tables, retiring the dbt-zip.

### Acceptance criteria
- [ ] AC5.1: A server-side DuckDB Iceberg scan through the catalog returns rows matching the committed snapshot. **[SC6]**
- [ ] AC5.2: The reader reads the **materialized derived cache**; it does **not** read back a stored SQL/view definition. **[SC1][SC2]**
- [ ] AC5.3 (stretch): DuckDB-WASM in the browser attaches the catalog over OAuth and reads the table via `httpfs`, returning the same rows as the server-side scan — or, if it fails, the failure is characterized as an OAuth/CORS/`httpfs` browser-credential issue and recorded for DESIGN (not a SQL problem).
- [ ] AC5.4: The authZ boundary governing who may read what is **not** decided here; it is recorded as a DESIGN open fork. **[SC7]**

---

## Traceability matrix

| Story | Sub-job | JOB-005 outcome(s) | Slice | Plane | Real invocable entry point → observable output |
|---|---|---|---|---|---|
| US-1 | SJ-1 | O1 | 01 | Auth | present a WorkOS token → user auto-provisions (or wrong-audience → rejected) |
| US-2 | SJ-2 | O1, O2 | 02 | Management + Catalog | create a dc project via the port → LakeKeeper Project + Warehouse at the S3 prefix, empty controller diff |
| US-3 | SJ-3 | O2, O3 | 03 | Execution/materialization | DuckDB `INSERT INTO … SELECT` → committed `${snapshot_id}`, no dbt |
| US-4 | SJ-4 | O3, O4 | 04 | Compile invariant | run the determinism probe → PASS with LakeKeeper offline; re-derive == materialized |
| US-5 | SJ-5 | O2, O5 | 05 | Catalog / handoff | DuckDB scan through the catalog → rows matching the snapshot (stretch: WASM) |

Every JOB-005 outcome (O1–O5, `docs/product/jobs.yaml`) is owned by ≥1 story: O1→US-1/US-2;
O2→US-2/US-3/US-5; O3→US-3/US-4; O4→US-4; O5→US-5. Completeness calculation in
`dor-validation.md`.
