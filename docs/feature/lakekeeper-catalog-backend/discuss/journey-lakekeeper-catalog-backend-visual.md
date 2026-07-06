# Journey (visual) — Standing up an org's Iceberg catalog and handing a data engineer real tables

**Wave:** DISCUSS · **Area:** backend (repository seam) + operator/data-engineer loop · **Job:** JOB-005 · **Provisional journey:** J-009 (LakeKeeper catalog-backend operator loop)

The "user" here is an **internal engineer / operator** (who provisions an org's
catalog and materializes datasets) and a **data engineer** (who consumes the result
as Iceberg tables) — not an end user of the product GUI. The journey is the
provision → represent → materialize → prove → hand-off loop. Every step has a
concrete observable (a WorkOS-authenticated call that auto-provisions a user, a
committed LakeKeeper Project id, a committed Iceberg snapshot id, a determinism-probe
PASS line, a `SELECT` result). This journey is the **walking skeleton** described in
`../discover/buy-vs-build.md` ("Concrete first slice for the spike to prove").

## Mental model (operator / data-engineer vocabulary)

- "I want this org's catalog to trust the **same WorkOS login** the app already uses —
  I don't want a second user list to keep in sync."
- "A **dc project** should just *be* a catalog Project with its own storage location —
  not a hand-rolled `datasets/{project_id}/…` path plus a `schema_config` blob."
- "When a dataset's operations are settled, I want to **materialize it as a real
  table** by running the SQL we already compile — not stand up yet another pg_duckdb
  schema and role."
- "I need to **prove** that materializing didn't secretly make the catalog the source
  of truth — that I can rebuild the table from the operations and it matches, and that
  compilation still works with the catalog switched off."
- "Then I hand a **data engineer a real Iceberg table** in a catalog their tools
  already speak — not a dbt-zip."

The operator does not think in "OpenFGA vs trust-the-proxy", "`CREATE SECRET` +
OAuth2", or "manifest files". Those are implementation concerns DESIGN owns. The
operator reads: *a user auto-provisioned*, *a Project id*, *a snapshot id*, *a probe
result*, *a query result*.

## Happy path + emotional arc

```
 STEP 1              STEP 2              STEP 3               STEP 4                STEP 5
 Point the org's  →  Represent a dc   →  Materialize a     →  PROVE it's a       →  Hand off: a reader
 catalog at          project as a        dataset via          derived cache         queries the Iceberg
 WorkOS              LakeKeeper          DuckDB (no dbt)       (ADR-026 corollary)   table from the catalog
 ───────────         Project +          ───────────           ───────────           ───────────
 a WorkOS token      Warehouse          INSERT INTO            re-derive == the      server-side DuckDB
 authenticates &     ───────────        <iceberg_table>        materialized table;   scan returns rows;
 auto-provisions     Project id +       SELECT <ibis-sql>;     determinism probe     (stretch) DuckDB-WASM
 a user              default            a snapshot commits     PASSES with the       reads it in-browser
                     Warehouse at       ───────────            catalog OFFLINE
                     the S3 prefix      snapshot_id returned

 emotion:            emotion:           emotion:              emotion:              emotion:
 "does our auth      "a project is      "it wrote a real      "it's a cache, not    "a data engineer
  even reach it?"     just a Project"    table — and no dbt"    an authority —        gets real Iceberg
  (uncertain)         (oriented)         (encouraged)           I can prove it"       tables"
                                                                (reassured)           (confident)

 confidence:  ▁▁▁▁▁▁→▃▃▃▃▃▃→▅▅▅▅▅▅→▆▆▆▆▆▆→███████  (builds monotonically; the ADR-026 proof is the pivot)
```

The emotional pivot is **Step 4**: the determinism anxiety (the dominant restraining
force, `jtbd-job-stories.md` four-forces) is *discharged by proof*, not asserted
away. Confidence does not complete until the probe passes with the catalog offline.

## Error / recovery paths

These are real failure modes of the loop. Note the load-bearing one: **the
determinism probe must still pass when LakeKeeper is offline** — that is not an error
path to recover from, it is the invariant the whole design rests on.

