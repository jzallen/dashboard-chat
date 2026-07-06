# Prioritization — lakekeeper-catalog-backend

**Ordering principle:** highest **learning leverage** first (the two genuine unknowns —
the WorkOS↔LakeKeeper↔DuckDB credential handshake and determinism-under-materialization
— go earliest), then the strict dependency chain, then handoff value. The determinism
probe (the safety net) ships **with** the first materialization, not after it.

## Recommended execution order

| Order | Slice | Why this position | Reference class / risk |
|---|---|---|---|
| 1 | **01 — catalog authenticates to WorkOS** | The first hop of the credential handshake and the gate for everything else. Highest early uncertainty on the auth path even though the OIDC pattern itself is proven (`../discover/buy-vs-build.md` Q3). Folds in the `@infrastructure` "stand up the org's Server" work so there is no pure-infra slice. | Low/medium — standard OIDC; WorkOS AuthKit exposes the discovery doc and we already consume its JWKS. The authZ boundary is deliberately deferred to DESIGN. |
| 2 | **02 — dc project → LakeKeeper Project + Warehouse** | BlockedBy 01. Proves the "LakeKeeper as a repository" seam (ADR-020) with zero application-layer change — the architectural claim that makes the whole integration cheap. | Medium — external HTTP service outside the SQLAlchemy transaction; the atomicity/authority *decision* is a DESIGN fork, so the slice uses the low-risk shape to get end-to-end. |
| 3 | **03 — materialize via DuckDB, no dbt** | BlockedBy 02. The second, decisive half of the credential handshake (DuckDB `ATTACH` + `CREATE SECRET` + OAuth2 write) and the "no dbt runtime" premise. | Medium — DuckDB→LakeKeeper write is GA (v1.4+); the risk is the credential-vending handshake, not the SQL. |
| 4 | **04 — prove the ADR-026 corollary** | BlockedBy 03; **the load-bearing slice.** The determinism probe is born the moment a materialized table exists — the ADR-026 anxiety (dominant restraining force) is discharged by proof here. Highest *invariant* risk: if it can't pass offline, the integration is non-compliant and reworks. | Medium — extends the existing ADR-051-style reproducibility probe to assert it holds with the catalog **offline** and that re-derive == materialized. |
| 5 | **05 — read back / handoff (stretch: WASM)** | BlockedBy 04 (a table is only safe to hand off once proven a cache). Delivers the data-engineer handoff value. The DuckDB-WASM browser read is a **stretch**, last, because its unknown (catalog OAuth + `httpfs`/CORS) is orthogonal to the core BUY. | Low (server-side) / medium (WASM stretch) — the browser credential/CORS path is the only real client-side unknown. |

## Dogfood cadence

- After **01**: present your own real WorkOS token to the running catalog and watch a user auto-provision; present a wrong-audience token and watch it get rejected (same day).
- After **02**: create a real dc project through the normal port and see a LakeKeeper Project + Warehouse appear at the project's actual S3 prefix — with no controller change in the diff.
- After **03**: materialize a real chat-authored dataset and read back a committed `${snapshot_id}` — with `dbt` nowhere in the process list.
- After **04**: switch LakeKeeper off and watch compilation still succeed and the probe PASS; re-derive the table and watch it match.
- After **05**: query your own materialized dataset through the catalog with a plain DuckDB `SELECT`; (stretch) read the same table from DuckDB-WASM in a browser tab.

## Learning-leverage note

The two highest-variance unknowns are the **credential handshake** (spanning Slice 01's
authN and Slice 03's DuckDB write) and **determinism-under-materialization** (Slice 04).
They are deliberately front-loaded: 01 first (the gate + first handshake hop), 03/04 as
the walking-skeleton rib (write then prove). Slice 02's uncertainty is architectural
(does the repository seam hold with zero app-layer change) and is cheap to falsify
early. Slice 05's server-side read is low-variance; its WASM stretch carries the only
remaining client-side unknown and is intentionally last so it never blocks the handoff.

## Note on decisions deferred to DESIGN (no silent choices)

Three real forks are **surfaced, not chosen** in these slices — and each slice that
brushes a fork says so explicitly rather than quietly picking a side:

- **Project authority model** (dual-write mirror vs LakeKeeper-as-SoT) — Slice 02 uses
  the low-risk shape to get end-to-end but does not ratify SoT.
- **AuthZ boundary** (LakeKeeper OpenFGA-authoritative vs trust-the-proxy) — Slices 01
  and 05 run under a documented interim posture.
- **Parquet→Iceberg migration shape** — the skeleton materializes one dataset;
  register-in-place vs rewrite is left to DESIGN.

See `wave-decisions.md` §Upstream Changes for the full list handed to DESIGN.
