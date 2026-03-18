# Capability: Connection Card V2

**Status**: ADDED
**Domain**: sql-access

## Overview

Enhanced connection details card with per-field copy buttons, full connection string display, masked sensitive fields with eye toggles, status badges, and monospace formatting.

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│ SQL Access                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ● Running                                                  │
│                                                             │
│  Host        │ localhost                             [copy]  │
│  Port        │ 6433                                  [copy]  │
│  Database    │ dashboard_external                    [copy]  │
│  Username    │ reader_a1b2c3d4                       [copy]  │
│  Password    │ ••••••••••••••••            [eye]     [copy]  │
│  Schema      │ project_a1b2c3d4                      [copy]  │
│                                                             │
│  Connection String                                          │
│  postgresql://reader_a1b2...@...          [eye]      [copy]  │
│                                                             │
│  Last synced: 2 minutes ago                         [Sync]  │
│  [Regenerate Credentials]          [Disable SQL Access]     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Environment                                                 │
│                                                             │
│  Status: ● Running (healthy)                                │
│  [Stop]  [Restart]                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Field Behaviors

### Non-Sensitive Fields (Always Visible)
- **Host**: cleartext, monospace font, individual copy button
- **Port**: cleartext, monospace font, individual copy button
- **Database**: cleartext, monospace font, individual copy button
- **Username**: cleartext, monospace font, individual copy button
- **Schema**: cleartext, monospace font, individual copy button

### Sensitive Fields (Masked by Default)
- **Password**: shows `••••••••••••••••` by default
  - Eye toggle reveals/hides the password
  - Password is only available in local component state immediately after enable or regenerate
  - After navigating away and returning, password shows as masked with no reveal option (no recovery)
  - A "Save this password — it won't be shown again" warning appears when the password is visible
- **Connection String**: shows truncated/masked version by default (e.g., `postgresql://reader_a1b2...@loc...`)
  - Eye toggle reveals full connection string
  - When password is not available (navigated away), the connection string omits the password portion

### Copy Behavior
- Each field has an individual copy button (clipboard icon)
- Clicking copy shows a brief checkmark confirmation (2 seconds), consistent with existing `CopyButton` component
- Password copy button copies the actual password (only functional when password is in local state)
- Connection string copy button copies the full string including password (when available)

### Connection String Format
```
postgresql://{username}:{password}@{host}:{port}/{database}?options=--search_path%3D{schema}
```

When password is not available:
```
postgresql://{username}@{host}:{port}/{database}?options=--search_path%3D{schema}
```

### Status Badge
- Color-coded dot next to the section header:
  - Green: Running (healthy)
  - Yellow: Running (degraded) — includes warning text
  - Gray: Stopped
  - Blue spinner: Provisioning
  - Red: Error — includes error message
- Human-readable label: "Running", "Degraded", "Stopped", "Provisioning", "Error"

### Last Synced Timestamp
- Displayed in relative time format: "2 minutes ago", "just now", etc.
- Sync button triggers dataset view refresh

### Legacy Record Banner
- Shown when `is_legacy === true` in the API response
- Banner text: "SQL Access needs to be reconfigured for stable credentials. Please disable and re-enable."
- Includes "Disable SQL Access" button
- Connection card is hidden for legacy records

## Environment Controls Section

Below the connection card:

- **Running state**: Shows "● Running (healthy)" with [Stop] and [Restart] buttons
- **Degraded state**: Shows "● Running (degraded)" with warning message and [Restart] button
- **Stopped state**: Shows "● Stopped" with [Start] button
  - Connection card remains visible with a note: "Environment is stopped — start it to accept connections"
- **Provisioning state**: Shows spinner with "Provisioning..." text, all buttons disabled
- **Error state**: Shows "● Error" with error message and [Retry] button
