## ADDED Requirements

### Requirement: Enable SQL access for a project
The system SHALL allow authenticated users to enable external SQL access for a project they own. Enabling SHALL provision a project environment via the provisioner, configure S3 secrets within the environment, create a PostgreSQL schema and read-only role, execute the bootstrap pipeline (bootstrap SQL + dbt run), and return dynamic connection details. The system SHALL reject enablement if the project contains no datasets or if the provisioner is unavailable.

#### Scenario: Enable SQL access for a project with datasets
- **WHEN** the user clicks "Enable SQL Access" for a project containing one or more datasets
- **THEN** the system provisions a project environment via the provisioner
- **AND** the provisioner health check confirms the environment is ready
- **AND** the system configures S3 secrets within the environment
- **AND** the system provisions a PostgreSQL schema (`project_{short_id}`) and read-only role (`reader_{short_id}`)
- **AND** the system executes the bootstrap pipeline (bootstrap SQL + dbt run) to create queryable views
- **AND** the system stores the environment_id, environment_host, and environment_port in the ExternalAccessRecord
- **AND** the system returns dynamic connection details: host, port, database name, username, and password
- **AND** the project toolbar shows an "Active" indicator for SQL access

#### Scenario: Enable SQL access for a project with no datasets
- **WHEN** the user clicks "Enable SQL Access" for a project with no datasets
- **THEN** the system displays a warning: "Add datasets before enabling SQL access"
- **AND** external SQL access is NOT activated
- **AND** no environment is provisioned and no PostgreSQL schema or role is created

#### Scenario: Enable SQL access when provisioner is unavailable
- **WHEN** the user clicks "Enable SQL Access" for a project
- **AND** the provisioner (Docker daemon or container runtime) is unavailable
- **THEN** the system returns an error indicating the provisioner is unavailable
- **AND** external SQL access is NOT activated
- **AND** no ExternalAccessRecord is created

### Requirement: Disable SQL access for a project
The system SHALL allow users to disable external SQL access for a project. Disabling SHALL drop the PostgreSQL schema (cascade), drop the role, terminate any active connections through that role, and deprovision the project's environment via the provisioner.

#### Scenario: Disable SQL access
- **WHEN** the user clicks "Disable SQL Access" for a project with active SQL access
- **THEN** the system drops the project's PostgreSQL schema and all views within it
- **AND** the system drops the project's read-only role
- **AND** any active external connections using that role are terminated
- **AND** the provisioner deprovisions the project's environment
- **AND** the connection details panel is hidden
- **AND** the toolbar indicator returns to a neutral state

### Requirement: Display connection details
The system SHALL display connection details for projects with SQL access enabled. Details SHALL include host, port, database name, and username, where host and port are dynamic values determined at provisioning time (from the provisioner/ExternalAccessRecord). The password SHALL be displayed only once at creation time or when explicitly regenerated.

#### Scenario: View connection details
- **WHEN** the user views a project with SQL access enabled
- **THEN** the connection details panel displays host, port, database name, and username
- **AND** host and port reflect the dynamic values assigned to the project's environment
- **AND** the password field shows a masked placeholder (not the actual password)

#### Scenario: Copy connection string to clipboard
- **WHEN** the user clicks the copy button next to the connection string
- **THEN** a complete `postgresql://` connection string is copied to the clipboard (using the dynamic host and port)
- **AND** a tooltip confirms "Copied to clipboard"

### Requirement: Environment lifecycle management
The system SHALL manage project environments through a provisioner abstraction. Each project with SQL access enabled gets its own dedicated environment, provisioned on enable and deprovisioned on disable. The provisioner abstraction allows for different backing implementations (e.g., Docker, Kubernetes).

#### Scenario: Environment provisioned on enable
- **WHEN** SQL access is enabled for a project
- **THEN** the provisioner provisions a new project environment
- **AND** the provisioner health check confirms the environment is accepting connections
- **AND** S3 secrets are configured within the environment for Parquet access
- **AND** the environment_id, environment_host, and environment_port are stored in the ExternalAccessRecord

#### Scenario: Environment deprovisioned on disable
- **WHEN** SQL access is disabled for a project
- **THEN** the provisioner deprovisions the project's environment
- **AND** the environment is fully removed (not just stopped)
- **AND** the ExternalAccessRecord is updated to reflect the environment is no longer running

