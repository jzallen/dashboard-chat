# Slice 05 — Read back: a reader queries the Iceberg table (stretch: WASM)

**Story:** US-5 · **Sub-job:** SJ-5 · **Plane:** Catalog / handoff / client-side · **Effort:** ~1 day (core) + stretch

## Goal (one sentence)
Prove the handoff: a reader queries the materialized Iceberg table **through the catalog** (server-side DuckDB scan) and gets rows matching the committed snapshot — with a stretch that the same read works from DuckDB-WASM in the browser — so a data engineer has a real Iceberg table in a standard catalog rather than a dbt-zip.

## IN scope
- A server-side DuckDB Iceberg scan of `${iceberg_table_ref}` **through the catalog**, returning rows that match `${snapshot_id}`.
- Confirm the reader reads the **materialized derived cache**, not stored SQL (re-assert Slice 04's corollary on the read path).
- **Stretch:** the same read from DuckDB-WASM in the browser (catalog OAuth + `httpfs`/CORS) returning the same rows.

## OUT scope
- Retiring the pg_duckdb BI-provisioning path in production (this proves the *replacement* read surface works; the cutover is a later decision).
- The **authZ boundary** decision governing who may read what (LakeKeeper OpenFGA-authoritative vs trust-the-proxy) — **surfaced as a DESIGN open fork**; the slice runs under a documented interim posture.

## Learning hypothesis
**Disproves** that a reader can query the materialized table **through the catalog** as a real handoff surface. If the server-side scan can't read the table via the catalog, the "hand a data engineer real Iceberg tables in a standard catalog" value (`../discover/buy-vs-build.md` recommendation #4) fails.
**Stretch disproves** the DuckDB-WASM browser path — the real client-side unknown is catalog OAuth + `httpfs`/CORS from the browser, **not** the SQL (`../discover/buy-vs-build.md` Q-dbt.3).
**Confirms** (if it succeeds) that the catalog is a live standard consumption surface, retiring the dbt-zip as the handoff.

## Acceptance criteria
- AC1: A server-side DuckDB Iceberg scan through the catalog returns rows matching the committed snapshot (production dataset, real materialized table).
- AC2: The reader reads the materialized table (a derived cache); it does **not** read back a stored SQL/view definition (ADR-026 corollary re-asserted on the read path).
- AC3 (stretch): DuckDB-WASM in the browser attaches the catalog over OAuth and reads the table via `httpfs`, returning the same rows as the server-side scan — or, if it fails, the failure is characterized as an OAuth/CORS/`httpfs` browser-credential issue and recorded for DESIGN (not a SQL problem).

## Dependencies
BlockedBy Slice 04 (a table is only safe to hand off once it is proven a derived cache). Consumes `${iceberg_table_ref}` + `${snapshot_id}`.

## Dogfood moment
Query your own materialized dataset through the catalog with a plain DuckDB `SELECT` and get the rows back; (stretch) open a browser tab and read the same table from DuckDB-WASM.

## Reference class
DuckDB (server-side or WASM) `ATTACH`es a REST catalog and scans Iceberg tables directly; dbt has zero role in the read path. Server-side is low risk; the browser path is the deliberately-flagged stretch unknown (catalog OAuth + `httpfs`/CORS).
