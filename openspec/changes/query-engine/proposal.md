# Query Engine: Org-Level Persistent Query Access Layer

## Problem

SQL access is currently a per-project, ephemeral feature. Each time a user enables it, the system spins up a dedicated container with dynamic connection details. When disabled, it's gone. Users who configure BI tools (Tableau, Power BI, Excel/ODBC) must reconfigure every time the endpoint changes.

Meanwhile, the web application runs analytical queries (dataset previews, row counts, cleaning previews) in-process on the API server. A heavy query can starve HTTP handling or crash the server.

Both problems point to the same solution: a persistent, org-level query engine that serves as the analytical access layer for both the platform and external tools.

## Vision

The query engine is a **thin, stateless access layer**. It holds no data — all data lives in the data lake (S3/MinIO as Parquet files). The engine's job is to enforce permissions and map schemas so that queries resolve to the correct lake data. All permission and mapping configuration lives in the backend data catalog (SQLite/PostgreSQL), which is the source of truth. The engine is kept in sync via event-driven propagation.

Users should think of the query engine as a window into their data lake — always available, stable connection details, queryable from any PostgreSQL-compatible tool.

## What Changes for Users

### Before (current)
- SQL access is a per-project on/off toggle
- Enabling provisions a container; disabling destroys it
- Connection details (host, port) change each time
- BI tools need reconfiguration after every disable/enable cycle
- No visibility into what's running
- Web app queries run in-process (affects performance)
- Manual "Sync" required after every dataset or transform change

### After (proposed)
- Query engines are **org-level resources** — always running, shared across projects
- Connection details are **stable and persistent** — configure your BI tool once
- Users can see how many query engine nodes their org has and their status
- ODBC/JDBC connection info is always available
- Dataset uploads and transform changes **automatically sync** to the engine (event-driven)
- Credentials are **obfuscated** — regenerable without disrupting the underlying permission and schema scaffolding
- The web app uses the engine for all analytical queries (better performance, security isolation)

## Core Design Principles

### 1. Engine as Access Layer, Lake as Storage
The query engine stores no data. It maps schemas and enforces permissions so queries resolve to Parquet files in the data lake. If the engine is destroyed and rebuilt, no data is lost — only the permission/mapping configuration needs to be re-synced from the catalog.

### 2. Catalog as Source of Truth
All permission grants, schema mappings, dataset-to-table associations, and credential records live in the backend data catalog (SQLite/PostgreSQL). The query engine is a downstream consumer of this configuration. The catalog can fully reconstruct an engine's state.

### 3. Event-Driven Sync
When a user uploads a dataset, applies a transform, or changes permissions, the backend catalog updates first, then propagates the change to the engine. The user should not need to click "Sync" for routine operations. The experience should feel seamless — upload a CSV, and it's queryable externally within seconds.

### 4. Obfuscated Credentials
Connection credentials presented to users are proxy credentials that can be rotated without altering the underlying permission scaffolding (roles, schema grants, search paths). If a user's credentials leak, an admin regenerates them and the user gets a new connection string — but the role structure, schema mappings, and permission grants remain intact. The mechanism for credential obfuscation (e.g., PgBouncer auth mapping, proxy roles) is left to the architect.

## Requirements

### R1: Org-Level Query Engine Lifecycle

Query engines are provisioned at the organization level. An organization has one or more engine nodes.

- An org admin can see all engine nodes for their organization
- Each engine node has a stable endpoint (host, port) that persists for its lifetime
- Engine nodes run continuously — they are not tied to project-level actions
- The backend models a **1:many relationship** between organizations and engine nodes
- The frontend displays multiple engine nodes when present
- Provisioning, scaling, and deployment of additional nodes is out of scope — the data model and UI support it, but orchestration is deferred

### R2: Query Engine Dashboard

Users need a place to see their org's engine nodes and connection details.

**Engine List View** (accessible from org settings or navigation):
- Shows all engine nodes for the organization
- Each node displays: name/label, status (running, degraded, unreachable), endpoint (host:port), project count
- Status updates automatically (event-driven or short-interval polling)

**Engine Detail View** (click into a specific node):
- Connection information:
  - Host, Port, Database name
  - ODBC connection string (copyable, pre-formatted)
  - JDBC connection string (copyable, pre-formatted)
  - PostgreSQL connection string (copyable, pre-formatted)
- Connected projects: list of projects using this node, each showing schema name and sync status
- Quick-start connection guides:
  - Excel (ODBC) — driver + connection string
  - Power BI — server/database fields
  - Tableau — connector setup
  - psql — CLI command
  - dbt — profiles.yml snippet