#### Scenario: Environment health check
- **WHEN** the system checks the health of a project's SQL access
- **THEN** the provisioner performs a health check against the project's environment
- **AND** the health check returns the environment's status (running, stopped, not found)
- **AND** the environment status is included in API responses and UI indicators

#### Scenario: Orphan environment cleanup on backend startup
- **WHEN** the backend service starts up
- **THEN** the system reconciles running environments (from the provisioner) with ExternalAccessRecord metadata
- **AND** environments without a corresponding enabled ExternalAccessRecord are deprovisioned
- **AND** ExternalAccessRecords referencing non-existent environments are marked as degraded

### Requirement: Dynamic connection details
Connection host and port SHALL be determined at provisioning time, not from static configuration. The provisioner returns connection info (host, port) when provisioning an environment, which is stored in the ExternalAccessRecord and returned in API responses. This allows the system to run multiple environments on different ports and across different hosts.

#### Scenario: Connection details reflect environment assignment
- **WHEN** SQL access is enabled for a project
- **THEN** the connection host and port returned to the user match the values assigned by the provisioner at provisioning time
- **AND** these values are persisted in the ExternalAccessRecord for subsequent lookups

#### Scenario: Different projects get different connection endpoints
- **WHEN** two projects each have SQL access enabled
- **THEN** each project's connection details (host, port) reflect its own dedicated environment
- **AND** the endpoints may differ in port or host depending on provisioner assignment

### Requirement: Credential management
The system SHALL generate per-project PostgreSQL credentials on enable. Credentials SHALL be stored as bcrypt hashes in the metadata database. Users SHALL be able to regenerate credentials, which replaces the password and returns the new plaintext once.

#### Scenario: Credentials generated on enable
- **WHEN** SQL access is enabled for a project
- **THEN** the system generates a random 32-character password
- **AND** the system creates a PostgreSQL role with that password in the project's environment
- **AND** the plaintext password is returned to the user (one-time display)
- **AND** the password is stored as a bcrypt hash in the `external_access` metadata table

#### Scenario: Regenerate credentials
- **WHEN** the user clicks "Regenerate Credentials" for a project with active SQL access
- **THEN** the system generates a new random password
- **AND** the system executes `ALTER ROLE ... PASSWORD` with the new password in the project's environment
- **AND** the new plaintext password is returned to the user (one-time display)
- **AND** existing connections using the old password continue until disconnected

### Requirement: External tools can connect and query via PostgreSQL wire protocol
The system SHALL accept connections from any SQL-compatible tool (Excel/ODBC, Power BI, Tableau, psql, dbt CLI) using standard PostgreSQL wire protocol on the environment's dynamic host and port. Connected tools SHALL be able to execute standard SQL queries (SELECT, WHERE, ORDER BY, GROUP BY, aggregates).

#### Scenario: Connect from a SQL-compatible tool
- **WHEN** a user connects using the provided host, port, database, and credentials
- **THEN** the connection is established via PostgreSQL wire protocol to the project's dedicated environment
- **AND** the tool can execute SQL queries against the project's datasets

#### Scenario: All datasets appear as queryable tables
- **WHEN** a connected tool lists available tables/views
- **THEN** all project datasets are listed (as dbt staging views)
- **AND** no internal tables, system objects, or other projects' data is visible

#### Scenario: Dataset schema is accurately represented
- **WHEN** a connected tool inspects a table's schema
- **THEN** column names match those shown in the web UI (with alias transforms applied as column names)
- **AND** column types map correctly: text/select to VARCHAR, number to DOUBLE, boolean to BOOLEAN

#### Scenario: Standard SQL queries work
- **WHEN** a connected tool runs `SELECT ... WHERE ... ORDER BY ... GROUP BY`
- **THEN** the query returns correct results
- **AND** aggregate functions (COUNT, SUM, AVG, MIN, MAX) work as expected

### Requirement: External query results match the web UI
The system SHALL ensure that data returned through external SQL queries is identical to data shown in the web UI table view. Both paths read from the same Parquet source files in S3.