| Where | Failure | Target behavior | Recovery |
|---|---|---|---|
| Step 1 | WorkOS token is rejected by the catalog (issuer/audience misconfig) | Catalog rejects with a clear authN error; no user is provisioned from an unverified token | Operator fixes `OPENID_PROVIDER_URI`/audience to the AuthKit issuer; retries; user auto-provisions |
| Step 2 | LakeKeeper Project create fails / times out (external HTTP, outside the SQLAlchemy transaction) | The project use case surfaces a clear failure; **no orphaned half-state** is silently left behind (authority model — dual-write vs SoT — is the DESIGN open fork that governs the exact compensation) | Operator retries; DESIGN decides the atomicity model (`../discover/buy-vs-build.md` Q2 #1) |
| Step 3 | Snapshot commit fails (credential-vending or write error) | The materialization reports failure with the reason; **no partial/uncommitted table** is presented as materialized | Operator re-runs the materialization; the operations are unchanged, so the write is idempotent-by-rebuild |
| **Step 4** | **LakeKeeper is offline at compile time** | **Compilation still succeeds** — SQL is re-derived from persisted operations alone; the determinism probe PASSES with the catalog disconnected (`adr-051...:283-289`) | **N/A — this is the invariant, not a recovery.** If compilation needs the catalog, the integration is non-compliant and must be reworked before shipping |
| Step 4 | Re-derived table ≠ materialized table | The probe FAILS the slice — materialization is not a faithful cache | Fix the writer so `INSERT INTO … SELECT` uses the *same* Ibis-compiled SQL; never hand-edit the materialized table |
| Step 5 | authZ boundary undecided (reader authorized by LakeKeeper OpenFGA vs. trust-the-proxy) | The reader path works for the walking skeleton under a documented interim posture; the boundary is **surfaced as a DESIGN open fork**, not silently chosen | DESIGN decides LakeKeeper-authoritative vs trust-the-proxy (`../discover/buy-vs-build.md` Q3) |

## Step → expected output table

| Step | Entry point (what the operator/engineer runs) | Expected observable output |
|---|---|---|
| 1 Auth | A WorkOS user token presented to the org's LakeKeeper Server (`OPENID_PROVIDER_URI` = AuthKit issuer) | The request authenticates; a LakeKeeper user is auto-provisioned (keyed `oidc~<sub\|oid>`) — no user-sync job ran |
| 2 Project | Create a dc project through the existing project repository port (adapter → LakeKeeper Management API) | A `${lakekeeper_project_id}` exists with a default Warehouse at `${warehouse_prefix}` (the project's S3 prefix); the application layer (routing/controllers/use-cases) is unchanged |
| 3 Materialize | Run `INSERT INTO ${iceberg_table_ref} SELECT ${ibis_compiled_sql}` from DuckDB `ATTACH`ed to the Warehouse (`CREATE SECRET` + OAuth2) | A snapshot commits; `${snapshot_id}` is returned; **no dbt process ran** |
| 4 Prove | Run the determinism probe: re-derive the table from the persisted operations and compare; run compilation with LakeKeeper offline | Probe **PASSES**: re-derived == materialized; compilation succeeds with the catalog disconnected (`compile(ops) == compile(load_and_recompile(ops))`) |
| 5 Hand off | A reader runs a server-side DuckDB Iceberg scan of `${iceberg_table_ref}` via the catalog; (stretch) the same read from DuckDB-WASM in the browser | Rows come back matching the materialized snapshot; (stretch) the browser returns the same rows over catalog OAuth + `httpfs` |

## Boundary / non-goals for this journey (from DISCOVER)

- **Ibis stays the only compiler** (`[K2]`, ADR-026). The catalog never emits SQL and
  is never consulted at render time. Iceberg **Views** are export **sinks** only.
- **Org lifecycle is out of scope** — one LakeKeeper **Server per org** is the tenancy
  model, but *provisioning* the per-org Server belongs to a FUTURE control plane
  (`../discover/buy-vs-build.md` "Tenancy & control-plane assumptions"). This journey
  starts *inside* one already-provisioned tenant, at Project = dc project.
- **Namespace** stays at a single default (deferred).
- **Parquet→Iceberg migration shape** is a DESIGN open fork (register-in-place to keep
  it cheap); the walking skeleton uses one dataset end-to-end, not a bulk migration.

See `journey-lakekeeper-catalog-backend.yaml` for the structured contract and
`journey-lakekeeper-catalog-backend.feature` for the Gherkin.
