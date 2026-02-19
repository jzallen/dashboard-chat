# DBT Project Export Feature - Data Model Analysis

## Dataset Model (Domain + ORM)

### Domain Model: `app/models/dataset.py`
Frozen dataclass, authoritative business object:
```python
@dataclass(frozen=True, slots=True)
class Dataset:
    id: str                                    # UUID primary key
    project_id: str | None                     # Parent project UUID
    name: str                                  # Display name (default: "New Dataset")
    description: str | None                    # Optional description
    schema_config: dict[str, Any]              # Column names + types {fields: {col_name: {type: "text|number|boolean|select"}}}
    partition_fields: list[str]                # Hive-style partition field names
    transforms: list[Transform]                # List of transforms (auto-converted from ORM records)
    preview_rows: list[dict[str, Any]]         # Preview data
    column_profiles: dict[str, Any] | None     # Per-column stats (sample_values, unique_count, etc.)
```

**Key Properties:**
- `storage_path`: Returns `"datasets/{project_id}/{dataset_id}/"` (S3/MinIO partition path)
- `staging_sql`: Compact SQL from Ibis (for execution)
- `display_sql`: Human-readable SQL with dataset name alias
- `serialize()`: Converts to JSON-compatible dict for HTTP responses

### ORM Record: `app/repositories/metadata/dataset_record.py`
SQLAlchemy persistent model:
```python
class DatasetRecord(Base):
    __tablename__ = "datasets"
    
    id: Mapped[str]                   # String(36) UUID primary key
    storage_path: Mapped[str]         # String(255), unique, indexed (S3/MinIO path)
    project_id: Mapped[str]           # String(36) FK to projects.id (CASCADE)
    name: Mapped[str]                 # String(255)
    description: Mapped[str | None]   # Text, nullable
    schema_config: Mapped[dict]       # JSON
    partition_fields: Mapped[list]    # JSON (list of strings)
    column_profiles: Mapped[dict | None] # JSON, nullable
    created_at: Mapped[datetime]      # DateTime, default now(UTC)
    updated_at: Mapped[datetime]      # DateTime, default now(UTC), onupdate
    
    # Relationships
    project: Mapped[ProjectRecord]    # back_populates="datasets"
    transforms: Mapped[list[TransformRecord]] # back_populates="dataset", cascade all/delete-orphan
```

---

## Transform Data Model

### Domain Model: `app/models/transform.py`
Frozen dataclass:
```python
TransformStatus = Literal['enabled', 'disabled', 'deleted']
TransformType = Literal['filter', 'clean', 'alias', 'map']

@dataclass(frozen=True, slots=True)
class Transform:
    id: str | None
    name: str
    condition_json: QueryBuilderJSON | None    # For filter type (query builder JSON)
    condition_sql: str | None                  # SQL WHERE clause (filter type)
    description: str | None
    status: TransformStatus                    # Default: 'enabled'
    transform_type: TransformType              # Default: 'filter'
    target_column: str | None                  # For clean/alias/map types
    expression_sql: str | None                 # Display SQL (clean/alias/map)
    expression_config: dict[str, Any] | None   # Structured config (clean/alias/map)
    created_at: datetime | None                # For ordering cleaning transforms
```

**Properties:**
- `is_enabled`: Returns `status == 'enabled'`
- `serialize()`: Converts to JSON-compatible dict

### ORM Record: `app/repositories/metadata/transform_record.py`
```python
class TransformRecord(Base):
    __tablename__ = "transforms"
    
    id: Mapped[str]                      # String(36) UUID, primary key
    dataset_id: Mapped[str]              # String(36) FK to datasets.id (CASCADE)
    name: Mapped[str]                    # String(255)
    description: Mapped[str | None]      # Text, nullable
    condition_json: Mapped[dict]         # JSON (query builder format)
    condition_sql: Mapped[str | None]    # Text, nullable
    version: Mapped[int]                 # Default 1 (incremented on updates)
    status: Mapped[str]                  # String(20), default 'enabled'
    transform_type: Mapped[str]          # String(20), default 'filter'
    target_column: Mapped[str | None]    # String(255), nullable
    expression_sql: Mapped[str | None]   # Text, nullable
    expression_config: Mapped[dict | None] # JSON, nullable
    nl_prompt: Mapped[str | None]        # Text, nullable (for NL generation metadata)
    created_at: Mapped[datetime]         # DateTime, default now(UTC)
    updated_at: Mapped[datetime]         # DateTime, default now(UTC), onupdate
    
    # Relationships
    dataset: Mapped[DatasetRecord]       # back_populates="transforms"
```

