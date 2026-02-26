# SQL Access: Connection Management — Feature Requirements

> **Author**: Business Analyst
> **Date**: 2026-02-26
> **Status**: Draft — pending Solutions Architect review
> **Prerequisite**: All items in `sql-access-fixes.md` are resolved ✅
> **Source**: `docs/backlog/sql-access-connection-management.md` (technical exploration)

---

## Problem Statement

Users who enable SQL Access get connection credentials that **break every time the underlying environment restarts**. This forces them to re-enter credentials in their BI tools (Excel, Tableau, Power BI, dbt) after any container restart, reprovisioning, or reconciliation event.

Additionally, users have no way to **pause** their SQL environment without fully disabling it (which destroys credentials and requires re-setup). There is no visibility into whether the environment is healthy, degraded, or stopped.

These two gaps — **credential instability** and **missing environment lifecycle controls** — make the SQL Access feature unreliable for production BI workflows where "connect once, query forever" is the expectation.

---

## User Personas

| Persona | Description | Key Need |
|---------|-------------|----------|
| **Data Analyst** | Uses Excel/Power BI to pull data from Dashboard Chat | Stable ODBC/JDBC connection string that never changes |
| **BI Engineer** | Sets up Tableau dashboards connected to project data | Reliable endpoint with clear status indicators |
| **Analytics Engineer** | Runs dbt projects against the SQL endpoint | Stable credentials for CI/CD pipelines and profiles.yml |
| **Project Admin** | Manages SQL Access for their team's project | Control over environment lifecycle and credential rotation |

---

## Feature Areas

### Feature 1: Stable Credentials

**Value**: Users configure their BI tool connection **once** and it survives environment restarts, reprovisioning, and reconciliation. No more broken connections.

#### User Stories

**US-1.1**: As a data analyst, I want my SQL connection credentials to remain valid across environment restarts, so that my Excel data connections don't break overnight.

**US-1.2**: As a project admin, I want to rotate my project's SQL credentials when needed (e.g., team member leaves), so that I can maintain access control without re-enabling the whole feature.

**US-1.3**: As a BI engineer, I want to copy a complete, stable connection string from the UI, so that I can paste it directly into my tool's connection dialog.

#### Acceptance Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-1.1 | When SQL Access is enabled, the user receives a username and password that do not change when the environment restarts | Connect from a BI tool, restart the environment, verify the same credentials still work |
| AC-1.2 | When the user clicks "Regenerate Credentials", a new password is issued and the old password stops working immediately for new connections | Regenerate, verify old password fails on new connection, verify new password works |
| AC-1.3 | The password is shown **one time only** after enable or regenerate — subsequent page loads show it masked with no recovery option | Enable, navigate away, return — password is masked; no "show password" reveals the original |
| AC-1.4 | The connection string displayed in the UI uses the stable endpoint (proxy port), not the ephemeral container port | Compare displayed port with the proxy's listen port |
| AC-1.5 | Disabling SQL Access invalidates the stable credentials permanently — re-enabling creates new ones | Disable, re-enable, verify old credentials no longer work |
| AC-1.6 | Credential regeneration is rate-limited to prevent abuse | Attempt rapid regeneration; system rejects after threshold |

#### Business Rules

- **BR-1.1**: Each project has exactly **one** set of stable credentials (single reader identity). Multi-user support is out of scope for this iteration.
- **BR-1.2**: The stable username follows the pattern `reader_{project_short_id}` (system-generated, not user-chosen). This keeps the UX simple — users don't need to think of a username.
- **BR-1.3**: The stable password is system-generated (32 characters, alphanumeric). Users cannot choose their own password.
- **BR-1.4**: Stable credentials are scoped to a single project. Credentials for Project A cannot access Project B's data.
- **BR-1.5**: Only the password hash is stored. The plaintext password is returned once in the API response and never persisted.

> **Decision Needed (UX)**: Should the username be user-editable in a future iteration? For now, system-generated keeps it simple. Flag for V2 if user feedback asks for it.

---

### Feature 2: Environment Lifecycle Controls

**Value**: Users can start, stop, and restart their SQL environment independently of enabling/disabling. Stopping pauses resource consumption without losing credentials. Starting brings it back with the same connection details.

#### User Stories

**US-2.1**: As a project admin, I want to stop the SQL environment when I'm not using it, so that I can save resources without losing my connection setup.

**US-2.2**: As a project admin, I want to start a stopped environment, so that my BI tools can reconnect using the same credentials they already have.

**US-2.3**: As a project admin, I want to restart the environment when it's degraded, so that I can self-service recover without contacting support.

**US-2.4**: As a data analyst, I want to see the current status of the SQL environment, so that I know whether my BI tool will be able to connect.

