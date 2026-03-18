# Dashboard Chat Data Access Architecture Analysis

## Executive Summary

Dashboard Chat uses a layered architecture with three data access patterns:
1. **Metadata** (PostgreSQL/SQLite) - Project/dataset records and transform definitions
2. **Lake** (Parquet in MinIO/S3) - Actual data via Ibis + DuckDB
3. **Outbox** (PostgreSQL/SQLite) - Event sourcing for uploads/transforms

The frontend never queries data directly—it fetches metadata and SQL preview from the backend, which executes analytical queries on-demand via DuckDB.

---

## Data Flow Pipeline: Upload → Storage → Query

### Step 1: Upload (REST + Outbox)
**Endpoint**: `POST /api/uploads`
**Files**: `backend/app/routers/uploads.py`, `backend/app/use_cases/upload/upload_file.py`

1. Client sends CSV file with `project_id` (and optional `dataset_id` for re-uploads)
2. **upload_file** use case:
   - Validates CSV format and non-empty
   - Reads CSV with pandas, strips whitespace
   - Creates `UploadFileReceived` event in outbox table
   - Stores raw CSV bytes to S3/MinIO at `uploads/{project_id}/{filename}`
   - Returns `Upload` domain model with 10-row preview
3. Response includes:
   - `id`: Upload event UUID
   - `status`: "pending"
   - `preview_rows`: First 10 rows for client preview
   - `raw_storage_path`: Where file was stored

**Storage location**: `uploads/{project_id}/{filename}`

---

### Step 2: Dataset Creation (from Upload Event)
**Endpoint**: `POST /api/datasets`
**Files**: `backend/app/use_cases/dataset/create_dataset_from_upload.py`

1. Client calls with `upload_id` + optional `partition_fields` (e.g., ["date", "region"])
2. **create_dataset_from_upload** use case:
   - Fetches upload event from outbox by ID
   - Validates project exists
   - Reads raw CSV from S3/MinIO
   - Infers schema (maps columns to "text"/"number"/"boolean"/"select")
   - Computes column profiles (value stats injected into LLM prompts)
   - Converts CSV to **partitioned Parquet**:
     - Uses local tempfile + DuckDB to partition
     - Generates hive-style paths: `dataset_id/date=2024-01-01/region=US/part-0.parquet`
     - Uploads all parts to S3/MinIO
   - Creates `DatasetRecord` in metadata DB
   - Marks upload event as processed
3. **Dataset domain model** created with:
   - `id`: UUID
   - `name`: Default "New Dataset" (user can update)
   - `project_id`: Parent project UUID
   - `storage_path`: `datasets/{project_id}/{dataset_id}/` (with trailing /)
   - `schema_config`: `{"fields": {"col_name": {"type": "text"}, ...}}`
   - `partition_fields`: List of field names used for partitioning
   - `column_profiles`: Per-column value stats for LLM context
   - `preview_rows`: First 10 rows (executed via transforms pipeline)

**Storage location**: `datasets/{project_id}/{dataset_id}/date=2024-01-01/region=US/part-0.parquet` (hive-partitioned)

---

### Step 3: Metadata Persistence (SQLAlchemy)
**Files**: `backend/app/repositories/metadata/repository.py`, `backend/app/models/dataset.py`

**MetadataRepository** stores in PostgreSQL/SQLite:
- **ProjectRecord**: id, name, description, org_id, created_by, created_at, updated_at
- **DatasetRecord**:
  - `id`, `name`, `description`, `project_id` (FK)
  - `storage_path` (S3 path) - unique, indexed
  - `schema_config` (JSON) - field definitions
  - `partition_fields` (JSON) - hive partition field names
  - `column_profiles` (JSON) - per-column value stats
  - `created_at`, `updated_at`
  - Relationship: 1 project → many datasets
- **TransformRecord**: id, dataset_id (FK), name, description, status ('enabled'/'disabled'/'deleted'), 
  - filter type: `condition_json` (RAQB tree), `condition_sql`
  - clean/alias/map type: `target_column`, `expression_config`, `expression_sql`
  - `created_at` (used for ordering cleaning transforms)

All operations use `flush()` (not commit) — transaction management is at router level.

---

## Lake Repository: S3/MinIO + Ibis + DuckDB

**Files**: `backend/app/repositories/lake/repository.py`

### BaseLakeRepository (Abstract)
Base class providing data lake operations.

