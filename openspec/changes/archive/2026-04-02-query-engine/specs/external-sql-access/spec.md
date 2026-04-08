## MODIFIED Requirements

### Requirement: Enable SQL access for a project
The system SHALL allow authenticated users to enable external SQL access for a project they own. Enabling SHALL create a PostgreSQL schema and read-only role (internal + proxy) in the org's query engine node, execute the bootstrap pipeline to create queryable views, and return connection details derived from the engine node's stable endpoint. The system SHALL reject enablement if the project contains no datasets or if the query engine node is unreachable.

#### Scenario: Enable SQL access for a project with datasets
- **WHEN** the user clicks "Enable SQL Access" for a project containing one or more datasets
- **THEN** the system creates a PostgreSQL schema (`project_{short_id}`) and roles (internal `reader_{short_id}`, proxy `proxy_{short_id}`) in the org's query engine
- **AND** the system executes the bootstrap pipeline to create queryable views
- **AND** the system stores the engine_node_id in the ExternalAccessRecord
- **AND** the system returns connection details: host, port, database (from engine node), username, and password (from proxy role)
- **AND** the project SQL access page transitions to the permissions and sync status view

#### Scenario: Enable SQL access for a project with no datasets
- **WHEN** the user clicks "Enable SQL Access" for a project with no datasets
- **THEN** the system displays a warning: "Add datasets before enabling SQL access"
- **AND** external SQL access is NOT activated
- **AND** no PostgreSQL schema or role is created

#### Scenario: Enable SQL access when query engine is unreachable
- **WHEN** the user clicks "Enable SQL Access" for a project
- **AND** the org's query engine node is unreachable
- **THEN** the system returns an error indicating the query engine is unavailable
- **AND** external SQL access is NOT activated

### Requirement: Disable SQL access for a project
The system SHALL allow users to disable external SQL access for a project. Disabling SHALL drop the PostgreSQL schema (cascade), drop both roles (internal and proxy), and terminate any active connections. The query engine node SHALL continue running unaffected.

#### Scenario: Disable SQL access
- **WHEN** the user clicks "Disable SQL Access" for a project with active SQL access
- **THEN** the system drops the project's PostgreSQL schema and all views within it
- **AND** the system drops the project's internal and proxy roles
- **AND** any active external connections using the proxy role are terminated
- **AND** the query engine node continues running (unaffected)
- **AND** the project SQL access page returns to the enable prompt

### Requirement: Display connection details
The system SHALL display connection details for projects with SQL access enabled. Details SHALL include host, port, and database derived from the engine node's stable endpoint, plus the proxy role username. The password SHALL be displayed only once at creation time or when explicitly regenerated. The project panel SHALL link to the engine detail view for full ODBC/JDBC connection strings.

#### Scenario: View connection details on project panel
- **WHEN** the user views the SQL access page for a project with SQL access enabled
- **THEN** the page displays the engine node name and a link to the engine detail view
- **AND** the proxy role username is shown
- **AND** the password field shows a masked placeholder
- **AND** host and port reflect the engine node's stable values (not dynamic per-project values)

#### Scenario: Copy connection string to clipboard
- **WHEN** the user clicks the copy button next to the connection string
- **THEN** a complete `postgresql://` connection string is copied using the engine node's stable endpoint and proxy credentials
- **AND** a tooltip confirms "Copied to clipboard"

### Requirement: Environment lifecycle management
The system SHALL manage query engine nodes at the organization level, not per-project. Enabling SQL access for a project creates schemas and roles in the org's existing engine node. Disabling removes them. No container provisioning or deprovisioning occurs during project-level enable/disable.

#### Scenario: Enable does not provision a container
- **WHEN** SQL access is enabled for a project
- **THEN** no new container or environment is provisioned
- **AND** schemas and roles are created in the org's existing query engine node

#### Scenario: Disable does not deprovision a container
- **WHEN** SQL access is disabled for a project
- **THEN** no container or environment is deprovisioned
- **AND** only the project's schemas and roles are removed from the engine

