# ADR-009: TanStack Query over Redux/Zustand for Server State

## Status

Accepted

## Context and Problem Statement

The frontend needs to manage server state (datasets, projects, views) with caching, invalidation, and optimistic updates. The solution must treat server data as a cache rather than local application state, and provide structured cache invalidation patterns.

## Decision Drivers

- Server state treated as a cache with stale-while-revalidate semantics
- Structured cache invalidation via key factories (e.g., `projectKeys.detail(id)`)
- Built-in features for background refetching, retry, and optimistic updates
- Minimal boilerplate compared to manual cache management

## Considered Options

1. **TanStack Query** (selected)
2. **Redux / Zustand**

### Option 1: TanStack Query

- Good, because it treats server state as a cache rather than application state
- Good, because key factories (`projectKeys.detail(id)`) provide structured cache invalidation
- Good, because built-in stale-while-revalidate, background refetching, and retry eliminate boilerplate
- Bad, because components using TanStack Query require a `QueryClientProvider` wrapper in tests

### Option 2: Redux / Zustand

- Good, because they provide a global state store accessible from anywhere
- Good, because Redux has a large ecosystem and middleware support
- Bad, because server state management requires manual cache invalidation logic
- Bad, because it introduces boilerplate for actions, reducers, and cache synchronization
- Bad, because it conflates server state with client-only UI state

## Decision Outcome

Chosen option: **TanStack Query**, because it treats server state as a cache with built-in stale-while-revalidate semantics and structured key-based invalidation, eliminating the boilerplate of manual cache management.

### Consequences

- **Good:** No global state store needed. Components declare their data dependencies via hooks. Key factories provide structured invalidation. Client-only state (UI toggles, form state) uses React's built-in state primitives
- **Bad:** Tests require a `QueryClientProvider` wrapper for components using TanStack Query hooks

## Confirmation

Verify that cache invalidation via key factories correctly refreshes stale data after mutations. Confirm that components render with cached data while background refetching occurs.

## Related

- [NFR: Non-Functional Requirements](../requirements/nfr.md) -- TanStack Query's caching behavior supports responsiveness requirements