### R3: Project-Level Permissions & Sync Page

The per-project SQL access panel is reworked as a **permissions and sync status page**. It does not manage engine lifecycle — it shows what's mapped and whether it's current.

**When SQL access is enabled for a project:**
- The page shows which engine node the project is connected to
- Lists all datasets in the project with their sync status:
  - Synced — schema mapping exists in the engine, up to date
  - Pending — dataset or transform changed, sync event in flight
  - Error — sync failed (with error detail)
- Shows the project's reader credentials (obfuscated, with regenerate option)
- Links to the engine detail view for full ODBC/JDBC connection info
- "Force Sync" button for manual re-sync if needed (fallback, not primary workflow)

**When SQL access is not enabled:**
- Simple prompt to enable, which creates the project's schema/role/mappings in the org's engine
- No container provisioning — just catalog entries and engine sync

### R4: Event-Driven Dataset Sync

When a dataset is created or modified, the system automatically propagates changes to the query engine without user intervention.

**Dataset creation (file upload):**
1. User uploads CSV → Parquet written to data lake
2. Backend catalog creates dataset record with schema mapping
3. Sync event fires → engine receives mapping (CREATE VIEW pointing to Parquet in lake)
4. Dataset is queryable externally within seconds — no manual sync step

**Transform changes (filter, clean, alias):**
1. User applies/modifies/disables a transform in the web UI
2. Backend catalog updates transform record
3. Sync event fires → engine receives updated view definition (new CTE pipeline)
4. Next external query reflects the change

**Dataset deletion:**
1. User deletes a dataset
2. Backend catalog marks dataset as deleted
3. Sync event fires → engine drops the view
4. External tools no longer see the table

**Sync status visibility:**
- The project permissions page shows per-dataset sync state
- A brief "syncing..." indicator appears after changes, resolves to "synced" on confirmation
- If a sync event fails, the dataset shows an error state with retry option

### R5: Obfuscated, Regenerable Credentials

Credentials presented to users are decoupled from the underlying permission structure.

- Users receive a connection string with a username and password
- These credentials are a **proxy layer** — rotating them does not require rebuilding roles, schemas, or grants
- "Regenerate Credentials" produces a new username/password pair. The old credentials stop working immediately. The project's data access, schema mappings, and permission grants are unaffected.
- Password is shown once at creation/regeneration (one-time reveal), then masked
- The credential obfuscation mechanism (PgBouncer auth, proxy roles, etc.) is left to the architect

### R6: Per-Project Data Isolation (Unchanged)

Even though engines are shared, project data remains isolated.

- Each project gets its own schema within the engine
- Credentials for Project A cannot query Project B's data
- External tools see only the datasets for the authenticated project
- Read-only enforcement: no INSERT, UPDATE, DELETE, CREATE, DROP
- Connection limits per project role still apply

### R7: Status Visibility

Users need confidence that their BI tool connections will work.

- Engine node status is visible: running, degraded, unreachable
- Per-project sync status is visible: synced, pending, error
- If an engine is degraded or unreachable, the UI explains the issue
- Connection test: "Test Connection" button on the engine detail view that verifies reachability

## Out of Scope (For Solutions Architect)

These are technical concerns for the architect to address in a design document:

- Container orchestration and engine deployment strategy
- How the web app routes internal queries to the engine (connection pooling, asyncpg)
- Query engine runtime (PostgreSQL + pg_duckdb, or alternatives)
- S3/MinIO credential management within the engine
- Resource limits (memory, CPU, statement timeout)
- Credential obfuscation mechanism (PgBouncer auth mapping, proxy roles, token-based auth)
- Event propagation infrastructure (message queue, webhooks, DB triggers, or polling fallback)
- Migration path from current per-project containers to shared engines
- Multi-node engine topology and load balancing
- Engine rebuild/recovery procedure from catalog state
- Monitoring and alerting

## Impact on Existing Features

### External Data Access Feature
The `external-data-access.feature` spec needs significant revision. A new `query-engine.feature` captures the updated UX. The old per-project toggle model is replaced by org engines + project enrollment + event-driven sync.

### Dataset Upload Flow
Upload now triggers an automatic sync event to the engine. The upload workflow itself doesn't change for the user — they just no longer need a manual sync step afterward.

### dbt Export
No UX changes. Exported profiles.yml references the stable engine endpoint. Connection details come from the engine node, not from ephemeral provisioning.

### Chat/Table Operations
No UX changes. The web app uses the engine for previews and operations, but this is invisible to the user.

### Auth & Multi-Tenancy
Query engines are scoped by `org_id`. Engine management requires org-level permissions. Project enrollment requires project-level permissions.
