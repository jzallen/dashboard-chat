<!-- DES-ENFORCEMENT : exempt -->
# C4 Diagrams — Extract Dataset Query Port

## L3 Component — Current state (problem)

```mermaid
flowchart LR
  subgraph caller["app.use_cases.dataset"]
    DS["DatasetService.fetch_dataset"]
  end
  subgraph models["app.models (domain)"]
    DSET["Dataset (frozen dataclass)"]
    DSET_QPR["query_preview_rows()<br/>~40 lines<br/>asyncpg + COPY + macros"]
    DSET_NCM["_needs_custom_case_macros()"]
    DSET --> DSET_QPR
    DSET --> DSET_NCM
  end
  subgraph infra["infrastructure"]
    POOL["app.database.get_query_engine_pool<br/>(asyncpg pool)"]
    MACROS["app.utils.sql_functions.ALL_MACROS"]
    PGDUCK["pg_duckdb / duckdb.raw_query"]
  end

  DS -- "calls" --> DSET_QPR
  DSET_QPR -- "acquires connection from" --> POOL
  DSET_QPR -- "registers macros from" --> MACROS
  DSET_QPR -- "executes COPY-to-stdout against" --> PGDUCK

  classDef bad fill:#fdd,stroke:#a00,stroke-width:2px;
  class DSET_QPR bad;
  class DSET_NCM bad;
```

**Smell:** the domain model (`models/`) imports from `database`, `utils.sql_functions`, and indirectly speaks asyncpg + pg_duckdb wire protocol. Three infrastructure dependencies cross the model boundary.

---

## L3 Component — Proposed state (Option α)

```mermaid
flowchart LR
  subgraph caller["app.use_cases.dataset"]
    DS["DatasetService.fetch_dataset"]
  end
  subgraph models["app.models (domain — pure)"]
    DSET["Dataset (frozen dataclass)"]
    DSET_PRED["requires_custom_case_macros()<br/>(public predicate, pure)"]
    DSET_SQL["staging_sql / display_sql<br/>(Ibis-compiled, ADR-007)"]
    DSET --> DSET_PRED
    DSET --> DSET_SQL
  end
  subgraph port["app.query_engine (NEW)"]
    QEP["QueryEnginePort (Protocol)<br/>execute_dataset_preview()<br/>probe()"]
    ADP["PgDuckDBQueryEngineAdapter<br/>asyncpg + COPY + macros"]
    ADP -. "implements" .-> QEP
  end
  subgraph infra["infrastructure"]
    POOL["app.database.get_query_engine_pool"]
    MACROS["app.utils.sql_functions.ALL_MACROS"]
    PGDUCK["pg_duckdb / duckdb.raw_query"]
  end
  subgraph di["composition root"]
    RC["RepositoryContainer.query_engine"]
  end

  DS -- "calls execute_dataset_preview(dataset, limit) on" --> QEP
  QEP -. "wired by" .-> RC
  RC -- "instantiates" --> ADP
  ADP -- "reads staging_sql + s3_path from" --> DSET
  ADP -- "checks requires_custom_case_macros() on" --> DSET
  ADP -- "acquires connection from" --> POOL
  ADP -- "registers macros from" --> MACROS
  ADP -- "executes COPY-to-stdout against" --> PGDUCK

  classDef pure fill:#dfd,stroke:#070,stroke-width:1px;
  classDef adapter fill:#ddf,stroke:#007,stroke-width:1px;
  class DSET pure;
  class DSET_PRED pure;
  class DSET_SQL pure;
  class ADP adapter;
  class QEP adapter;
```

**Result:** model has zero infrastructure imports. All asyncpg/COPY/pg_duckdb knowledge lives behind `QueryEnginePort`. The Protocol convention mirrors `LakeRepository`.

---

## Sequence — COPY-from-stdout preview-row flow (proposed)

This sequence is the **non-negotiable** path: the COPY-to-stdout route exists because asyncpg's Describe phase rejects DuckDB's UNKNOWN type from `duckdb.query()`. Documented in `_pg_duckdb_query.py` and `dataset.py:209–213`. The refactor preserves it byte-for-byte.

```mermaid
sequenceDiagram
  autonumber
  participant Caller as DatasetService.fetch_dataset
  participant Port as QueryEnginePort
  participant Adapter as PgDuckDBQueryEngineAdapter
  participant Pool as asyncpg Pool
  participant Conn as asyncpg Connection
  participant PG as pg_duckdb

  Caller->>Port: execute_dataset_preview(dataset, limit=10)
  Port->>Adapter: (Protocol dispatch)
  Adapter->>Adapter: staging = dataset.staging_sql
  alt staging starts with "-- Error"
    Adapter-->>Caller: return []
  else staging is valid
    Adapter->>Adapter: rebind FROM "<dataset.name>" to read_parquet(s3_path)
    Adapter->>Pool: acquire()
    Pool-->>Adapter: connection
    opt dataset.requires_custom_case_macros()
      loop for macro_sql in ALL_MACROS
        Adapter->>Conn: execute("SELECT duckdb.raw_query($1)", macro_sql)
        Note over Conn,PG: pg_duckdb runs CREATE MACRO against<br/>this connection's DuckDB instance.<br/>Macros are connection-scoped DDL.
      end
    end
    Adapter->>Adapter: build inner_sql with to_json wrapper +<br/>LIMIT — bypasses asyncpg Describe phase<br/>by routing through duckdb.query()
    Adapter->>Conn: copy_from_query(<br/>"SELECT (r['row'])::text FROM duckdb.query($1) r",<br/>inner_sql, output=buf)
    Note over Conn,PG: COPY protocol streams text without<br/>Describe — DuckDB executes inner_sql<br/>(transforms applied) inside duckdb.query().
    Conn-->>Adapter: buf bytes (one JSON object per line)
    Adapter->>Adapter: parse buf -> list[dict]
    Adapter->>Pool: release (via async with)
    Adapter-->>Caller: list[dict[str, Any]]
  end
```

**What MUST not change between current and proposed:**

- The exact `outer_sql` constant: `"SELECT (r['row'])::text FROM duckdb.query($1) r"`.
- The exact `inner_sql` shape: `"SELECT CAST(to_json(t) AS VARCHAR) AS row FROM ({transformed_sql}) t LIMIT {limit}"`.
- The macro-DDL shim: `await conn.execute("SELECT duckdb.raw_query($1)", macro_sql)` (positional arg, not interpolated).
- The order of operations: macros first (when needed), COPY second.

These are pinned by characterization tests (`test_dataset.py:963–970, :1003–1004`), which **must move with the code in DELIVER, not rewrite themselves to fit the new shape.** The Iron Rule applies.