#### Scenario: Row counts match
- **WHEN** the web UI shows N rows for a dataset
- **AND** a connected tool runs `SELECT COUNT(*)` against that dataset
- **THEN** the count equals N

#### Scenario: Row values are identical
- **WHEN** the web UI displays specific values for a dataset row
- **AND** a connected tool queries the same row
- **THEN** all column values are identical

### Requirement: Transforms are reflected in external queries
The system SHALL apply all enabled transforms (filter, clean, alias) to external query results. The dbt staging models encode transforms as CTE pipelines, so external tools query the post-transform data.

#### Scenario: All transform types reflected
- **WHEN** a dataset has filter, cleaning, and alias transforms applied
- **AND** a connected tool queries the dataset
- **THEN** filtered-out rows are NOT returned
- **AND** cleaning operations (trim, case, fill_null, map_values) are applied to values
- **AND** column aliases appear as the column names

#### Scenario: Disabled transforms are excluded
- **WHEN** a dataset has some transforms with status "disabled"
- **AND** a connected tool queries the dataset
- **THEN** disabled transforms have no effect on the returned data

### Requirement: Sync reflects dataset and transform changes
The system SHALL provide an explicit "Sync" action that regenerates the bootstrap SQL and re-runs dbt within the project's environment to reflect changes made in the web UI (new datasets, removed datasets, updated transforms).

#### Scenario: New dataset becomes queryable after sync
- **WHEN** the user uploads a new dataset through the web UI
- **AND** the user clicks "Sync" on the SQL access panel
- **THEN** the new dataset appears as a queryable table in connected tools

#### Scenario: Updated transforms reflected after sync
- **WHEN** the user applies a new filter transform in the web UI
- **AND** the user clicks "Sync" on the SQL access panel
- **THEN** connected tools see the updated (filtered) results on the next query

#### Scenario: Removed dataset disappears after sync
- **WHEN** the user deletes a dataset through the web UI
- **AND** the user clicks "Sync" on the SQL access panel
- **THEN** the deleted dataset's view is dropped from the project's pg_duckdb environment
- **AND** connected tools no longer see it in the table list

### Requirement: Multi-tenant isolation via environment-per-project
The system SHALL isolate each project's data by provisioning a dedicated project environment per project. Each project gets its own environment, providing process-level isolation. Within the environment, schema isolation provides defense in depth. Credentials for one project SHALL NOT grant access to any other project's environment, schema, or data, regardless of whether they belong to the same organization.

#### Scenario: Organization isolation
- **WHEN** two organizations each have projects with SQL access enabled
- **AND** a user connects with Organization A's project credentials
- **THEN** the connection reaches only Organization A's dedicated environment
- **AND** no data from Organization B is accessible

#### Scenario: Project isolation within an organization
- **WHEN** a user has SQL access enabled for two projects (A and B)
- **AND** the user connects using Project A's credentials
- **THEN** the connection reaches only Project A's dedicated environment
- **AND** Project B's datasets are NOT visible through that connection

### Requirement: Read-only enforcement
The system SHALL enforce read-only access for all external connections. Any DML or DDL operation (INSERT, UPDATE, DELETE, CREATE, DROP, ALTER) SHALL be rejected.

#### Scenario: DML operations rejected
- **WHEN** a connected tool attempts INSERT, UPDATE, or DELETE against a dataset
- **THEN** the operation is rejected with a permission error
- **AND** no data is modified

#### Scenario: DDL operations rejected
- **WHEN** a connected tool attempts CREATE TABLE, DROP VIEW, or ALTER TABLE
- **THEN** the operation is rejected with a permission error
- **AND** no schema objects are modified

### Requirement: Connection limits
The system SHALL enforce a maximum of 3 simultaneous connections per project role. This caps resource usage since each pg_duckdb connection spawns a DuckDB engine instance within the project's environment.

#### Scenario: Connection limit reached
- **WHEN** 3 connections are active for a project's role
- **AND** a fourth connection attempt is made
- **THEN** the connection is rejected with a message indicating the limit has been reached
- **AND** existing connections continue working normally

### Requirement: Connection lifecycle
The system SHALL maintain active connections as long as SQL access is enabled and the project's environment is running. Disabling SQL access SHALL terminate all active connections for that project and deprovision the environment.