#### Acceptance Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-2.1 | The environment section shows the current status: Running, Stopped, Degraded, Provisioning, or Error | Check each state visually in the UI |
| AC-2.2 | When the user clicks "Stop", the environment shuts down but SQL Access remains enabled and credentials are preserved | Stop, verify credentials still appear in the connection card, verify BI tool gets connection refused |
| AC-2.3 | When the user clicks "Start" on a stopped environment, the environment provisions and the same stable credentials work | Start, connect from BI tool with original credentials |
| AC-2.4 | When the user clicks "Restart", the environment cycles (stop → start) and the stable credentials continue working | Restart while connected; reconnect with same credentials |
| AC-2.5 | During provisioning (start/restart), controls are disabled and a spinner is shown | Click start, verify buttons are disabled during provisioning |
| AC-2.6 | If the environment is in an error state, the UI shows the error message and offers a "Retry" action | Simulate error, verify error message is displayed |
| AC-2.7 | Environment status auto-refreshes (polling or push) so the user doesn't need to manually reload | Start environment from CLI; verify UI updates within a reasonable interval |

#### Business Rules

- **BR-2.1**: Enable/Disable and Start/Stop are **distinct operations**:
  - **Enable** = create credentials + create proxy + start environment (full setup)
  - **Disable** = destroy credentials + destroy proxy + stop environment (full teardown)
  - **Start** = provision container only (credentials and proxy already exist)
  - **Stop** = deprovision container only (credentials and proxy preserved)
- **BR-2.2**: Start/Stop controls are only available when SQL Access is **enabled**. If disabled, only the "Enable" button is shown.
- **BR-2.3**: While stopped, the connection card still shows credential fields (username, host, port, etc.) with a note that the environment is not running.
- **BR-2.4**: Restarting a running environment does **not** invalidate credentials.

#### State Machine

```
                    ┌──────────────────────────────────────────────────────┐
                    │                  SQL Access Disabled                  │
                    │              [Enable SQL Access] button               │
                    └──────────────────┬───────────────────────────────────┘
                                       │ Enable
                                       ▼
                    ┌──────────────────────────────────────────────────────┐
                    │                   Provisioning                        │
                    │              spinner, controls disabled               │
                    └──────────────────┬──────────────────┬────────────────┘
                              Success │                  │ Failure
                                      ▼                  ▼
┌───────────────────────────────────────────┐  ┌──────────────────────────┐
│            Running (Healthy)               │  │         Error            │
│  status: green · [Stop] [Restart]          │  │  status: red · [Retry]   │
│  connection card: fully usable             │  │  shows error message     │
└─────┬────────────────┬────────────────────┘  └──────────────────────────┘
      │ Stop           │ health degrades
      ▼                ▼
┌─────────────────┐  ┌──────────────────────────────────────────────────────┐
│     Stopped      │  │          Running (Degraded)                          │
│  status: gray    │  │  status: yellow · warning message · [Restart]        │
│  [Start]         │  └──────────────────────────────────────────────────────┘
│  card: visible   │
│  but env offline │
└─────────────────┘

From any enabled state:
  [Disable SQL Access] → tears down everything → returns to Disabled
```

---

### Feature 3: Connection Card Refinements

**Value**: Users can quickly and accurately copy connection details into their BI tools. Sensitive fields are clearly distinguished from non-sensitive ones. The full connection string is available for tools that accept a URI.

#### User Stories

**US-3.1**: As a data analyst, I want to copy individual connection fields (host, port, username, etc.) one at a time, so that I can fill in my BI tool's connection form field by field.

**US-3.2**: As a BI engineer, I want to copy a complete `postgresql://` connection string, so that I can paste it into tools that accept a single URI.

**US-3.3**: As a data analyst, I want to clearly see which fields are sensitive (password) vs. safe to share (host, port, database), so that I don't accidentally expose credentials.

#### Acceptance Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-3.1 | Every connection field (host, port, database, username, password, schema) has an individual copy button | Click each copy button, verify clipboard content |
| AC-3.2 | A complete `postgresql://` connection string is shown below the field grid with its own copy button | Copy connection string, verify it's valid and contains all fields |
| AC-3.3 | The connection string is masked by default (like the password) with an eye toggle to reveal it | Verify masked on load, verify reveal/hide toggle works |
| AC-3.4 | The password field shows `••••••••` by default with an eye toggle, matching the existing behavior | Verify default state is masked |
| AC-3.5 | Host, port, database, username, and schema are shown in cleartext (not masked) since they are low-sensitivity | Verify these fields are always visible |
| AC-3.6 | Copy buttons show a brief "Copied" confirmation (checkmark or tooltip) | Click copy, verify feedback appears and disappears |
| AC-3.7 | The "Last synced" timestamp is displayed with a relative time format (e.g., "2 minutes ago") | Enable, sync, verify timestamp updates |

#### UX Notes

