# <!-- DES-ENFORCEMENT : exempt -->
# SSR'd route migration — frontend-coexistence (Slice 2 / MR-1).
#
# These scenarios assert the post-Slice-2 invariants: a route module
# that exports a server `loader` is SSR'd end-to-end. The loader's
# response hydrates the browser's TanStack Query cache via dehydrate
# + <HydrationBoundary> (DWD-2).
#
# Strategy: C (real local) per DI-1.
#
# Driving port: `reverse-proxy` HTTP ingress. The migrated route's
# loader runs inside `web-ssr`'s Hono process and reaches `auth-proxy`
# via the request-scoped fetch helper `uiStateClient(request)`.

@slice-2 @adr-034 @dwd-2 @real-io
Feature: A route with a server loader is SSR'd end-to-end and its data hydrates the browser cache
  As Maya, opening a route that needs server-prefetched data,
  I want the first paint to already include the data my view depends on,
  So that I don't see a blank flash while the browser fetches the same data the server already had.

  Background:
    Given the post-MR-1 compose topology is up
    And a route module in `frontend/app/routes/` exports a server `loader`
    And the loader uses `uiStateClient(request).getProjection(...)` to prefetch projection data
    And the loader returns `{ dehydratedState: dehydrate(client) }` where `client` is a request-scoped `QueryClient`

  @ssr-data
  Scenario: The route's HTML response contains the server-rendered component output
    Given a valid Authorization Bearer token is presented
    When a browser requests the migrated route's path
    Then the response status is 200
    And the response Content-Type is text/html
    And the response body contains the server-rendered DOM of the route component (not just an empty `<div id="root">`)
    And the response body contains a serialized form of the loader's `dehydratedState` (consumed by `<HydrationBoundary>` on the client)

  @cache-hydration
  Scenario: The browser hydrates the loader's prefetched data into its singleton QueryClient without re-fetching
    Given a valid Authorization Bearer token is presented
    When a browser receives the SSR'd response and runs the hydration entry
    Then the singleton `QueryClient` mounted by `root.tsx` merges `dehydratedState` into its cache
    And the route component renders WITHOUT issuing a duplicate fetch to `ui-state` for the same query key

  @loader-error
  Scenario: A loader that throws a Response surfaces as that response's status to the browser
    Given the route's loader is configured to throw `new Response("upstream failure", { status: 502 })`
    When a browser requests the migrated route's path
    Then the response status is 502
    And the response body is the route's `ErrorBoundary` render, not a stack trace

  @adr-029 @active-scope
  Scenario: A loader that fetches active_scope from ui-state produces an SSR'd payload usable by `useScope()`
    Given the route's loader calls `uiStateClient(request).getProjection("login-and-org-setup")`
    And the projection includes an `active_scope` field
    When a browser requests the migrated route's path
    Then the response body's dehydrated state includes the projection under the expected query key
    And after hydration, calling `useScope()` from a component inside the route returns the server-resolved `active_scope` without issuing a new fetch

  @dwd-7 @inner-provider-removed
  Scenario: After Slice-2 lands, the AppShell's inner `<QueryProvider>` wrap is removed
    When the file `frontend/src/ui/components/AppShell/index.tsx` is inspected
    Then it does not wrap its children in `<QueryProvider>` anymore
    And the module-scoped `queryClient` export at `frontend/src/ui/providers/QueryProvider.tsx` is removed (or the module itself is deleted)