#### Scenario: Connections persist while enabled
- **WHEN** SQL access is enabled and a tool has an active connection
- **AND** the tool runs queries over an extended period
- **THEN** the connection continues without interruption

#### Scenario: Disabling terminates active connections
- **WHEN** an external tool has an active connection
- **AND** the user disables SQL access for the project
- **THEN** the active connection is terminated
- **AND** the project's environment is deprovisioned
- **AND** the external tool receives a connection error on the next query

### Requirement: SQL access status reporting
The system SHALL report the health of each project's SQL access endpoint by checking the specific project's environment status via the provisioner. If the project's environment becomes unavailable, the UI SHALL indicate the issue.

#### Scenario: Endpoint unavailable
- **WHEN** SQL access was previously enabled for a project
- **AND** the project's pg_duckdb environment becomes unreachable or stops running
- **THEN** the project toolbar shows a warning indicator
- **AND** the connection details panel displays a status message explaining the issue
- **AND** the environment_status in the API response reflects the degraded state

### Requirement: SQL access API endpoints
The system SHALL expose REST API endpoints for managing external SQL access, protected by the existing auth middleware with org_id scoping.

#### Scenario: Enable via API
- **WHEN** `POST /api/projects/{id}/sql-access` is called with a valid Bearer token
- **THEN** the system provisions a project environment and enables SQL access for the project
- **AND** returns connection details (dynamic host, dynamic port, database, username, password) with HTTP 201

#### Scenario: Disable via API
- **WHEN** `DELETE /api/projects/{id}/sql-access` is called with a valid Bearer token
- **THEN** the system disables SQL access, drops schema/role, and deprovisions the environment
- **AND** returns HTTP 204

#### Scenario: Get connection details via API
- **WHEN** `GET /api/projects/{id}/sql-access` is called with a valid Bearer token
- **THEN** the system returns connection details (dynamic host, dynamic port, database, username, environment_status — NOT password) with HTTP 200
- **AND** returns `enabled: false` if SQL access is not active

#### Scenario: Sync via API
- **WHEN** `POST /api/projects/{id}/sql-access/sync` is called with a valid Bearer token
- **THEN** the system regenerates bootstrap SQL and re-runs dbt within the project's environment
- **AND** returns HTTP 200 with `last_synced_at` timestamp

#### Scenario: Regenerate credentials via API
- **WHEN** `POST /api/projects/{id}/sql-access/credentials` is called with a valid Bearer token
- **THEN** the system generates a new password and updates the PostgreSQL role in the project's environment
- **AND** returns the new plaintext password (one-time) with HTTP 200

#### Scenario: Enable when provisioner is unavailable
- **WHEN** `POST /api/projects/{id}/sql-access` is called with a valid Bearer token
- **AND** the provisioner (Docker daemon or container runtime) is unavailable
- **THEN** the system returns HTTP 503 with an error message indicating the provisioner is unavailable

#### Scenario: Auth enforcement
- **WHEN** any sql-access endpoint is called without a valid Bearer token
- **THEN** the system returns HTTP 401
- **WHEN** the token's org_id does not own the project
- **THEN** the system returns HTTP 403

### Requirement: External access metadata persistence
The system SHALL persist external access state in an `external_access` metadata table with fields: project_id, org_id, pg_schema, pg_role, pg_password_hash, environment_id, environment_host, environment_port, enabled, last_synced_at, created_at, updated_at. The table SHALL have a unique constraint on project_id.

#### Scenario: Metadata created on enable
- **WHEN** SQL access is enabled for a project
- **THEN** an `external_access` record is created with enabled=true, pg_schema, pg_role, bcrypt password hash, environment_id, environment_host, and environment_port

#### Scenario: Metadata updated on disable
- **WHEN** SQL access is disabled for a project
- **THEN** the `external_access` record is updated with enabled=false
- **AND** the environment_id, environment_host, and environment_port fields are cleared
- **AND** the record is NOT deleted (soft disable for audit trail)

#### Scenario: Metadata updated on sync
- **WHEN** the user syncs SQL access
- **THEN** the `external_access` record's `last_synced_at` is updated to the current timestamp
