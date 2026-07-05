# DC-139 — LakeKeeper Buy-vs-Build (the actual spike)

**Status:** DISCOVER / spike findings. This issue *is* the spike — no separate spike
task. The question is not "does LakeKeeper fit our current internals" (status-quo lens)
but **"which load-bearing features are we reinventing that Iceberg/LakeKeeper already
carry, and should we buy them?"** (buy-vs-build lens).

## The framing error this document corrects

The first DISCOVER pass let **ADR-026 veto the whole proposal**. That was wrong.
ADR-026 governs exactly one plane — **SQL compilation / render** ("operations are data,
SQL is always re-derived, Ibis is the only compiler"). LakeKeeper's value is mostly on
**other planes** that ADR-026 does not touch. **dbt is the plane the original analysis
missed** — it is the execution/materialization bridge between Ibis (define) and
Iceberg/LakeKeeper (store), and it is *already half-built* (see Q-dbt):

| Plane | Owner today | ADR-026 applies? | LakeKeeper/dbt candidate? |
|---|---|---|---|
| **SQL define / compile** | Ibis (`[A26]` ACCEPTED) | **Yes — hard invariant** | **No.** Keep Ibis. It stays the definition compiler; it now emits a dbt model instead of only render-time SQL. |
| **Execution / materialization** | Ibis→SQL→pg_duckdb over Parquet, ephemeral per render (`_pg_duckdb_query.py`) | Boundary — see Q-dbt | **DuckDB** (the engine) writes Iceberg to LakeKeeper directly (`INSERT INTO … SELECT`, GA since v1.4). dbt = *optional* orchestration/handoff, **not** a required runtime. |
| **Catalog / storage** | `datasets.storage_path` → Parquet on S3 (`ingestion.py:236`), no catalog protocol | No | **Yes.** Iceberg tables + REST catalog (LakeKeeper) as dbt's write target. |
| **Management** (orgs, projects, roles) | `projects` table + hand-rolled CRUD (`routers/projects.py`), WorkOS for identity | No | **Partial.** LakeKeeper Project = dc project (see Q2). |
| **Audit / handoff** | `assistant_audit_entries` (design intent) + dbt-zip export (`export_dbt_project.py`) | No | **Complementary** — the eject *becomes* the runtime, so handoff = real Iceberg tables, not a zip (Q-audit + Q-dbt). |

Separating the planes is the whole point. The compile-plane invariant is real, but it
only constrains *one* of the four planes. Letting it veto the other three is the
status-quo bias the DISCOVER wave exists to catch.

---

## Q1 — Where does Iceberg/LakeKeeper align with our existing data model?

LakeKeeper organizes resources as **Server → Project → Warehouse → Namespace →
Table/View** ([concepts](https://docs.lakekeeper.io/docs/0.12.x/concepts/)). Mapped onto
our model **under the per-org tenant-isolation posture** (see "Tenancy" below):

| LakeKeeper entity | Our concept | Evidence | Fit |
|---|---|---|---|
| **Server** (a whole LakeKeeper deployment) | **Org / tenant** — each org runs its own stack incl. its own LakeKeeper | tenant-isolation posture (control-plane provisions per-org stacks) | **Strong** — org is the *deployment boundary*, not a catalog object. One LakeKeeper Server per org. |
| **Project** | **`projects`** (a design workspace) | `projects` table `001:46-55`; datasets/views FK `project_id` | **Strong — direct, same level.** dc project → LakeKeeper Project. |
| **Warehouse** (a storage location + storage-profile/credential) | The project's S3 storage `datasets/{project_id}/…` | `migrations/001_initial_schema.py:59`, `ingestion.py:236` | **Strong** — one default Warehouse per project; domain segregation (extra Warehouses) added later if needed. |
| **Namespace** (logical grouping of tables) | *(intentionally unimplemented)* | — | **Deferred** — leave unimplemented; if the REST spec requires one, configure a single **default namespace** at build. Add later for domain segregation. |
| **Table** | `sources` / `datasets` (schema in `schema_config` JSON) | `models/dataset.py:94-96`, `sources` table `019:36-61` | **Strong for physical tables** — Iceberg table schema replaces `schema_config` JSON-in-a-column with a real, evolvable catalog schema. |
| **View** (Iceberg materialized/logical view) | `views` / `reports` (Ibis-compiled, re-derived) | `views` table `005`, `models/view.py` | **Sink-only** — `[A26]` forbids reading a stored view definition back at render. An Iceberg View can be an **export target** for BI, not the source of truth. |
| **Role / User** | (none — we have no user/member table) | Area-1 finding: "app has NO user/member management API" | **N/A locally** — both we and LakeKeeper defer to the IdP (see Q3). |

### Tenancy & control-plane assumptions (working model)

- **Org = tenant = deployment boundary.** Most of the stack is deployed **per org** with
  minimal shared services; each org therefore gets its **own LakeKeeper Server**. Org is
  *above* the LakeKeeper hierarchy, not an entity inside a shared catalog.
- **Control plane is not built yet.** Org-create, auth-proxy, and ui-state are candidates
  to **become or feed** a future control-plane app that provisions and manages the per-org
  stacks (including standing up each org's LakeKeeper). Org lifecycle lives there, not in
  the per-org data plane.
- **Consequence for the mapping:** because org resolves to a whole Server, the catalog
  hierarchy inside a tenant starts at **Project = dc project**. This is why the earlier
  "offset by one level" mapping was wrong — it tried to place org *inside* the catalog.

**Where we're reinventing:** `schema_config` as JSON-in-a-column (`models/dataset.py:94`)
plus `partition_fields` JSON (`:97`) is a hand-rolled, non-evolvable stand-in for exactly
what an **Iceberg table schema + partition spec** provides natively, with schema
evolution and snapshotting for free. This is the strongest buy signal in the data model.

**Where alignment breaks (keep-build):** our **views/reports are derived, never stored**
(`[A26]`). Iceberg Views must be a *sink* (export published tables for external
consumers), never a source Ibis reads back. This is the one hard boundary — and it is a
boundary on *one plane*, not a veto.

---

## Q2 — Could the API routes for managing users and projects go to LakeKeeper?

Two very different answers, because we treat users and projects very differently today.

### Users — nothing to move (we already don't own them)
The backend has **no user/member-management routes at all**; identity is fully delegated
to WorkOS via auth-proxy, and the backend is a pure resource server reading trust-gated
`X-User-Id` / `X-Org-Id` headers (`auth/middleware.py:32-59`, `routers/deps.py:21-56`).
So there is **no "user route" to hand to LakeKeeper** — instead, LakeKeeper would
**provision its own users from the same WorkOS IdP independently** (it auto-creates a user
on first authenticated request — see Q3). Users converge *because both consume WorkOS*,
not because we proxy them.

### Projects — a real, bounded buy option
Our project management is small and concrete — ~6 endpoints, all writing the `projects`
table:

- `POST /api/projects` → `create_project.py:15-52`
- `GET /api/projects`, `GET /api/projects/{id}` → list/get
- `PATCH /api/projects/{id}`, `DELETE /api/projects/{id}` → update/delete
  (`routers/projects.py:193-227`, `controllers/project_controller.py:59-93`)

These could delegate to **LakeKeeper Projects** (create/list/delete via its Management API
under `/management`) — a **direct, same-level mapping** (dc project → LakeKeeper Project),
each backed by a default **Warehouse** for its storage. That is a genuine buy candidate.
**But it moves authority**: today `datasets.project_id`, `views.project_id`, audit
entries, and org-scoping all FK to our `projects` row. Making LakeKeeper authoritative for
project existence means either (a) LakeKeeper Project is the source of truth and we keep a
local mirror row for the FKs, or (b) we keep `projects` local and *also* create a
LakeKeeper Project per project (dual write). **(b) is the low-risk first slice**; **(a) is
the "full buy" that a later decision could ratify.**

**Whose route is it, though — data plane or control plane?** Under tenant isolation, org
lifecycle belongs to the (future) **control plane** (org-create + auth-proxy + ui-state as
its seed), which stands up each org's LakeKeeper Server. **Project** lifecycle is a
*within-tenant* concern and is the clean candidate to delegate to that org's LakeKeeper
Project entity. So the buy question is specifically "do the *project* CRUD routes call the
tenant's LakeKeeper Management API" — users and orgs are handled elsewhere (IdP and control
plane respectively).

---

## Q3 — Will LakeKeeper auth integrate with WorkOS?

**Yes — this is a standard OIDC integration, not a research risk.** Evidence:

- LakeKeeper authenticates against **any OIDC IdP** via
  `LAKEKEEPER__OPENID_PROVIDER_URI`, validates the `aud` claim via
  `LAKEKEEPER__OPENID_AUDIENCE`, and **requires** the provider to expose
  `/.well-known/openid-configuration` with `issuer` + `jwks_uri`
  ([auth docs](https://docs.lakekeeper.io/docs/latest/authentication/)).
- **WorkOS AuthKit exposes exactly that document** at
  `https://api.workos.com/user_management/{clientId}/.well-known/openid-configuration`
  ([WorkOS OIDC](https://workos.com/docs/reference/workos-connect/metadata/openid-configuration)).
  We already consume WorkOS JWKS today (`auth-proxy/lib/auth.ts:94-96`).
- LakeKeeper **auto-provisions users on first successful authentication** and keys them as
  `oidc~<sub|oid>` — so no user-sync job is needed; a valid WorkOS token is sufficient.
- LakeKeeper supports **both** human (Auth Code + PKCE) and **M2M client-credentials**
  tokens — which lines up with our existing split of WorkOS user tokens + auth-proxy M2M
  mint (`CLAUDE.md` auth section, `auth-proxy` M2M).

**Integration shape:** point `LAKEKEEPER__OPENID_PROVIDER_URI` at the WorkOS AuthKit
issuer; set `OPENID_AUDIENCE` to our client id; the auth-proxy either forwards the user's
WorkOS token to LakeKeeper or mints an M2M token for backend→LakeKeeper calls. **AuthZ is
the open question, not authN**: LakeKeeper's authorization defaults to OpenFGA (or
Cedar/OPA). Our org-scoping is enforced in-app (`routers/deps.py:73-96`
`authorize_project_access`). Two authorization models would coexist — decide whether
LakeKeeper's authorizer is authoritative for catalog objects while the app stays
authoritative for design objects, or whether we run LakeKeeper in a
trust-the-proxy posture. **This is the one thing worth probing hands-on.**

Sources: [LakeKeeper auth](https://docs.lakekeeper.io/docs/latest/authentication/),
[LakeKeeper concepts](https://docs.lakekeeper.io/docs/0.12.x/concepts/),
[WorkOS OIDC discovery](https://workos.com/docs/reference/workos-connect/metadata/openid-configuration),
[LakeKeeper authz/OpenFGA](https://docs.lakekeeper.io/docs/nightly/authorization-openfga/).

---

## Q-audit — Does Iceberg subsume our audit trail / design handoff?

**Partly — and the split is instructive.** Two different kinds of history:

- **Physical/data history** — Iceberg snapshots give table-version history, time-travel,
  and lineage of the *data* for free. We reinvent a thin slice of this with
  `transforms.version` (a bare int, no history table) and `datasets.updated_at`. **Buy.**
- **Design-intent history** — `assistant_audit_entries` records *why* a transform exists
  (tags: `join`, `filter`, `grain`, `measure`, `clean`, `cast`…; `create_audit_entry.py:30-86`).
  Iceberg snapshots **do not** capture design rationale. **Keep-build.**

So the "design handoff" value prop is really two products: (1) hand a data engineer **real
Iceberg tables in a standard catalog** (Iceberg does this far better than our dbt-zip
export, `export_dbt_project.py:25-73`), and (2) hand them the **design story** (our audit
log — uniquely ours). Buying (1) makes our handoff *more* credible to data engineers who
already live in Iceberg; it does not cannibalize (2).

---

## Q-dbt — Where does dbt fit, and is it even required?

**First, untangle three roles that the earlier draft blurred.** They are separable, and
naming them answers the question:

| Role | What it does | Does it move/compute data? | Candidates |
|---|---|---|---|
| **Catalog** | Holds table metadata + snapshots; vends storage credentials | **No** | **LakeKeeper** |
| **Compute / write engine** | Executes the transform SQL, writes data files to S3, commits a snapshot | **Yes** | **DuckDB**, PyIceberg, Trino/Spark |
| **Orchestration** | Builds the model DAG in order, incremental strategies, tests, handoff artifact | **No** | **dbt** (optional) |

The insight in your question is correct: **LakeKeeper is a catalog, not an engine, and dbt
is an orchestrator, not an engine.** Neither writes bytes. *Something* has to execute the
transform and write — and that something has always been DuckDB in our stack. So:

### Q-dbt.1 — "Does dbt write through LakeKeeper without DuckDB?"
**No — dbt never writes anything itself.** dbt compiles SQL and hands it to an *adapter*
that drives an engine. "dbt writes to LakeKeeper" always expands to "dbt tells DuckDB (or
Spark/Trino) to run `INSERT/CREATE`, and that engine commits the snapshot to LakeKeeper."
Drop the engine and dbt has nothing to delegate to.

### Q-dbt.2 — "Do we still need DuckDB for writes?"
**You need *a* compute engine; it doesn't have to be DuckDB — but DuckDB is the incumbent,
lightest choice and it can now do the whole write itself.** Two facts (verified):
- **DuckDB → LakeKeeper write is GA**, not a research risk. DuckDB v1.4 LTS (Sep 2025)
  shipped Iceberg writes; `ATTACH` a LakeKeeper catalog (via `CREATE SECRET` + OAuth2) and
  writes commit as new snapshots — `CREATE TABLE`/`INSERT` (1.4), `DELETE`/`UPDATE` (1.4.2),
  `MERGE INTO` (1.5.3, May 2026)
  ([DuckDB Iceberg writes](https://duckdb.org/2025/11/28/iceberg-writes-in-duckdb),
  [REST catalogs](https://duckdb.org/docs/current/core_extensions/iceberg/iceberg_rest_catalogs)).
  So the minimal write path is `INSERT INTO <iceberg_table> SELECT <ibis-compiled-sql>` —
  DuckDB both *computes* and *commits*, no dbt.
- **PyIceberg** can write to a LakeKeeper REST catalog from **pure Python** (PyArrow,
  no JVM/Spark; append/overwrite, ACID)
  ([PyIceberg writing](https://py.iceberg.apache.org/api/)). So the FastAPI backend could
  commit a result set to Iceberg *without DuckDB at all* — **if** it already holds the data
  as Arrow. But our transforms are SQL (Ibis), so realistically a SQL engine executes them;
  DuckDB→Arrow→PyIceberg is a valid split, but keeping DuckDB as the one-step writer is
  simpler. **Net: keep DuckDB as the compute engine; it isn't strictly mandatory, but
  replacing it means bringing another SQL engine.**

### Q-dbt.3 — "On reads, dbt isn't necessary — right?"
**Correct, entirely.** DuckDB (server-side **or** WASM) `ATTACH`es the LakeKeeper REST
catalog and scans Iceberg tables directly; dbt has **zero** role in the read/query path
(dbt is build-time only). This is also the concrete unlock for the original issue's
**DuckDB-WASM client-side preview** hypothesis: the browser talks to LakeKeeper + S3
directly. *(Worth a spike check: WASM DuckDB holding catalog OAuth creds + `httpfs` S3
access in-browser — same engine, but the browser credential/CORS path is the unknown, not
the SQL.)*

### So what is dbt actually for here? (honest answer: optional)
If DuckDB writes to LakeKeeper directly and reads bypass dbt, dbt's remaining value is
**orchestration + portability**, not runtime necessity:
- the **build DAG** (staging→intermediate→marts ordering, `ref()` resolution) — but we
  *already* compute that ref graph for the eject (`_dbt/__init__.py`), so the backend could
  drive DuckDB in dependency order itself;
- **incremental strategies** — DuckDB now has `MERGE INTO` natively, so we could implement
  these directly;
- **tests / schema contracts** — useful, though our constraints already live in operations;
- the **portable handoff artifact** — still genuinely valuable for a data engineer who
  wants to run our project inside *their* dbt stack.

**Revised recommendation on dbt:** the **minimal materialization runtime is
backend → DuckDB (Ibis-compiled SQL) → `INSERT INTO` LakeKeeper Iceberg table** — no dbt
runtime required. **Keep dbt as the eject/handoff format** (already built,
ADR-026-ratified — `adr-026…:269-271`) and adopt dbt-as-orchestrator *later, only if* the
model DAG grows complex enough to be worth `dbt run` in-process. This is cheaper than
"dbt is the runtime," avoids a new heavy runtime dependency, and sidesteps the one immature
seam (the **dbt-duckdb adapter's** Iceberg materialization is still evolving —
[dbt-duckdb](https://github.com/duckdb/dbt-duckdb) — even though DuckDB-the-engine is GA).

### ADR-026 boundary — compatible, with one rule (unchanged by the above)
Materializing a *table* is **not** what ADR-026 forbids (that's storing the *definition*
and reading it back). A materialized Iceberg table is **derived data** — a cache/build
output — provided (a) the SQL is **always regenerated from operations via Ibis**, never
hand-edited and read back, and (b) the table is **rebuilt when operations change** (never
the authority for *what a transform is*). Under that rule, reads may hit the materialized
Iceberg table instead of re-running the pipeline over raw Parquet — a real perf + handoff
win — with the determinism invariant intact. **Flag for DESIGN:** write this down as an
explicit corollary to ADR-026 so materialization isn't mistaken for stored-SQL. This holds
whether the writer is DuckDB-direct or dbt-orchestrated.

---

## Recommendation (revised): scoped BUY on the catalog/management plane; keep-build on compile

Not "decline," not "adopt everything." A **plane-separated buy-vs-build**:

**Buy / build-on (the coherent target):**
1. **LakeKeeper as the Iceberg catalog** — the metadata/credential plane; replaces
   `schema_config`-JSON + raw Parquet with evolvable Iceberg tables + snapshots.
2. **DuckDB as the compute/write engine, writing Iceberg to LakeKeeper directly** —
   `INSERT INTO … SELECT <ibis-sql>` (GA since DuckDB v1.4). This is the materialization
   runtime; **no dbt runtime required** (Q-dbt).
3. **WorkOS-backed auth** — proven OIDC path (Q3); the only real unknown is the authZ model.
4. **Iceberg tables as the external-BI / handoff + client-side (DuckDB-WASM) surface** — a
   standard catalog for data engineers *and* an in-browser preview path, retiring per-org
   pg_duckdb provisioning (`[C4]`) and the dbt-zip.

**Keep-build (do not touch):**
5. **Ibis as the definition compiler** (`[A26]`) — operations stay the source of truth;
   Ibis emits the SQL that DuckDB executes (and can still eject a dbt project).
   Views/reports stay derived; Iceberg Views are export sinks.
6. **The design-intent audit log** — uniquely ours; complements Iceberg snapshots.

**Optional / later:** **dbt as orchestrator** — only if the model DAG grows complex enough
to warrant `dbt run` in-process. Keep the dbt *eject* as the portable handoff format now.

**Concrete first slice for the spike to prove (days, non-prod), single-tenant:**
- Stand up **one org's** LakeKeeper Server pointed at WorkOS (`OPENID_PROVIDER_URI` =
  AuthKit issuer); confirm a WorkOS user token authenticates and auto-provisions (Q3).
- Create one **LakeKeeper Project** (= a dc project) with a default Warehouse (our S3
  prefix); leave Namespace at the default.
- **Prove the write path (no dbt):** take an existing dataset's Ibis-compiled SQL and run
  `INSERT INTO <iceberg_table> SELECT …` from DuckDB `ATTACH`ed to the LakeKeeper warehouse
  (`CREATE SECRET` + OAuth2); confirm a snapshot commits. This is GA on DuckDB v1.4+, so it
  should be low-drama — the point is to confirm the LakeKeeper auth + credential-vending
  handshake end-to-end.
- Confirm a reader (DuckDB Iceberg scan, server-side) queries the materialized table, and
  that re-deriving from operations reproduces it — proving materialization is a derived
  cache, not stored SQL (protects `[A26]`).
- **Stretch:** repeat the read from **DuckDB-WASM** in the browser to validate the
  client-side preview path (catalog OAuth + `httpfs`/CORS from the browser is the real
  unknown here, not the SQL).
- Decide the authZ boundary: LakeKeeper-authoritative for catalog objects vs.
  trust-the-proxy. This is the real fork, and it's an authorization decision, not a
  storage one.

**Open forks a DESIGN wave must own (not blockers to the spike):**
- Authority for `projects`: dual-write mirror (low risk) vs. LakeKeeper Project as SoT
  (full buy) — Q2.
- **Control-plane shape:** where org-create + auth-proxy + ui-state consolidate into a
  control plane that provisions each org's LakeKeeper Server, and whether Namespaces stay
  unimplemented or a default namespace is baked into the per-tenant build.
- Parquet→Iceberg migration shape (expand/contract, coexistence) — was a stated non-goal;
  the spike can register-in-place without rewriting data to keep it cheap.
- Reconciling with `[A52]` (View/Report normalization, PROPOSED) so the Iceberg-sink
  export aligns with the shared Relation IR rather than fighting it.

**Bottom line:** the honest buy-vs-build answer is *yes, buy the catalog/management/audit
plane, keep building the compile plane.* The earlier DECLINE conflated the two.
