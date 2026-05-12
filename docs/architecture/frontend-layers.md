# Frontend Architecture

The frontend is a React 18 SPA (Vite + TypeScript) organized around a provider stack, context-driven state, and a core services layer. This document mirrors `backend-layers.md` — a layered walkthrough from outer (providers) to inner (services).

## Layer Diagram

```
User Interaction
    ↓
┌─────────────────────────────┐
│  Component (React)          │  UI rendering, user input, route params
├─────────────────────────────┤
│  Context / Hooks            │  ChatContext, AuthContext, TanStack Query hooks
├─────────────────────────────┤
│  Core Services              │  Chat client, SSE parser, tool execution, data catalog
├─────────────────────────────┤
│  API Layer                  │  fetch() with auth wrapper → backend REST + agent SSE
└─────────────────────────────┘
```

## Provider Stack

Providers are nested in a specific order. Each layer depends on the one above it.

```
BrowserRouter
 └─ AuthProvider          — OAuth, token storage, inactivity logout
     └─ QueryProvider     — TanStack Query client (5min stale, 10min GC)
         └─ StreamProvider — Stream.io Chat SDK initialization
             └─ ChatProvider — Chat engine: SSE, tool execution, context routing
                 └─ Routes (Outlet)
```

**Why order matters:**
- `QueryProvider` must wrap `StreamProvider` because the Stream token fetch uses TanStack Query
- `StreamProvider` must wrap `ChatProvider` because chat persistence writes to Stream channels
- `AuthProvider` is outermost because all downstream providers need the auth token

**Source:** `reverse-proxy/App.tsx` → `reverse-proxy/src/ui/components/AppShell/index.tsx`

### Provider Responsibilities

| Provider | What it provides | Key state |
|----------|-----------------|-----------|
| `AuthProvider` | `user`, `token`, `login()`, `logout()`, `handleCallback()` | Token in localStorage, inactivity timer |
| `QueryProvider` | TanStack `QueryClient` | 5min stale, 10min GC, no refocus refetch, retry: 1 |
| `StreamProvider` | `client` (Stream Chat SDK), `isReady` | Fetches token from `/api/stream/stream-token`, connects user |
| `ChatProvider` | `messages`, `handleSubmit()`, `setContext()`, `registerToolHandler()`, `isStreaming` | Message history, entity context, tool handler ref |

## Chat Engine

The chat engine (`useChatEngine.tsx`, ~678 lines) is the frontend's central orchestrator. It manages the full lifecycle of a chat interaction.

### Message Lifecycle

```
User types message
    ↓
1. Create Message {role: "user", content: text}
2. Build message history from Stream channel thread
3. POST /chat {messages, tableSchema, contextType, contextId}
    ↓
4. readSSEStream() parses AI SDK data stream:
   - "0:" prefix → text delta → append to assistant message
   - "9:" prefix → tool call array → store for execution
   - "r:" prefix → agent request (resolve_dataset) → fulfill and re-submit
   - "d:" prefix → stream done → check finish reason
   - "1:" prefix → error → display to user
    ↓
5. If tool calls exist + handler registered:
   - executeToolCalls(calls, toolHandler) → TanStack Table state updates
    ↓
6. Write assistant message to Stream channel for persistence
7. Component re-renders with updated messages / table state
```

**Source:** `reverse-proxy/src/ui/context/ChatContext/hooks/useChatEngine.tsx` — `submitText()` function

### Context Routing

The chat engine sends a `contextType` to the agent, which determines the tool set:

| contextType | When | Tools available |
|-------------|------|----------------|
| `"dataset"` | User has a dataset selected with schema | Table ops, cleaning, filtering |
| `"view"` | User has a view selected | View composition (joins, columns, grain) |
| `"report"` | User has a report (mart-layer model) selected | Report CRUD, dimensions, measures, filters, joins, materialization |
| `null` | No entity selected | `resolve_dataset` only |

```typescript
setContext(type: "dataset" | "view" | "report" | null, id: string | null)
```