- **Field layout**: Two-column grid — label on left, value + actions on right. Consistent with current `DetailRow` pattern.
- **Monospace values**: Connection detail values should use monospace font for easy reading and accurate copying.
- **Copy feedback**: Brief checkmark animation (≤2 seconds) on the copy button, matching the existing `CopyButton` component behavior.
- **Connection string format**: `postgresql://{username}:{password}@{host}:{port}/{database}?options=--search_path%3D{schema}`
  - When masked: `postgresql://reader_a1b2...@sql...` (truncated)
  - When revealed: Full URI

---

### Feature 4: Status Visibility & Health Indicators

**Value**: Users can see at a glance whether their SQL environment is healthy, degraded, or offline — without needing to attempt a connection from their BI tool to find out.

#### User Stories

**US-4.1**: As a data analyst, I want to see a clear status indicator next to my SQL Access panel, so that I know if my environment is ready for queries.

**US-4.2**: As a project admin, I want to see a warning when the environment is degraded, so that I can proactively restart before my team's dashboards break.

#### Acceptance Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC-4.1 | A color-coded status badge is displayed: green (healthy), yellow (degraded), gray (stopped), red (error) | Verify each state renders the correct color |
| AC-4.2 | The status label is human-readable: "Running", "Degraded", "Stopped", "Provisioning", "Error" | Verify labels in each state |
| AC-4.3 | Degraded state shows a brief warning message explaining the issue (e.g., "Environment may need restart") | Verify warning text |
| AC-4.4 | Error state shows the error message returned from the backend | Simulate error, verify message displayed |
| AC-4.5 | The status auto-refreshes periodically so users see state changes without manually reloading | Change state externally, verify UI catches up |

---

## Cross-Cutting Concerns

### Multi-Tenancy

- All credential mappings and environment operations are scoped by `org_id` through the parent project
- No API endpoint should allow accessing another organization's credentials or environment
- Status polling must filter by the authenticated user's org

### Existing Behavior Preserved

- The existing "Enable SQL Access" button, disable confirmation dialog, sync, and regenerate flows continue to work
- Regenerate now rotates the **stable** password (not the ephemeral one — that's an internal detail)
- The sync operation continues to refresh dataset views without affecting credentials

### Error Handling

- If the environment fails to start, the UI should show the error state (not a forever-spinner)
- If credentials fail to regenerate, the old credentials should remain valid (no partial state)
- Network errors on status polling should degrade gracefully (show last-known state, not an error)

---

## Open Questions (for BA / Product)

| # | Question | Recommendation | Impact |
|---|----------|----------------|--------|
| 1 | Should the stable username be user-chosen or system-generated? | **System-generated** (`reader_{short_id}`). Simpler UX, avoids uniqueness conflicts, matches current pattern. | Low — can be revisited in V2 |
| 2 | Should we support multiple stable users per project? | **No, single reader per project for V1.** Multi-user adds complexity (role management UI, permission matrix) without clear demand. | Medium — would change data model if added later |
| 3 | Should the environment auto-stop after inactivity? | **Not in V1.** Idle session timeout (5min) already exists at the PostgreSQL role level. Auto-stop is an optimization for later. | Low |
| 4 | What's the polling interval for status refresh? | **Every 15 seconds** when the panel is visible. Stop polling when panel is hidden. | Low — tunable |

---

## Deferred to Solutions Architect

The following technical decisions are documented in the backlog but are **not in scope for BA requirements**. They are flagged for the SA to evaluate:

1. **Credential proxy technology** — PgBouncer vs. application-layer proxy vs. FDW. The backlog recommends PgBouncer with `auth_query`. SA should validate.
2. **Proxy deployment model** — Sidecar per project vs. shared instance. The backlog recommends sidecar. SA should evaluate trade-offs.
3. **Port assignment strategy** — Dynamic auto-assign vs. deterministic mapping. Affects connection string stability.
4. **TLS termination** — Whether the proxy endpoint needs TLS for non-localhost access. Affects security posture.
5. **Credential storage encryption** — Application-level vs. database-level encryption for ephemeral credentials in the mapping table. Affects security architecture.
6. **Migration strategy** — How to handle existing enabled SQL Access projects during the transition (credential mapping backfill, PgBouncer rollout).

---

## Relationship to Existing Specs

This feature set **extends** the scenarios in `features/external-data-access.feature`. Specifically:

| Existing Scenario | Extended By |
|-------------------|-------------|
| "Enable external SQL access" | Now also provisions stable credentials + proxy |
| "Copy connection details to clipboard" | Enhanced with per-field copy and connection string |
| "Connection remains available while SQL access is enabled" | Now survives environment restarts (stable credentials) |
| "SQL access endpoint is unavailable" | Now has explicit status states and environment controls |
| "Disabling access terminates existing connections" | Now distinct from stopping (stop preserves credentials) |

New scenarios will be needed for: start/stop/restart lifecycle, credential stability across restarts, degraded state handling, and connection string masking.
