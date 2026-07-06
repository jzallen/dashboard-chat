# Slice 03 — Materialize a dataset via DuckDB, no dbt → snapshot commits

**Story:** US-3 · **Sub-job:** SJ-3 · **Plane:** Execution/materialization + Catalog/storage · **Effort:** ~1 day

## Goal (one sentence)
Materialize a chat-authored dataset as an Iceberg table by running its Ibis-compiled SQL through DuckDB directly into the LakeKeeper Warehouse (`INSERT INTO … SELECT`, no dbt) and confirm a snapshot commits — proving the credential-vending + GA write path end-to-end.

## IN scope
- Take an existing dataset's `${ibis_compiled_sql}` (re-derived from its persisted operations by Ibis — never hand-edited).
- DuckDB `ATTACH`es the LakeKeeper Warehouse (`CREATE SECRET` + OAuth2 using the Slice-01 token flow) and runs `INSERT INTO ${iceberg_table_ref} SELECT ${ibis_compiled_sql}`.
- Confirm a snapshot commits and `${snapshot_id}` is returned; confirm **no dbt process** is invoked.
- The Iceberg table schema + partition spec stand in for `schema_config` JSON (`models/dataset.py:94`) for this dataset.

## OUT scope
- The determinism **proof** (Slice 04 — but note the probe is born the moment this table exists; 03+04 are the skeleton rib).
- Reading the table back (Slice 05).
- `UPDATE`/`DELETE`/`MERGE` write modes (append/overwrite is enough for the skeleton).
- Bulk migration of other datasets (register-in-place is a DESIGN fork).

## Learning hypothesis
**Disproves** that DuckDB can run `INSERT INTO <iceberg_table> SELECT <ibis-compiled-sql>` against the LakeKeeper Warehouse (`CREATE SECRET` + OAuth2) and **commit a snapshot with no dbt runtime**. If the credential-vending handshake or the GA write path fails, the "no dbt materialization runtime" premise (`../discover/buy-vs-build.md` Q-dbt.2) fails and the materialization plane needs rethinking.
**Confirms** (if it succeeds) that the minimal materialization runtime is backend → DuckDB → `INSERT INTO` LakeKeeper, with no new heavy runtime dependency.

## Acceptance criteria
- AC1: Running the dataset's Ibis-compiled SQL through DuckDB into the Warehouse commits an Iceberg snapshot and returns `${snapshot_id}` (production dataset, real S3 warehouse).
- AC2: **No dbt process is invoked** at any point in the write path (assert by process/inventory — the runtime dependency is DuckDB only).
- AC3: The SQL executed is the Ibis-compiled SQL derived from the persisted operations, **not** a hand-edited or catalog-sourced string (the ADR-026 fence — asserted against the compile path).

## Dependencies
BlockedBy Slice 02 (needs a Project + Warehouse to write into). Produces `${iceberg_table_ref}` + `${snapshot_id}` that Slices 04 and 05 consume. Reuses the Slice-01 token flow for `CREATE SECRET` + OAuth2.

## Dogfood moment
Materialize a real dataset you authored via chat and see a committed snapshot id — with `dbt` nowhere in the process list.

## Reference class
DuckDB → LakeKeeper Iceberg write is **GA** (DuckDB v1.4+, Sep 2025): `ATTACH` a REST catalog via `CREATE SECRET` + OAuth2, `CREATE TABLE`/`INSERT` commit snapshots. Low-drama on the SQL; the point of the slice is confirming the **auth + credential-vending handshake** end-to-end (`../discover/buy-vs-build.md` "Concrete first slice").