**Write operations** (boto3 to S3/MinIO):
- `write_raw_file(content, storage_path)` → stores raw bytes, returns s3:// path
- `write_csv_as_partitioned_parquet(csv_content, storage_prefix, partition_fields)` → converts CSV to hive-partitioned Parquet:
  1. Create local tempfile from CSV bytes
  2. Use DuckDB to partition: `COPY ... PARTITION_BY (field1, field2)`
  3. Upload all generated .parquet files via boto3
  4. Clean up local temp files
  5. Return s3:// prefix path

**Read operations** (Ibis + DuckDB):
- `read_parquet_preview(storage_path, limit=10)` → reads sample rows from Parquet
  - Supports both single files and partitioned datasets (path ending with `/`)
  - Returns list of dict[str, Any] with JSON serialization for date/datetime types
  - Uses glob pattern `s3://bucket/path/**/*.parquet` for partitioned data
  
- `get_parquet_row_count(storage_path)` → counts total rows
  - Uses same glob pattern for partitioned datasets
  
- `get_parquet_column_type(storage_path, column)` → returns DuckDB type string (e.g., "string", "float64")
  
- `preview_cleaning_operation(storage_path, target_column, expression_config, sample_limit=5)` → previews transform effect
  - Returns: `{"affected_count": N, "total_count": M, "samples": [...], "column_type": "..."}`
  - Used by transform preview endpoint before persisting

**Error handling**: `@handle_repository_exceptions` wraps S3 errors as `LakeRepositoryError`

### MinIOLakeRepository (Concrete Implementation)
- Creates boto3 S3 client configured for MinIO:
  - Endpoint: `http://{minio_endpoint}`
  - Credentials: `minio_access_key`, `minio_secret_key`
  - Signature: S3v4
  - Retry config from settings: `s3_max_retries`, `s3_connect_timeout`, `s3_read_timeout`

- `_configure_duckdb_s3(conn)` → Configures each DuckDB connection:
  ```sql
  INSTALL httpfs; LOAD httpfs;
  SET s3_endpoint='localhost:9000';
  SET s3_access_key_id='minioadmin';
  SET s3_secret_access_key='minioadmin';
  SET s3_use_ssl=false;
  SET s3_url_style='path';
  ```

### DuckDB + Ibis Integration
- Each read operation creates fresh Ibis connection: `ibis.duckdb.connect()`
- Configure S3 access per connection (MinIO or AWS S3)
- Read Parquet: `conn.read_parquet(s3://bucket/path or s3://bucket/path/**/*.parquet)`
- Execute Ibis expressions: `table.filter(...).select(...).execute()`
- Return pandas DataFrame, convert to JSON with ISO date format

---

## Dataset Domain Model: Query Building via Ibis

**Files**: `backend/app/models/dataset.py`

The **Dataset** domain model is the authoritative business object that aggregates transforms into SQL.

### Schema & Metadata
- `id`, `project_id`, `name`, `description`
- `schema_config`: `{"fields": {"col_name": {"type": "text|number|boolean|select"}, ...}}`
  - Maps column names to UI/LLM types (not SQL types)
  - Used by query builder and table UI
- `partition_fields`: List of hive partition field names (["date", "region"])
- `column_profiles`: `{"col_name": {"sample_values": [...], "unique_count": N, ...}}`
  - Injected into LLM system prompt for context
- `transforms`: List of Transform domain objects

### Transforms Pipeline (D3 Design)
Three-stage pipeline builds final query:

**Stage 1: MUTATE** (cleaning transforms)
- Apply column-level operations: trim, case (upper/lower/title/snake/kebab), fill_null, map_values
- Sorted by `created_at` to ensure deterministic order
- Each transform adds a column mutation via `.mutate(**{col: expr})`
- Converted from `expression_config` to Ibis expressions

**Stage 2: FILTER** (filter transforms)
- Apply row-level WHERE predicates from filter transforms
- Convert `condition_json` (RAQB tree) to Ibis filter predicates
- Aggregate multiple filters via `.filter(pred1, pred2, ...)`

**Stage 3: RENAME** (alias transforms)
- Apply column renames via `.rename({new_name: old_col})`

### Query Execution Methods

**`_get_connection()`** → Creates fresh Ibis DuckDB connection
- Detects storage type from config (MinIO or AWS S3)
- Calls `_configure_duckdb_s3(conn)` to set credentials
- Registers custom DuckDB macros (title_case, snake_case, kebab_case)
- Returns configured `ibis.BaseBackend`

