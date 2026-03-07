# Capability: External SQL Access (Modifications)

**Status**: MODIFIED
**Domain**: sql-access

## Changes

### Enable Flow
- **ADDED**: Allocates a stable proxy port from the configurable range
- **ADDED**: Provisions a PgBouncer sidecar container alongside pg_duckdb
- **ADDED**: Generates md5 PostgreSQL hash (replaces bcrypt) for credential storage
- **MODIFIED**: `environment_host` and `environment_port` now point to the PgBouncer proxy (stable endpoint) instead of the pg_duckdb container (ephemeral)
- **ADDED**: Stores `proxy_container_id` in the metadata record
- **ADDED**: Sets `environment_status = "running"` on successful enablement
- **ADDED**: Compensation on PgBouncer failure: deprovision pg_duckdb, release port

### Disable Flow
- **ADDED**: Removes PgBouncer container before pg_duckdb container
- **ADDED**: Clears `proxy_container_id` on disable
- **ADDED**: Frees allocated port (sets `environment_port = NULL`)

### Regenerate Credentials
- **MODIFIED**: Generates md5 hash instead of bcrypt
- **ADDED**: Recreates PgBouncer with new auth_file after updating pg_duckdb role
- **ADDED**: Rate limiting: reject if < 60 seconds since last regeneration (HTTP 429)
- **UNCHANGED**: Returns one-time plaintext password in response

### Sync
- **UNCHANGED**: Regenerates dataset views in pg_duckdb
- **UNCHANGED**: Does not affect credentials or proxy

### Reconciliation (Startup)
- **ADDED**: Checks PgBouncer container health alongside pg_duckdb
- **ADDED**: Re-applies md5 hash to pg_duckdb reader role after container restart (credential restoration)
- **ADDED**: Recreates PgBouncer if proxy container exited unexpectedly
- **ADDED**: Updates `environment_status` field based on container states
- **ADDED**: Skips proxy checks for legacy records (proxy_container_id IS NULL)

### Get SQL Access
- **ADDED**: Returns `environment_status` field in response
- **ADDED**: Returns `status_message` field in response
- **ADDED**: Returns `is_legacy` flag (true if proxy_container_id is null and enabled)

### Data Model
- **ADDED**: `proxy_container_id` column (String, nullable)
- **ADDED**: `environment_status` column (String, default "running")
- **ADDED**: `status_message` column (Text, nullable)
- **MODIFIED**: `pg_password_hash` format changes from bcrypt to md5 PostgreSQL hash

### Multi-Tenancy
- **UNCHANGED**: All operations scoped by org_id through parent project
- **UNCHANGED**: Credential mappings isolated per project
- **ADDED**: Port allocation is global (not org-scoped) since ports are a host-level resource