When `contextType` is null and the user mentions a dataset, the agent calls `resolve_dataset`. The frontend intercepts this via the custom `"r:"` SSE prefix, searches for the dataset via `/api/projects/{projectId}/datasets/search?q=name`, sets the context, and re-submits the message.

**Source:** `reverse-proxy/src/core/chat/services/fulfillRequest.ts`

### Tool Handler Registration

Components that can execute tool calls register a handler with the chat engine:

```typescript
// In TableView:
registerToolHandler({
  execute: (toolCalls) => executeToolCalls(toolCalls, context),
});

// In ChatContext:
toolHandlerRef.current = handler;
```

This decouples the chat engine from specific tool implementations. The engine doesn't know about TanStack Table — it just calls the registered handler.

## SSE Stream Protocol

The agent uses the **Vercel AI SDK data stream protocol**. Each SSE line has a numeric prefix indicating the data type:

| Prefix | Type | Content |
|:------:|------|---------|
| `0:` | Text delta | JSON string — append to assistant message |
| `9:` | Tool calls | JSON array of `{toolCallId, toolName, args}` |
| `d:` | Done | `{finishReason}` — "stop", "tool-calls", or "request" |
| `r:` | Agent request | `{type, params}` — custom extension for resolve_dataset |
| `e:` | Step finish | Ignored |
| `1:` | Error | Error message string |

The `"r:"` prefix is a custom extension not part of the standard AI SDK protocol. The agent injects it by transforming the SSE stream when a `resolve_dataset` tool call is detected (see `agent/lib/chat/handleChat.ts`).

**Source:** `reverse-proxy/src/core/chat/services/chatStream.ts` — `readSSEStream()`

## Tool Execution Pipeline

### Tool Call Types

The `ToolCallArgs` discriminated union covers 16 tool types:

**Synchronous (TanStack Table state):**
- `filterTable`, `replaceColumnFilter`, `clearFilters` → `setColumnFilters()`
- `sortTable`, `clearSort` → `setSorting()`
- `addRow`, `deleteRow` → `setData()`

**Preview (display change, no persistence):**
- `trimWhitespace`, `standardizeCase`, `fillNulls`, `mapValues` → modify displayed data

**Async (API call + query invalidation):**
- `applyCleaningTransform` → `catalog.createTransform()` → invalidate dataset cache
- `undoCleaningTransform` → `catalog.updateTransform()` → invalidate dataset cache
- `reEnableCleaningTransform` → `catalog.toggleTransform()` → invalidate dataset cache
- `renameColumn` → `catalog.createTransform()` → invalidate dataset cache

### Execution Flow

```typescript
// 1. Validate args against expected shape
const parsed = validateToolCallArgs(toolCall);

// 2. Dispatch to appropriate handler
if (isSyncTool(parsed)) {
  // Direct state mutation via TanStack Table setters
  handlers.setColumnFilters((prev) => [...prev, newFilter]);
} else {
  // API call via data catalog, then invalidate query cache
  await catalog.createTransform(datasetId, transformData);
  queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId) });
}

// 3. Return result message for chat display
return { success: true, message: "Filter applied" };
```

**Source:** `reverse-proxy/src/core/toolCalls/executeToolCall.ts`, `reverse-proxy/src/core/toolCalls/types.ts`

## Data Fetching (TanStack Query)

### Key Factory Pattern

Query keys are structured hierarchically using factory functions:

```typescript
export const projectKeys = {
  all: ["projects"],
  detail: (id: string) => ["projects", id],
};

export const datasetKeys = {
  all: ["datasets"],
  lists: () => ["datasets", "list"],
  list: (projectId: string) => ["datasets", "list", projectId],
  detail: (id: string) => ["datasets", id],
};

export const viewKeys = {
  all: ["views"],
  lists: () => ["views", "list"],
  list: (projectId: string) => ["views", "list", projectId],
  details: () => ["views", "detail"],
  detail: (id: string) => ["views", "detail", id],
};
```

**Source:** `reverse-proxy/src/lib/queryKeys.ts`

### Stale Time Configuration