**`_build_table()`** → Returns Ibis Table with all transforms applied
- Reads Parquet from S3: `conn.read_parquet(self._s3_path())`
- Fallback: if Parquet not found, builds table from schema_config
- Selects only columns in schema_config
- Applies three-stage pipeline (mutate → filter → rename)
- Returns final Ibis Table

**`staging_sql`** (property) → Compact SQL for execution
- Converts Ibis table to DuckDB SQL (no pretty printing)
- Used internally for preview queries
- Full S3 path in FROM clause

**`display_sql`** (property) → Human-readable SQL for UI
- Converts Ibis table to pretty-printed DuckDB SQL
- Uses dataset name as table alias
- Expands `SELECT *` to explicit column list
- Shown in dataset detail view

**`query_preview_rows(limit=10)`** → Executes staging SQL and returns rows
- Called via `asyncio.to_thread()` (blocking I/O)
- Returns JSON-serializable list of dicts
- Used by preview endpoints and dataset detail

### Schema Type Mapping
- Frontend schema types → DuckDB types:
  - "text" → "string"
  - "number" → "float64"
  - "boolean" → "boolean"
  - "select" → "string"

---

## Data Access Layers & Repositories

### RepositoryContainer (Dependency Injection)
**Files**: `backend/app/repositories/__init__.py`

Lazy-loads repositories via callable registry:
```python
RepositoryContainer(RestrictedSession(db)):
  'metadata_repository' → MetadataRepository(restricted_session)
  'lake_repository' → MinIOLakeRepository()
  'outbox_repository' → OutboxRepository(restricted_session)
```

Can override implementations for testing:
```python
repositories = {'metadata_repository': MockMetadataRepo, ...}
```

### Session Management
- **Context variable**: `_db_session: ContextVar[AsyncSession | None]`
- **Set by router dependency**: `use_db_context()` calls `set_session(db)`
- **Used by decorators**: `@with_repositories` fetches session from context
- **RestrictedSession**: Wraps AsyncSession, exposes only `execute/add/flush/refresh/delete/begin_nested`
  - Prevents accidental commits at repository level
  - Transaction mgmt happens at router/controller level

### Decorator Stack (Use Cases)
**Outer to inner**:
1. `@with_repositories` — Injects `RepositoryContainer`, commits on success, rollbacks on error
2. `@handle_returns` — Wraps result in `Result[Data, str]` from returns library

Example:
```python
@with_repositories
@handle_returns
async def get_dataset(dataset_id: str, *, repositories: RepositoryContainer):
    service = DatasetService(repositories)
    return await service.fetch_dataset(dataset_id)
```

---

## REST API: Frontend Data Access

### Endpoints for Table Data

**GET `/api/datasets/{dataset_id}`** → Full dataset with optional preview
- Query params:
  - `include_transforms=true` → Include transform definitions
  - `include_preview=false` → Include preview_rows (async, limited)
  - `preview_limit=10` → Max preview rows (1-100)
- Response: DatasetResponse
  ```json
  {
    "id": "uuid",
    "name": "Sales Data",
    "project_id": "uuid",
    "storage_path": "datasets/proj-123/ds-456/",
    "schema_config": {"fields": {"id": {"type": "number"}, ...}},
    "partition_fields": ["date", "region"],
    "transforms": [{...}, ...],
    "preview_rows": [{...}, ...],
    "staging_sql": "SELECT ... FROM s3://...",
    "created_at": "...",
    "updated_at": "..."
  }
  ```

**GET `/api/datasets`** → List datasets (filtered by project_id)
- Query param: `project_id` (optional)
- Response: Array of sparse dataset objects with links

**POST `/api/datasets/{dataset_id}/transforms`** → Batch-create transforms
- Body: `{"transforms": [{condition_json, condition_sql, ...}, ...]}`
- Transforms can be: filter, clean, alias, map
- Returns: `{"ok": true}` or error

**PATCH `/api/datasets/{dataset_id}/transforms`** → Batch-update transforms
- Body: `{"updates": [{"id": "...", "status": "disabled"}, ...]}`
- Supports soft-delete via `status: "deleted"`
- Returns: `{"ok": true}` or error

