# Capability: React Patterns and Cleanup

**Status**: MODIFIED
**Domain**: frontend (components, context, hooks, api)

## Overview

Fix React anti-patterns, SSE stale closures, timer leaks, accessibility gaps, and inconsistent patterns across the frontend.

---

## MODIFIED Requirements

### Requirement: DatasetView Effect Splitting

The large `useEffect` in `DatasetView/index.tsx` SHALL be split into separate memoized computations and a minimal effect.

- Alias map computation SHALL be a `useMemo` dependent on `dataset?.transforms`.
- Active filter computation SHALL be a `useMemo` dependent on `columnFilters`.
- The remaining `useEffect` SHALL only handle side-effects (e.g., `registerTableSchema`).

#### Scenario: Filter change does not recompute alias map

- **WHEN** a column filter changes
- **THEN** the alias map `useMemo` SHALL NOT recompute (its dependency is transforms, not filters)

---

### Requirement: Async Tool Call Cleanup

Async operations in `DatasetView`'s `executeToolCall` callback SHALL use the mutation system or AbortController for proper cleanup.

- Fire-and-forget IIFEs for transform persistence SHALL be replaced with `useMutation` calls.
- If the component unmounts during an async operation, no state update SHALL be attempted.

---

### Requirement: Token Refresh Promise Cleanup

The `refreshPromise` singleton in `fetchUtils.ts` SHALL be cleared synchronously in `.finally()`.

- The 500ms `setTimeout` delay before clearing SHALL be removed.
- Clearing SHALL happen immediately when the refresh settles (success or failure).

#### Scenario: Rapid concurrent requests after token refresh

- **WHEN** a token refresh completes and new requests arrive immediately
- **THEN** the requests SHALL use the new token directly
- **THEN** no duplicate refresh SHALL be triggered

---

### Requirement: SSE Ref Capture at Stream Start

The `handleSubmit` function in `ChatContext.tsx` SHALL capture ref values at the start of the stream.

- `toolHandlerRef.current`, `tableSchemaRef.current`, and `projectUpdaterRef.current` SHALL be captured into local variables before the SSE stream loop begins.
- The stream processing loop SHALL use these captured values, not the live refs.

#### Scenario: Tool handler changes during stream

- **WHEN** the component re-renders and `toolHandlerRef.current` changes mid-stream
- **THEN** the stream SHALL continue using the handler captured at stream start

---

### Requirement: Session ID Reset on Error

`ChatContext.tsx` SHALL clear `sessionIdRef.current` when an SSE stream fails.

- In the catch block of `handleSubmit`, `sessionIdRef.current` SHALL be set to `null`.
- The next chat submission SHALL create a new session.

---

### Requirement: Breadcrumb Accessibility

`Breadcrumb.tsx` SHALL use semantic `<button>` elements instead of `<span role="button">`.

- Clickable breadcrumb items SHALL use `<button>` with appropriate styling.
- Manual `onKeyDown` handling for Enter key SHALL be removed (buttons handle Enter and Space natively).

---

### Requirement: Component Memoization

Frequently-rendered presentational components SHALL be wrapped in `React.memo`.

- `ChatPanel` SHALL be exported with `React.memo`.
- `removeFilter` in `ActiveFilters` SHALL be wrapped in `useCallback`.
- `scroll` in `DatasetCarousel` SHALL be wrapped in `useCallback`.

---

### Requirement: Timer Cleanup

Components using `setTimeout` SHALL clean up timers on unmount.

- `CopyButton` in `SqlAccessPanel` SHALL clear its copy-state timer when the component unmounts.
- The timer pattern SHALL use `useEffect` with a cleanup return.

---

### Requirement: Shared Error Utility

A shared `getErrorMessage(error: unknown): string` function SHALL be created.

- All catch blocks that extract error messages SHALL use this utility.
- The function SHALL handle `Error` instances, strings, and unknown values.

---

### Requirement: Config URL Consolidation

All API URL constants SHALL be defined in a single module.

- `API_BASE_URL` and `CHAT_URL` SHALL both be exported from `api/config.ts` (or equivalent).
- `client.ts` and `fetchUtils.ts` SHALL import from the same source.

---

### Requirement: Consistent Component Styling

`CreateOrg` and `LoginPage` SHALL use CSS modules instead of inline `style` objects.

- Layout styling SHALL match the CSS module pattern used by all other components.

---

### Requirement: Remove Dead Return Values

`useTableConfig` SHALL NOT return `loading: false` and `error: null`.

- These hardcoded values SHALL be removed from the return object.
- Consumers needing loading/error state SHALL use `useDatasetQuery` directly.

---

### Requirement: Shared Constants for Case Operations

The `CASE_OPERATIONS` list (`["upper", "lower", "title", "snake", "kebab"]`) SHALL be defined once and shared between `executeToolCall.ts` and `prompts.ts`.

---

### Requirement: Typed Session API

The `ChatTurnPayload` and `ChatTurn` interfaces in `sessions.ts` SHALL use proper types instead of `object` and `object[]`.

- `tool_definitions` SHALL use a `ToolDefinition` interface.
- `tool_calls` SHALL use the existing `ToolCall` type or a compatible interface.
- `table_schema` SHALL use a `TableSchema` type.
