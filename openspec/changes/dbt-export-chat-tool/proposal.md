# dbt Export Chat Tool

## Why

The dbt project export backend is fully built (`backend/app/use_cases/project/_dbt/` — 12 modules covering sources, staging, intermediate, marts, naming, profiles, schema, bootstrap). The API spec exists (`openspec/specs/dbt-export-api/spec.md`) defining the `GET /api/projects/{project_id}/export/dbt` endpoint with StreamingResponse, auth, and error handling. But there is no way for a user to trigger this from chat.

The product vision's Stage 4 (Handoff) is: "Export the entire project as a 4-layer dbt archive." For the CSV-first flow, once a user has uploaded CSVs, cleaned data, built views, and defined reports — they should be able to say "export my project as dbt" and receive the download. Without a chat tool, users must know the API endpoint exists and call it directly, breaking the chat-first UX.

This is a small, focused change: one agent tool definition, one backend route (per the existing spec), and one frontend download function.

## What Changes

### Agent Tool
- New tool `exportDbtProject` available in all context types (dataset, view, report, null) — export is a project-level action, not context-specific
- Tool takes no parameters (project is already known from the chat session context)
- Tool calls the backend export endpoint and returns a download URL or triggers a browser download
- System prompt addition: brief instruction that the agent can export the project as a dbt archive when asked

### Backend Route
- Implement `GET /api/projects/{project_id}/export/dbt` per the existing `dbt-export-api` spec
- StreamingResponse with `application/zip` content type
- Auth + org_id scoping per existing patterns
- Error handling: 404 (project not found), 403 (wrong org), 400 (broken source references)

### Frontend Download Function
- Fetch the export endpoint with auth headers
- Extract filename from Content-Disposition header (fallback: `export.zip`)
- Trigger browser download via temporary anchor element + blob URL
- Error handling for non-OK responses

## Capabilities

### New Capabilities
- `dbt-export-chat-tool`: Agent tool definition for triggering dbt project export from chat

### Modified Capabilities
- `dbt-export-api`: Implementation of the already-specified endpoint (spec exists, code path exists in `_dbt/`, route does not)

## Impact

- `agent/lib/chat/tools.ts` (or new `projectToolDefinitions.ts`) — new tool definition
- `agent/lib/chat/handleChat.ts` — include export tool in all context branches
- `backend/app/routers/projects.py` — new export route
- `frontend/src/lib/api/client.ts` or new export utility — download function
- No database migrations
- No new dependencies