### Transform Types
1. **filter**: Row-level WHERE predicates
   - Uses: `condition_json` (query builder JSON) + `condition_sql` (display)
   - Pipeline stage: Applied as `.filter()` (WHERE clause)

2. **clean**: Column-level cleaning expressions (trim, case, fill_null)
   - Uses: `target_column`, `expression_config`, `expression_sql`
   - Pipeline stage: Applied as `.mutate()` (SELECT column expression)
   - Operations: `trim`, `case` (upper/lower/title/snake/kebab), `fill_null`, `map_values`

3. **map**: Value mapping expressions (CASE WHEN chains)
   - Uses: `target_column`, `expression_config` (mappings list)
   - Pipeline stage: Applied as `.mutate()`

4. **alias**: Column rename operations
   - Uses: `target_column`, `expression_config` (alias name)
   - Pipeline stage: Applied as `.rename()`

**Pipeline Order (in `_build_table()`):**
1. MUTATE stage: Clean + map transforms (sorted by `created_at`)
2. FILTER stage: Filter transforms (via query builder JSON)
3. RENAME stage: Alias transforms

---

## Project Model

### Domain Model: `app/models/project.py`
```python
@dataclass(frozen=True, slots=True)
class Project:
    id: str
    name: str
    description: str | None
    datasets: list[Dataset]
    created_at: datetime | None
    updated_at: datetime | None
```

### ORM Record: `app/repositories/metadata/project_record.py`
```python
class ProjectRecord(Base):
    __tablename__ = "projects"
    
    id: Mapped[str]                  # String(36) UUID, primary key
    name: Mapped[str]                # String(255)
    description: Mapped[str | None]  # Text, nullable
    org_id: Mapped[str | None]       # String(36), nullable, indexed (multi-tenancy)
    created_by: Mapped[str | None]   # String(36), nullable
    created_at: Mapped[datetime]     # DateTime, default now(UTC)
    updated_at: Mapped[datetime]     # DateTime, default now(UTC), onupdate
    
    # Relationships
    datasets: Mapped[list[DatasetRecord]] # back_populates="project", cascade all/delete-orphan
```

**Key:** Projects are scoped by `org_id` for multi-tenancy.

---

## Repository Layer

### MetadataRepository (`app/repositories/metadata/repository.py`)
Async SQLAlchemy implementation. Does NOT commit (handled at router/controller level).

**Session Handling:**
- Uses `RestrictedSession` (prevents direct commit/rollback)
- `flush()` persists within transaction
- `refresh()` reloads from DB
- Commit/rollback happens in `@with_repositories` decorator or router

**Key Dataset Methods:**
```python
async def list_datasets(project_id: str | None = None) -> list[dict]:
    # SELECT datasets WHERE project_id = ? ORDER BY created_at DESC
    # Eager-loads: transforms (excluding status='deleted')

async def get_dataset(dataset_id: str, include_transforms: bool = True) -> dict | None:
    # SELECT datasets WHERE id = ?
    # Eager-loads: project + transforms

async def get_dataset_record(dataset_id: str, include_transforms: bool = True) -> DatasetRecord | None:
    # Returns ORM record for domain model conversion

async def create_dataset(
    project_id: str, dataset_id: str, storage_path: str, name: str,
    schema_config: dict, description: str | None = None,
    partition_fields: list[str] | None = None,
    column_profiles: dict | None = None
) -> dict:
    # INSERT new dataset

async def update_dataset(dataset_id: str, **kwargs) -> DatasetRecord | None:
    # UPDATE dataset fields

async def delete_dataset(dataset_id: str) -> str | None:
    # DELETE, returns storage_path for file cleanup
```

