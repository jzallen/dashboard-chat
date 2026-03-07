# Capability: Environment Lifecycle Controls

**Status**: ADDED
**Domain**: sql-access

## Overview

Start, stop, and restart the pg_duckdb container independently of enabling/disabling SQL Access. Stopping pauses resource consumption without losing credentials. Starting brings the environment back with the same connection details.

## State Machine

```
                    ┌─────────────────────────────────────────┐
                    │           SQL Access Disabled            │
                    │         [Enable SQL Access]              │
                    └──────────────┬──────────────────────────┘
                                   │ Enable
                                   v
                    ┌─────────────────────────────────────────┐
                    │            Provisioning                  │
                    │       spinner, controls disabled         │
                    └──────┬─────────────────────┬────────────┘
                   Success │                     │ Failure
                           v                     v
┌────────────────────────────────────┐  ┌─────────────────────────┐
│        Running (Healthy)           │  │          Error           │
│  ● green · [Stop] [Restart]       │  │  ● red · [Retry]        │
│  connection card: fully usable     │  │  shows error message     │
└────┬───────────────┬───────────────┘  └─────────────────────────┘
     │ Stop          │ health degrades
     v               v
┌────────────────┐  ┌────────────────────────────────────────────┐
│    Stopped     │  │         Running (Degraded)                 │
│  ● gray        │  │  ● yellow · warning · [Restart]           │
│  [Start]       │  └────────────────────────────────────────────┘
│  card visible  │
│  env offline   │
└────────────────┘

From any enabled state:
  [Disable SQL Access] → destroys everything → returns to Disabled
```

## Operations

### Enable (existing, extended)
- Creates credentials + PgBouncer proxy + pg_duckdb container
- Full setup from scratch
- Transitions: Disabled → Provisioning → Running or Error

### Disable (existing, extended)
- Destroys credentials + PgBouncer proxy + pg_duckdb container
- Complete teardown
- Transitions: Any enabled state → Disabled

### Start (new)
- Provisions pg_duckdb container only (PgBouncer already exists)
- Re-creates reader role from stored md5 hash
- Re-bootstraps views from current datasets
- Recreates PgBouncer to point to new pg_duckdb upstream
- Transitions: Stopped → Provisioning → Running or Error

### Stop (new)
- Removes pg_duckdb container only
- PgBouncer stays running (returns "server not available" to clients)
- Credentials and proxy port are preserved
- Transitions: Running → Stopped

### Restart (new)
- Stop + Start in sequence
- Credentials preserved throughout
- Transitions: Running → Provisioning → Running or Error

### Retry (new, from Error state)
- Same as Start — attempts to provision pg_duckdb again
- Transitions: Error → Provisioning → Running or Error

## Behaviors

### Status Tracking
- The `environment_status` field is persisted in `ExternalAccessRecord`
- Valid values: `"running"`, `"stopped"`, `"degraded"`, `"provisioning"`, `"error"`
- The `status_message` field provides human-readable detail for non-running states
- Status is determined by checking both PgBouncer and pg_duckdb container states

### Status Determination
| PgBouncer | pg_duckdb | Status |
|-----------|-----------|--------|
| Running | Running | `running` |
| Running | Stopped | `stopped` |
| Running | Starting | `provisioning` |
| Stopped | Running | `degraded` |
| Stopped | Stopped | `stopped` |
| Either | Error | `error` |

### Control Availability
- Start: only when status is `stopped` or `error`
- Stop: only when status is `running` or `degraded`
- Restart: only when status is `running` or `degraded`
- Disable: available in any enabled state
- All controls disabled during `provisioning`

### Auto-Refresh
- Status endpoint polled every 15 seconds when the SQL Access panel is visible
- Polling pauses when the panel is not visible (tab hidden, navigated away)
- Network errors during polling show last-known status with staleness indicator

## API

### POST /api/projects/{project_id}/sql-access/environment/start
- Precondition: SQL Access enabled, status is `stopped` or `error`
- Returns: Updated SQL access details with `environment_status: "running"`
- Error 409: Environment already running
- Error 404: SQL Access not enabled

### POST /api/projects/{project_id}/sql-access/environment/stop
- Precondition: SQL Access enabled, status is `running` or `degraded`
- Returns: `{project_id, environment_status: "stopped"}`
- Error 409: Environment already stopped
- Error 404: SQL Access not enabled

### POST /api/projects/{project_id}/sql-access/environment/restart
- Precondition: SQL Access enabled, status is `running` or `degraded`
- Returns: Updated SQL access details with `environment_status: "running"`
- Error 404: SQL Access not enabled

### GET /api/projects/{project_id}/sql-access/environment/status
- Returns: `{project_id, environment_status, status_message, pgduckdb_running, pgbouncer_running}`
- Always succeeds (200) if SQL Access is enabled
- Error 404: SQL Access not enabled
