## ADDED Requirements

### Requirement: Query engine node registration
The system SHALL maintain a `QueryEngineNode` model representing org-level persistent query engine instances. Each node SHALL have an org_id, name, host, port, database, status, and timestamps. The system SHALL enforce a unique constraint on (org_id, name) and index on org_id. On backend startup, the system SHALL seed a default node from environment configuration if none exists for the org.

#### Scenario: Default node seeded on startup
- **WHEN** the backend starts and no query engine node exists for the configured org
- **THEN** the system creates a `QueryEngineNode` record with host, port, and database from environment settings
- **AND** the node status is set to "running" after a successful health check

#### Scenario: Default node already exists
- **WHEN** the backend starts and a query engine node already exists for the configured org
- **THEN** the system does NOT create a duplicate node
- **AND** the system performs a health check and updates the node's status

#### Scenario: Multiple nodes per org
- **WHEN** an organization has two query engine nodes registered
- **THEN** both nodes are retrievable via the API
- **AND** each node has independent host, port, and status values

### Requirement: Query engine health monitoring
The system SHALL periodically check the health of each registered query engine node by attempting a connection and executing a lightweight query. The node status SHALL be updated to reflect the result: running, degraded, or unreachable.

#### Scenario: Healthy engine node
- **WHEN** the system performs a health check against a running engine node
- **AND** the connection succeeds and the test query returns a result
- **THEN** the node status is set to "running"

#### Scenario: Unreachable engine node
- **WHEN** the system performs a health check against an engine node
- **AND** the connection fails or times out
- **THEN** the node status is set to "unreachable"
- **AND** the status_message describes the connection error

#### Scenario: Degraded engine node
- **WHEN** the system performs a health check against an engine node
- **AND** the connection succeeds but the test query fails or is slow
- **THEN** the node status is set to "degraded"
- **AND** the status_message describes the issue

### Requirement: Query engine API endpoints
The system SHALL expose REST API endpoints for listing and inspecting query engine nodes, protected by auth middleware with org_id scoping.

#### Scenario: List engine nodes
- **WHEN** `GET /api/query-engines` is called with a valid Bearer token
- **THEN** the system returns all query engine nodes for the token's org_id
- **AND** each node includes id, name, host, port, database, status, status_message, project_count, created_at

#### Scenario: Get engine node detail
- **WHEN** `GET /api/query-engines/{id}` is called with a valid Bearer token
- **THEN** the system returns the engine node's full details including connection strings (ODBC, JDBC, PostgreSQL)
- **AND** a list of connected projects with their schema name, sync status, and last_synced_at

#### Scenario: Test engine connection
- **WHEN** `POST /api/query-engines/{id}/test` is called with a valid Bearer token
- **THEN** the system performs a health check against the specified engine node
- **AND** returns the result (success/failure) with timing information

#### Scenario: Auth enforcement on engine endpoints
- **WHEN** any query-engines endpoint is called without a valid Bearer token
- **THEN** the system returns HTTP 401
- **WHEN** the token's org_id does not match the engine node's org_id
- **THEN** the system returns HTTP 403

### Requirement: Event-driven dataset sync to query engine
The system SHALL automatically propagate dataset and transform changes to the query engine via the outbox pattern. When a dataset is created, a transform is applied/modified/deleted, or a dataset is deleted, the system SHALL emit an outbox event that triggers view creation/update/deletion in the engine.

#### Scenario: Dataset creation triggers sync event
- **WHEN** a dataset is created and Parquet is written to the data lake
- **AND** the project has SQL access enabled
- **THEN** the system emits a `DatasetSyncRequested` outbox event with project_id, dataset_id, and engine_node_id
- **AND** the sync processor creates a `CREATE OR REPLACE VIEW` in the engine pointing to the Parquet file

#### Scenario: Transform change triggers sync event
- **WHEN** a transform is created, updated, or disabled on a dataset
- **AND** the project has SQL access enabled
- **THEN** the system emits a `TransformSyncRequested` outbox event with project_id, dataset_id, and engine_node_id
- **AND** the sync processor updates the view definition with the new CTE pipeline

#### Scenario: Dataset deletion triggers sync event
- **WHEN** a dataset is deleted
- **AND** the project has SQL access enabled
- **THEN** the system emits a `DatasetRemoved` outbox event with project_id, dataset_id, and engine_node_id
- **AND** the sync processor executes `DROP VIEW IF EXISTS` in the engine

#### Scenario: Sync event processed successfully
- **WHEN** the sync processor picks up an unprocessed outbox event
- **AND** executes the corresponding SQL against the query engine successfully
- **THEN** the event is marked as processed with a timestamp

#### Scenario: Sync event processing fails
- **WHEN** the sync processor picks up an unprocessed outbox event
- **AND** the SQL execution fails (engine unreachable, SQL error)
- **THEN** the event remains unprocessed for retry
- **AND** the per-dataset sync status reflects the error

#### Scenario: SQL access not enabled — no sync events emitted
- **WHEN** a dataset is created or modified
- **AND** the project does NOT have SQL access enabled
- **THEN** no sync outbox events are emitted

### Requirement: Per-dataset sync status
The system SHALL track and expose per-dataset sync status derived from outbox event state. Each dataset with SQL access enabled SHALL report one of: synced, pending, or error.