**Key Transform Methods:**
```python
async def create_transform(
    dataset_id: str, name: str, condition_json: dict, condition_sql: str,
    description: str | None = None, nl_prompt: str | None = None
) -> dict

async def create_transforms_batch(
    dataset_id: str, transforms_input: list[dict]
) -> list[dict]

async def update_transform(transform_id: str, update_data: dict) -> dict | None

async def update_transforms(updates: list[dict]) -> None
    # Batch update via SQLAlchemy update()

async def delete_transform(transform_id: str) -> bool

async def find_transform_by_sql(dataset_id: str, condition_sql: str) -> dict | None
```

### LakeRepository (`app/repositories/lake/repository.py`)
Handles Parquet data lake operations via boto3 + Ibis.

**Key Methods:**
```python
def write_raw_file(content: bytes, storage_path: str) -> str
    # Put to S3, returns "s3://bucket/storage_path"

def read_raw_file(storage_path: str) -> bytes
    # Get from S3

# Also supports:
# - write_dataframe_partitioned(df, storage_path) — writes Parquet with partitioning
# - read_parquet(storage_path) — reads via Ibis/DuckDB
```

**S3 Path Convention:**
- Upload files: `uploads/{project_id}/{upload_id}.csv`
- Dataset parquet: `datasets/{project_id}/{dataset_id}/**/*.parquet` (partitioned glob)

---

## Use Case Patterns

### Decorator Stack
```python
@with_repositories    # Outer: injects RepositoryContainer, commits on success
@handle_returns       # Inner: wraps result in Success/Failure
async def my_use_case(..., *, repositories: 'RepositoryContainer') -> Result[T, str]:
    ...
```

### Example: `get_dataset.py`
```python
@with_repositories
@handle_returns
async def get_dataset(
    dataset_id: str,
    include_transforms: bool = True,
    include_preview: bool = False,
    preview_limit: int = 10,
    *,
    repositories: 'RepositoryContainer',
) -> Result[Dataset, str]:
    service = DatasetService(repositories)
    return await service.fetch_dataset(
        dataset_id, include_transforms, include_preview, preview_limit
    )
```

### DatasetService (shared logic in `use_cases/dataset/dataset_service.py`)
```python
class DatasetService:
    def __init__(self, repositories: 'RepositoryContainer'):
        self._metadata_repo = repositories['metadata_repository']
        self._lake_repo = repositories['lake_repository']

    async def fetch_dataset(
        self, dataset_id: str, include_transforms: bool = True,
        include_preview: bool = False, preview_limit: int = 10
    ) -> Dataset:
        # 1. Get ORM record from metadata repo
        dataset_record = await self._metadata_repo.get_dataset_record(dataset_id)
        
        # 2. Auth check via get_auth_user() context var
        user = get_auth_user()
        if dataset_record.project.org_id != user.org_id:
            raise AuthorizationError(...)
        
        # 3. Convert to domain model
        dataset = Dataset.from_record(dataset_record, include_transforms)
        
        # 4. Query preview if requested (via asyncio.to_thread)
        if include_preview:
            preview_rows = await asyncio.to_thread(
                lambda: dataset.query_preview_rows(limit=preview_limit)
            )
        
        return dataset
```

### Error Handling
- `handle_returns` decorator catches exceptions, wraps as `Failure(error)`
- Use cases raise domain exceptions (subclasses of `DomainException`)
- Controller unpacks `Success`/`Failure`, calls `_error_response(error)` for RFC 9457 format

### Auth Context
- `set_session(db)` sets context var before use case execution
- `set_auth_user(user)` sets auth user context var (in auth middleware)
- Use cases access via `get_auth_user()` from `app.auth`

---

## Case Conversion Utilities

### Location: `app/utils/sql_functions.py`