| Resource | Stale Time | Why |
|----------|-----------|-----|
| Project | 30s | Rarely changes during a session |
| Dataset list | 10s | New uploads should appear quickly |
| Dataset detail | 5min | Schema is stable; transforms invalidate explicitly |
| Transforms | 10s | Chat tool calls invalidate after mutations |
| Session list | 10s | New sessions should appear when created |

**Source:** `reverse-proxy/src/ui/hooks/queryConfig.ts`

### Mutation Pattern

All mutations follow the same structure — optimistic update, rollback on error, invalidate on settle:

```typescript
export function useRenameDataset(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ datasetId, name }) =>
      catalog.updateDataset(datasetId, { name }),
    onMutate: async ({ datasetId, name }) => {
      await queryClient.cancelQueries({ queryKey: datasetKeys.detail(datasetId) });
      const prev = queryClient.getQueryData(datasetKeys.detail(datasetId));
      queryClient.setQueryData(datasetKeys.detail(datasetId),
        (old) => old ? { ...old, name } : old
      );
      return { prev };
    },
    onError: (_err, { datasetId }, context) => {
      queryClient.setQueryData(datasetKeys.detail(datasetId), context?.prev);
    },
    onSettled: (_, __, { datasetId }) => {
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId) });
      queryClient.invalidateQueries({ queryKey: datasetKeys.list(projectId) });
    },
  });
}
```

## Data Catalog

All API calls go through a `DataCatalog` factory — no direct `fetch()` in components.

```typescript
const catalog = createDataCatalog(withAuth(fetch));
```

The factory accepts an injected `fetchFn` that wraps `fetch()` with auth headers. This pattern mirrors the backend's dependency injection — tests can inject a mock fetch.

**Key methods:** `listProjects()`, `getDataset()`, `createTransform()`, `listViews()`, `getReport()`, `createSession()`, `getSqlAccessStatus()`, etc.

**Types exported:** `Dataset`, `Project`, `View`, `Report`, `Session`, `QueryEngineDetail`, `SqlAccessStatus`, `ApiError`

**Source:** `reverse-proxy/src/core/dataCatalog/client.ts`

## Path Aliases

| Alias | Target | Purpose |
|-------|--------|---------|
| `@/toolCalls` | `src/core/toolCalls` | Tool call execution and types |
| `@/chat` | `src/core/chat` | Chat client, SSE stream, request fulfillment |
| `@/dataCatalog` | `src/core/dataCatalog` | REST API data access layer |
| `@/auth` | `src/core/auth` | Token storage, auth utilities |
| `@/http` | `src/lib/http` | HTTP client utilities |
| `@/stream` | `src/lib/stream` | Stream.io SDK integration |
| `@/queryTranslation` | `src/lib/queryTranslation` | Query builder translation logic |

**Source:** `reverse-proxy/tsconfig.json`, `reverse-proxy/vite.config.ts`

## State Management Philosophy

**No Redux or Zustand.** This is intentional, not an omission.

The frontend has three categories of state, each handled by the right tool:

| Category | Tool | Examples |
|----------|------|---------|
| **Server state** | TanStack Query | Datasets, projects, views, sessions — cached with invalidation |
| **Cross-component state** | React Context | Auth (token, user) and Chat (messages, streaming, context routing) |
| **Component-local state** | React hooks + refs | Form inputs, UI toggles, tool handler registration |

There are only **two contexts** (Auth and Chat), each with clear boundaries. TanStack Query handles the bulk of state management — caching, background refetching, optimistic mutations, and cache invalidation.

For non-reactive coordination, the chat engine uses **refs** (`toolHandlerRef`, `pendingCommandRef`, `inputRef`) to avoid unnecessary re-renders. **Module-level Maps** cache component state across navigations (e.g., table filter/sort state keyed by dataset ID).

**When to reconsider:** If `thread-collaboration` lands with real-time presence and collaborative editing, Zustand may be warranted for optimistic collaborative state. But the Stream.io SDK handles the transport layer, so context + hooks will likely still suffice.