#### Scenario: Engine health check
- **WHEN** the system checks the health of a project's SQL access
- **THEN** the health check targets the org's query engine node (not a per-project environment)
- **AND** the engine node's status is included in API responses and UI indicators

### Requirement: Stable connection details
Connection host and port SHALL be derived from the org's query engine node, which has a stable endpoint for its lifetime. Connection details do NOT change when SQL access is disabled and re-enabled for a project, as long as the same engine node is used.

#### Scenario: Connection details reflect engine node
- **WHEN** SQL access is enabled for a project
- **THEN** the connection host and port match the org's query engine node values
- **AND** these values are stable across enable/disable cycles

#### Scenario: All projects on same engine share endpoint
- **WHEN** two projects in the same org have SQL access enabled
- **THEN** both projects' connection details share the same host and port (from the engine node)
- **AND** project isolation is enforced by per-project schemas and proxy credentials

### Requirement: Credential management
The system SHALL generate per-project proxy role credentials on enable. The proxy role password SHALL be stored as a hash in the metadata database. Users SHALL be able to regenerate proxy credentials without affecting the internal role or permission scaffolding.

#### Scenario: Credentials generated on enable
- **WHEN** SQL access is enabled for a project
- **THEN** the system generates a random password for the proxy role
- **AND** the proxy role is created in the query engine with that password
- **AND** the plaintext password is returned to the user (one-time display)
- **AND** the password hash is stored in the `external_access` metadata table

#### Scenario: Regenerate credentials
- **WHEN** the user clicks "Regenerate Credentials" for a project with active SQL access
- **THEN** the system generates a new random password for the proxy role
- **AND** the system executes `ALTER ROLE proxy_{short_id} PASSWORD` in the query engine
- **AND** the new plaintext password is returned to the user (one-time display)
- **AND** the internal role, schema grants, and duckdb_readers membership are unaffected

### Requirement: Sync reflects dataset and transform changes
The system SHALL automatically propagate dataset and transform changes to the query engine via outbox events. An explicit "Force Sync" action SHALL be available as a fallback to regenerate all views for a project.

#### Scenario: New dataset becomes queryable automatically
- **WHEN** the user uploads a new dataset through the web UI
- **AND** the project has SQL access enabled
- **THEN** the dataset is automatically synced to the query engine via an outbox event
- **AND** the dataset appears as a queryable table without manual intervention

#### Scenario: Updated transforms reflected automatically
- **WHEN** the user applies a new filter transform in the web UI
- **AND** the project has SQL access enabled
- **THEN** the transform change is automatically synced to the query engine
- **AND** connected tools see the updated results on the next query

#### Scenario: Force sync all datasets
- **WHEN** the user clicks "Force Sync" on the SQL access page
- **THEN** the system regenerates bootstrap SQL for all datasets and executes it in the engine
- **AND** returns a last_synced_at timestamp

#### Scenario: Removed dataset synced automatically
- **WHEN** the user deletes a dataset through the web UI
- **AND** the project has SQL access enabled
- **THEN** the dataset's view is automatically dropped from the engine via an outbox event

### Requirement: Multi-tenant isolation via schema-per-project in shared engine
The system SHALL isolate each project's data via per-project schemas within a shared query engine node. Proxy credentials for one project SHALL NOT grant access to another project's schema or data. Organization isolation is enforced by engine node scoping (each org has its own engine nodes).

#### Scenario: Organization isolation
- **WHEN** two organizations each have projects with SQL access enabled
- **AND** each org uses its own query engine node
- **AND** a user connects with Organization A's project credentials
- **THEN** the connection reaches only Organization A's engine node
- **AND** no data from Organization B is accessible

#### Scenario: Project isolation within an organization
- **WHEN** a user has SQL access enabled for two projects (A and B) on the same engine
- **AND** the user connects using Project A's proxy credentials
- **THEN** only Project A's schema and views are accessible
- **AND** Project B's schema is NOT visible through that connection

