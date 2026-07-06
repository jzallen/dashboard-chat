# Story Map — lakekeeper-catalog-backend

**Wave:** DISCUSS · **Area:** backend (repository seam) + operator loop · **Job:** JOB-005 · **Scope:** single-tenant, non-prod walking skeleton of the scoped catalog/materialization BUY (`../discover/buy-vs-build.md`). Bulk Parquet→Iceberg migration, org-lifecycle control plane, and the authority/authZ **decisions** are OUT — see guardrails.

## Backbone (operator / data-engineer loop, left → right)

```
 AUTH THE CATALOG   →  REPRESENT A       →  MATERIALIZE       →  PROVE IT'S A      →  HAND OFF
 to WorkOS             PROJECT              (no dbt)             DERIVED CACHE        (read it back)
 ───────────           ───────────          ───────────          ───────────          ───────────
 WorkOS token          dc project →         INSERT INTO          re-derive ==         reader queries
 authenticates &       LakeKeeper Project   <iceberg_table>      materialized;        the Iceberg table
 auto-provisions       + default Warehouse  SELECT <ibis-sql>;   probe PASSES with    from the catalog
 a user                at the S3 prefix      snapshot commits     LakeKeeper OFFLINE   (stretch: WASM)
```

Each backbone step is a sub-job (`jtbd-job-stories.md` SJ-1..SJ-5) and maps to a
plane in `../discover/buy-vs-build.md`.

## Walking skeleton

**Yes — the walking skeleton is the DISCOVER "concrete first slice"**
(`../discover/buy-vs-build.md` "Concrete first slice for the spike to prove"). It is a
thin end-to-end vertical slice through **all five** backbone steps for **one** dataset
in **one** tenant, non-prod: auth → represent → materialize → prove → read back. The
rib to build is the credential + write + read path proven against the ADR-026
invariant. It is deliberately narrow (one dataset, one project, default Namespace) so
the two highest-uncertainty unknowns — the WorkOS↔LakeKeeper↔DuckDB credential
handshake and determinism-under-materialization — are exercised first and cheaply.

## Slices (elephant-carpaccio — each ships end-to-end in ≤1 day; the write+prove pair is the skeleton)

| Slice | Title | Sub-job | Story | Plane | Learning hypothesis (disproves if it fails) |
|---|---|---|---|---|---|
| **01** | Catalog authenticates to WorkOS + user auto-provisions | SJ-1 | US-1 | Auth | Disproves that one org's LakeKeeper Server can trust the **same** WorkOS AuthKit issuer and **auto-provision** a user from a real WorkOS token **without** a second identity store or a user-sync job. If a token that works for the app can't authenticate the catalog, the whole "one identity source" premise fails. |
| **02** | dc project → LakeKeeper Project + Warehouse, behind the port | SJ-2 | US-2 | Management + Catalog | Disproves that a dc project can be represented as a LakeKeeper Project with a default Warehouse **behind the existing project repository port (ADR-020)** with **zero** change to routing/controllers/use-cases. If the adapter forces a controller or use-case change, the "LakeKeeper as a repository" seam is wrong. |
| **03** | Materialize a dataset via DuckDB, no dbt → snapshot commits | SJ-3 | US-3 | Execution/materialization | Disproves that DuckDB can run `INSERT INTO <iceberg_table> SELECT <ibis-compiled-sql>` against the LakeKeeper Warehouse (`CREATE SECRET` + OAuth2) and **commit a snapshot with no dbt runtime**. If the credential-vending handshake or the GA write path fails, the "no dbt materialization runtime" premise fails. |
| **04** | Prove the ADR-026 materialization corollary | SJ-4 | US-4 | Compile invariant | Disproves that the materialized table is a **derived cache**: that re-deriving from operations reproduces it AND that compilation passes with **LakeKeeper offline**. If the probe can't pass offline, the integration violates ADR-026 and must be reworked — this is the load-bearing slice. |
| **05** | Read back: a reader queries the Iceberg table (stretch: WASM) | SJ-5 | US-5 | Catalog / handoff | Disproves that a reader can query the materialized table **through the catalog** (server-side DuckDB scan) as a real handoff surface. Stretch disproves the DuckDB-WASM browser path (catalog OAuth + `httpfs`/CORS — the real client-side unknown). |

Slices **03 + 04** together are the walking-skeleton rib (write then prove); they may
be delivered as one thin vertical if that keeps each within a day, but 04's probe must
exist the moment 03's table does. Standing up the LakeKeeper container is
`@infrastructure`, folded **into Slice 01** (it is what makes the auth check runnable)
— **not a slice of its own**.

## Dependency chain

