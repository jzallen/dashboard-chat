# NFR-H3: PostgreSQL Wire Protocol

## Tag

H3 — Handoff: Interoperability

## Invariant

> External SQL access SHALL use standard PostgreSQL wire protocol. Any SQL client, BI tool, ODBC/JDBC driver, or ORM SHALL connect without custom drivers.

## Status

**Implemented**

## Verification Method

Connect to the query engine using multiple standard PostgreSQL clients (psql, DBeaver, a JDBC driver, an ODBC driver) and confirm successful query execution without custom drivers.

## Related

- [ADR-003: pg_duckdb](../decisions/adrs.md)