### Requirement: SQL access API endpoints
The system SHALL expose REST API endpoints for managing external SQL access, protected by the existing auth middleware with org_id scoping.

#### Scenario: Enable via API
- **WHEN** `POST /api/projects/{id}/sql-access` is called with a valid Bearer token
- **THEN** the system creates schemas and roles in the org's query engine and enables SQL access
- **AND** returns connection details (engine host, engine port, database, proxy username, password) with HTTP 201

#### Scenario: Disable via API
- **WHEN** `DELETE /api/projects/{id}/sql-access` is called with a valid Bearer token
- **THEN** the system drops schemas/roles in the engine and disables SQL access
- **AND** returns HTTP 204

#### Scenario: Get connection details via API
- **WHEN** `GET /api/projects/{id}/sql-access` is called with a valid Bearer token
- **THEN** the system returns connection details (engine host, port, database, proxy username, engine_node_id, sync_status per dataset — NOT password) with HTTP 200
- **AND** returns `enabled: false` if SQL access is not active

#### Scenario: Force sync via API
- **WHEN** `POST /api/projects/{id}/sql-access/sync` is called with a valid Bearer token
- **THEN** the system regenerates bootstrap SQL and executes it in the query engine
- **AND** returns HTTP 200 with `last_synced_at` timestamp

#### Scenario: Regenerate credentials via API
- **WHEN** `POST /api/projects/{id}/sql-access/credentials` is called with a valid Bearer token
- **THEN** the system generates a new proxy role password in the query engine
- **AND** returns the new plaintext password (one-time) with HTTP 200

#### Scenario: Auth enforcement
- **WHEN** any sql-access endpoint is called without a valid Bearer token
- **THEN** the system returns HTTP 401
- **WHEN** the token's org_id does not own the project
- **THEN** the system returns HTTP 403

### Requirement: External access metadata persistence
The system SHALL persist external access state in an `external_access` metadata table with fields: project_id, org_id, engine_node_id, pg_schema, pg_role (internal), pg_proxy_role, pg_password_hash (proxy), enabled, last_synced_at, created_at, updated_at. The table SHALL have a unique constraint on project_id and a foreign key to `query_engine_nodes`.

#### Scenario: Metadata created on enable
- **WHEN** SQL access is enabled for a project
- **THEN** an `external_access` record is created with enabled=true, engine_node_id, pg_schema, pg_role, pg_proxy_role, and proxy password hash

#### Scenario: Metadata updated on disable
- **WHEN** SQL access is disabled for a project
- **THEN** the `external_access` record is updated with enabled=false
- **AND** the record is NOT deleted (soft disable for audit trail)
- **AND** the engine_node_id is retained (for potential re-enable)

#### Scenario: Metadata updated on sync
- **WHEN** a sync event is processed for a project
- **THEN** the `external_access` record's `last_synced_at` is updated to the current timestamp

## REMOVED Requirements

### Requirement: Dynamic connection details
**Reason:** Connection details are now derived from the org's query engine node (stable endpoint), not dynamically assigned per project at provisioning time. The engine node's host and port are fixed for its lifetime.
**Migration:** Connection details in `ExternalAccessRecord` are replaced by a foreign key to `QueryEngineNode`. API responses derive host/port from the engine node.

### Requirement: Connection lifecycle
**Reason:** Disabling SQL access no longer deprovisions an environment. It only drops schemas and roles. The engine node continues running. Connection lifecycle at the engine level is managed by org admins, not project-level enable/disable.
**Migration:** The "Disabling terminates active connections" scenario is retained (connections are terminated when roles are dropped), but environment deprovisioning is removed.

### Requirement: SQL access status reporting
**Reason:** Replaced by query engine node health monitoring (in the `query-engine` spec) and per-dataset sync status. Status is no longer per-project-environment; it's per-engine-node + per-dataset-sync.
**Migration:** UI status indicators shift from environment status to engine node status + dataset sync status.