**POST `/api/datasets/{dataset_id}/transforms/preview`** → Preview cleaning operation
- Body: `{"target_column": "name", "expression_config": {"operation": "trim"}}`
- Returns: 
  ```json
  {
    "affected_count": 42,
    "total_count": 1000,
    "samples": [{"before": "  text  ", "after": "text"}, ...],
    "column_type": "string"
  }
  ```

### DatasetService (Shared Logic)
**Files**: `backend/app/use_cases/dataset/dataset_service.py`

Shared across get/list/update use cases:

**`fetch_dataset(dataset_id, include_transforms, include_preview, preview_limit)`**
- Fetches DatasetRecord from MetadataRepository
- Converts to Dataset domain model
- If `include_preview=true`: calls `dataset.query_preview_rows()` async
- Verifies auth: user's org_id matches project's org_id
- Raises: `DatasetNotFound`, `AuthorizationError`

**Design**: Services encapsulate domain logic; use cases call services; controllers serialize for HTTP.

---

## Upload & Outbox Events (Event Sourcing)

### Outbox Pattern
**Files**: `backend/app/repositories/outbox/` 

Event storage for async processing and audit trail.

**UploadFileReceived** event:
- `project_id`: Parent project
- `raw_storage_path`: Where raw CSV is stored
- `original_filename`: Original filename from upload
- `file_size`: Bytes
- `dataset_id`: Optional (for re-uploads)

**TransformsCreated** / **TransformsUpdated** events:
- Store full transform dicts/changes for audit

**OutboxRepository**:
- `submit_file_received_event(...)` → Creates event, returns OutboxRecord
- `get_file_received_event_by_id(upload_id)` → Fetches for processing
- `mark_processed(record_ids)` → Marks as processed (for future event publishing)

Events are never deleted—only marked as processed.

---

## Key Configuration (Settings)

**File**: `backend/app/config.py`

```python
# Database
database_url: str = "postgresql+asyncpg://..."  # or "sqlite+aiosqlite://..."

# Storage
storage_type: str = "minio"  # or "s3"
minio_endpoint: str = "localhost:9000"
minio_access_key: str = "minioadmin"
minio_secret_key: str = "minioadmin"
minio_secure: bool = False
storage_bucket: str = "dashboard-chat.datalake"

# S3 production settings
s3_region: str = "us-east-1"
s3_max_retries: int = 1
s3_connect_timeout: int = 5
s3_read_timeout: int = 10

# Auth
auth_mode: str = "dev"  # or "workos"
auto_provision_org: bool = False
```

---

## Database Schema (Key Tables)

**projects**
- id, name, description, org_id, created_by, created_at, updated_at

**datasets**
- id, name, description, project_id (FK), storage_path (unique), schema_config (JSON), partition_fields (JSON), column_profiles (JSON), created_at, updated_at

**transforms**
- id, dataset_id (FK), name, description, status, transform_type, condition_json, condition_sql, target_column, expression_config, expression_sql, version, created_at, updated_at

**outbox_messages** (event sourcing)
- id, aggregate_type, aggregate_id, event_type, payload (JSON), processed, processed_at

---

## Error Handling & Types

### Exception Hierarchy
- **MetadataRepositoryError** — DB operation failures
- **LakeRepositoryError** — S3/storage operation failures
- **OutboxRepositoryError** — Event storage failures
- **DomainException** subclasses:
  - `DatasetNotFound`, `ProjectNotFound`, `UploadNotFound`
  - `InvalidFileType`, `EmptyFile`, `AuthorizationError`

All decorated with status_code, type, and title for RFC 9457 error responses.

### Return Types
- Use cases return `Result[Data, str]` (returns library)
- Controllers match on `Success(data)` / `Failure(error)`
- HTTPController wraps for JSON responses

---

## Summary: Data Flow Integration

1. **Upload (Step 1)**: CSV → outbox event + raw S3 storage
2. **Dataset Creation (Step 2)**: Event → partitioned Parquet + metadata record
3. **Metadata Access**: GET /api/datasets → Returns schema + partition info
4. **Query Building**: Dataset model aggregates transforms into Ibis table
5. **Query Execution**: GET /api/datasets/{id}?include_preview → Reads Parquet + applies transforms
6. **Frontend**: Gets SQL (display_sql), schema, preview, and transform definitions
7. **Chat System**: Uses column_profiles + display_sql to inform LLM for table operations

**Data never moves to frontend DB** — frontend receives read-only previews and SQL representations; all data stays in S3/MinIO.