```
  01 auth (+ @infra: stand up the org's LakeKeeper Server) ─┬─> 02 project (needs an authenticated catalog)
                                                            │
  02 project + Warehouse ────────────────────────────────────> 03 materialize (needs a Warehouse to write into)
                                                            │
  03 materialize (snapshot) ─────────────────────────────────> 04 PROVE (needs a materialized table to prove)
                                                            │
  04 prove ─────────────────────────────────────────────────> 05 read back (a proven cache is safe to hand off)
```

- **02 blockedBy 01** — you cannot create a Project without an authenticated catalog.
- **03 blockedBy 02** — the write targets the project's Warehouse.
- **04 blockedBy 03** — there must be a materialized table to prove is a cache.
- **05 blockedBy 04** — a table is only safe to hand off once it is proven a derived
  cache (else a consumer could mistake a stale/authoritative table for truth).
- **The determinism probe (04) is the safety net** — it does not ship "later"; it is
  born with the first materialization (03) and re-asserted by 05.

## Scope Assessment: PASS — 5 stories, 1 primary bounded context (+2 external systems), estimated ~5 days

Assessed against the Elephant-Carpaccio oversized signals (any 2+ → oversized):

| Oversized signal | This feature | Trips? |
|---|---|---|
| >10 user stories | 5 stories | No |
| >3 bounded contexts / modules | 1 primary (backend Org/Project + Dataset seam via the repository port); LakeKeeper + DuckDB are **external systems** integrated behind the port/engine, not new internal contexts | No |
| Walking skeleton needs >5 integration points | 3 (WorkOS↔LakeKeeper auth; backend↔LakeKeeper Management API; DuckDB↔LakeKeeper warehouse write/read) | No |
| Estimated effort >2 weeks | ~5 days for the single-tenant non-prod skeleton | No |
| Multiple independent shippable outcomes | One coherent outcome (a data engineer gets a real Iceberg table, provably a derived cache); the slices are a single vertical, not independently shippable products | No |

**0 of 5 signals trip → right-sized.** The feature is intentionally scoped to the
walking skeleton; the larger bets (bulk migration, control plane, authority/authZ
decisions) are explicit DESIGN open forks, not in-scope stories. No split required.

## Priority Rationale

Order by **learning leverage** (highest-uncertainty first), then the dependency chain,
then handoff value. Full order + dogfood cadence in `prioritization.md`.

1. **Highest uncertainty first.** The two genuine unknowns are the **credential
   handshake** (WorkOS↔LakeKeeper↔DuckDB end-to-end — US-1 then US-3) and
   **determinism-under-materialization** (US-4). These carry the most risk of
   invalidating the scoped BUY, so they are exercised earliest. US-1 (auth) is the
   gate for everything and the first place the handshake can break; US-4 (the probe)
   is the load-bearing invariant.
2. **Then the dependency chain.** Auth (01) → project (02) → materialize (03) → prove
   (04) → read back (05) is a strict chain; each step needs the prior artifact.
3. **The probe is not deferred.** Because the ADR-026 anxiety is the dominant
   restraining force (`jtbd-job-stories.md` four-forces), the determinism probe (04)
   is born with the first materialization, not added at the end — the safety net ships
   with the risk.
4. **The DuckDB-WASM read is a stretch, last.** It is the only step whose real unknown
   (browser catalog OAuth + `httpfs`/CORS) is orthogonal to the core BUY; deferring it
   does not block the handoff value.

## Scope guardrails (single-tenant, non-prod walking skeleton)

- **OUT — the org-lifecycle control plane.** One LakeKeeper **Server per org** is the
  tenancy model, but *provisioning* per-org Servers belongs to a FUTURE control plane
  (`../discover/buy-vs-build.md` "Tenancy & control-plane assumptions"). This feature
  starts inside one already-provisioned tenant.
- **OUT — bulk Parquet→Iceberg migration.** The skeleton materializes **one** dataset
  end-to-end; register-in-place vs rewrite is a DESIGN open fork.
- **OUT — the authority-model decision** (dual-write mirror vs LakeKeeper-as-SoT) and
  the **authZ-boundary decision** (OpenFGA-authoritative vs trust-the-proxy). These
  are **surfaced** for DESIGN, not chosen here.
- **OUT — dbt as runtime.** dbt stays the optional eject/handoff format; the write path
  is DuckDB-direct (`../discover/buy-vs-build.md` Q-dbt).
- **OUT — Namespaces.** A single default Namespace; domain segregation deferred.

## Non-story (cross-cutting guard, not a slice of its own)

The **ADR-026 determinism probe** is delivered *inside* Slice 04 (it is what makes the
materialization safe) and re-asserted by Slice 05 (a read must never mistake the cache
for an authority). It is the safety net the scoped BUY rides on — not separately
shippable user value.

See `prioritization.md` for execution-order rationale and `../slices/` for the
per-slice briefs.