#### Scenario: Dataset synced
- **WHEN** all outbox events for a dataset have been processed
- **THEN** the dataset's sync status is "synced"

#### Scenario: Dataset pending
- **WHEN** an unprocessed outbox event exists for a dataset
- **AND** no processing error has occurred
- **THEN** the dataset's sync status is "pending"

#### Scenario: Dataset sync error
- **WHEN** the most recent sync attempt for a dataset failed
- **THEN** the dataset's sync status is "error"
- **AND** the error detail is available via the API

### Requirement: Sync processor background task
The system SHALL run a background task that polls the outbox for unprocessed sync events and executes them against the appropriate query engine node. The processor SHALL run on a short polling interval (configurable, default 2 seconds) and process events in batch.

#### Scenario: Processor starts with backend
- **WHEN** the backend application starts
- **THEN** the sync processor background task is started
- **AND** it begins polling the outbox for unprocessed events

#### Scenario: Processor handles batch of events
- **WHEN** the processor polls and finds multiple unprocessed events
- **THEN** it processes them in order (oldest first)
- **AND** marks each as processed upon success

#### Scenario: Processor retries failed events
- **WHEN** a sync event fails processing
- **THEN** the processor retries it on the next poll cycle
- **AND** applies exponential backoff after repeated failures

### Requirement: Backend analytical queries via query engine
The system SHALL route all backend analytical queries (dataset preview, row count, column type inspection, cleaning operation preview) to the query engine via asyncpg instead of in-process DuckDB. The query engine connection pool SHALL be initialized on backend startup.

#### Scenario: Dataset preview via query engine
- **WHEN** the backend needs to preview a dataset's rows
- **THEN** the system executes a SELECT query against the query engine via asyncpg
- **AND** returns the same results as the previous in-process DuckDB path

#### Scenario: Row count via query engine
- **WHEN** the backend needs the row count for a dataset
- **THEN** the system executes `SELECT COUNT(*)` against the query engine
- **AND** returns the count

#### Scenario: Cleaning preview via query engine
- **WHEN** the backend needs to preview a cleaning operation
- **THEN** the system executes the cleaning SQL against the query engine
- **AND** returns before/after sample rows

#### Scenario: Query engine connection pool
- **WHEN** the backend starts
- **THEN** an asyncpg connection pool is created targeting the default query engine node
- **AND** the pool is used for all analytical queries

### Requirement: Query engine docker-compose service
The system SHALL include a `query-engine` service in docker-compose using the pgduckdb image. The service SHALL be always-on, configured with S3/MinIO credentials at startup via an init script, and expose the PostgreSQL wire protocol.

#### Scenario: Engine starts with docker compose
- **WHEN** `docker compose up` is executed
- **THEN** the `query-engine` service starts alongside other services
- **AND** the init script loads httpfs, configures S3 secrets, and creates the `duckdb_readers` group role

#### Scenario: Engine persists across restarts
- **WHEN** `docker compose restart query-engine` is executed
- **THEN** the engine restarts and the init script re-applies configuration
- **AND** existing schemas and roles are preserved (idempotent init)

### Requirement: Proxy role credential obfuscation
The system SHALL create two PostgreSQL roles per project: an internal role (owns schema grants and duckdb_readers membership) and a proxy role (user-facing, with SET ROLE privilege to the internal role). Users authenticate as the proxy role. Credential regeneration only affects the proxy role, leaving the internal permission scaffolding intact.

#### Scenario: Project access creates both roles
- **WHEN** SQL access is enabled for a project
- **THEN** the system creates an internal role (`reader_{short_id}`) with schema grants and `duckdb_readers` membership
- **AND** the system creates a proxy role (`proxy_{short_id}`) with `SET ROLE reader_{short_id}` privilege
- **AND** the user receives the proxy role's credentials

#### Scenario: Credential regeneration affects only proxy role
- **WHEN** the user regenerates credentials for a project
- **THEN** the system changes only the proxy role's password
- **AND** the internal role, schema grants, and `duckdb_readers` membership are unaffected
- **AND** existing connections using the old proxy password are terminated

#### Scenario: Proxy role queries use internal role permissions
- **WHEN** a user connects as the proxy role and executes a query
- **THEN** the connection executes `SET ROLE reader_{short_id}` to assume internal role permissions
- **AND** the query resolves against the project's schema with read-only access

### Requirement: Query engine node frontend views
The system SHALL provide frontend views for listing and inspecting query engine nodes.

#### Scenario: Engine list view
- **WHEN** the user navigates to the Query Engines page
- **THEN** all engine nodes for the user's organization are displayed
- **AND** each node shows name, status indicator, endpoint, and connected project count

#### Scenario: Engine detail view
- **WHEN** the user clicks on an engine node
- **THEN** the detail view shows host, port, database, and pre-formatted connection strings (ODBC, JDBC, PostgreSQL)
- **AND** a list of connected projects with schema name and sync status
- **AND** quick-start guides for connecting from Excel, Power BI, Tableau, psql, and dbt

#### Scenario: Engine status polling
- **WHEN** the user is viewing the engine list or detail page
- **THEN** engine status updates automatically via polling
- **AND** status transitions (e.g., running → degraded) are reflected without page refresh