**DuckDB Macros** (registered via `register_duckdb_macros(conn)`):
```sql
CREATE MACRO title_case(s) AS
    ARRAY_TO_STRING(
        LIST_TRANSFORM(
            STRING_SPLIT(TRIM(s), ' '),
            x -> CASE WHEN x = '' THEN '' ELSE UPPER(x[1]) || LOWER(x[2:]) END
        ),
        ' '
    )

CREATE MACRO snake_case(s) AS
    TRIM(REGEXP_REPLACE(LOWER(TRIM(s)), '[^a-z0-9]+', '_', 'g'), '_')

CREATE MACRO kebab_case(s) AS
    TRIM(REGEXP_REPLACE(LOWER(TRIM(s)), '[^a-z0-9]+', '-', 'g'), '-')
```

**Ibis UDF Declarations** (used in Python):
```python
@ibis.udf.scalar.builtin
def title_case(s: str) -> str: ...

@ibis.udf.scalar.builtin
def snake_case(s: str) -> str: ...

@ibis.udf.scalar.builtin
def kebab_case(s: str) -> str: ...
```

**Usage in CleaningExpression** (`app/types.py`):
```python
case "case":
    mode = self.config["mode"]  # "upper", "lower", "title", "snake", "kebab"
    match mode:
        case "title": return title_case(col)
        case "snake": return snake_case(col)
        case "kebab": return kebab_case(col)
```

**Dataset filename conversion** (`app/models/dataset.py`):
```python
@staticmethod
def display_name_to_filename(display_name: str) -> str:
    """Convert display name to snake_case filename."""
    safe_name = re.sub(r"[^a-z0-9]+", "_", display_name.lower()).strip("_")
    return safe_name or "dataset"
```

---

## Schema Configuration Format

**schema_config Structure:**
```json
{
  "fields": {
    "column_name": {
      "type": "text|number|boolean|select",
      "required": false,
      // Other metadata (label, choices for select, etc.)
    },
    ...
  }
}
```

**Type Mapping (in Dataset._SCHEMA_TYPE_MAP):**
```python
"text" → "string"
"number" → "float64"
"boolean" → "boolean"
"select" → "string"
```

---

## SQL Generation Pipeline

### Flow in `Dataset._build_table()`
1. Read parquet from S3 (path: `f"s3://{bucket}/{storage_path}**/*.parquet"`)
2. Select columns from schema_config
3. **MUTATE stage**: Apply enabled cleaning transforms (sorted by created_at)
4. **FILTER stage**: Apply enabled filter transforms (via QueryBuilderJSON to Ibis)
5. **RENAME stage**: Apply enabled alias transforms (column renames)
6. Convert to SQL via `ibis.to_sql(table, dialect="duckdb")`

### SQL Output Methods
- `staging_sql`: Compact (no pretty-print, for execution)
- `display_sql`: Pretty-printed with meaningful alias and expanded SELECT *

---

## Transaction Management

### Controller/Router Pattern
1. Router calls `HTTPController` method
2. Controller invokes use case (with `@with_repositories` decorator)
3. `@with_repositories`:
   - Injects `RepositoryContainer`
   - Calls use case
   - On success: commits session
   - On exception: rollback, re-raise
4. Controller unpacks `Success`/`Failure`, returns JSON response

### Database Context
- Session set via `set_session(db)` in router dependency (`use_db_context`)
- All use cases access via `get_session()` context var
- `RestrictedSession` wrapper prevents direct commit/rollback at repository level

---

## Key Takeaways for DBT Export

1. **Dataset Storage**: Parquet files at `datasets/{project_id}/{dataset_id}/` with glob pattern reads
2. **Transforms Attached**: All transforms (filter/clean/alias/map) linked to dataset via FK
3. **Enabled Flag**: Use `status` field (enabled/disabled/deleted), check `is_enabled` property
4. **Schema Available**: Full schema in `schema_config` JSON, ready for dbt model.yml
5. **Case Conversion Ready**: `snake_case`, `kebab_case`, `title_case` DuckDB macros available
6. **Auth Scoped**: Datasets scoped via project → org_id multi-tenancy
7. **Preview SQL**: `display_sql` property provides human-readable transformation SQL
8. **Error Format**: Wrap exceptions in domain exceptions, controller handles RFC 9457 format
9. **Async Pattern**: All DB operations async, use `@with_repositories` + `@handle_returns`
