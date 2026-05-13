# <!-- DES-ENFORCEMENT : exempt -->
# Loader auth forwarding — frontend-coexistence (Slice 2 / MR-1).
#
# These scenarios assert DWD-1: `AuthProvider` is client-only; loaders
# read the Bearer token from `request.headers.get('Authorization')`
# and forward it to `auth-proxy` via `uiStateClient(request)`. No
# server-side `AuthProvider` is constructed; no React context is read
# inside any loader.
#
# Strategy: C (real local) per DI-1.
#
# Driving port: `reverse-proxy` HTTP ingress (a request with a
# distinctive Bearer token is sent, then the test asserts that the
# `auth-proxy` upstream received that exact bearer token).

@slice-2 @adr-034 @dwd-1 @adr-031-§7 @real-io
Feature: Loaders forward the browser-supplied Bearer token to auth-proxy without reconstructing AuthProvider server-side
  As the engineering team designing the SSR auth boundary,
  We want loaders to inherit the user's identity from the request headers and forward it verbatim,
  So that the browser remains the single source of truth for auth state and the server has no parallel
  identity surface to drift from.

  Background:
    Given the post-MR-1 compose topology is up
    And a Slice-2 migrated route module exports a server `loader` that calls `uiStateClient(request).getProjection(...)`

  @bearer-forward
  Scenario: A loader-driven request preserves the browser's Authorization header end-to-end
    Given a probe Bearer token is generated for this test (a distinctive value the test can recognize)
    When a browser requests the migrated route's path with `Authorization: Bearer <probe-token>`
    Then the loader inside `web-ssr` reads `request.headers.get('Authorization')` and forwards `Bearer <probe-token>` to `auth-proxy`
    And `auth-proxy` receives the request with the same `Authorization: Bearer <probe-token>` header (verified by an auth-proxy-level audit log or test-only mirror endpoint)

  @no-auth-provider-on-server
  Scenario: No loader function references AuthProvider as a value used inside the loader body
    When every `loader` export in `frontend/app/routes/*.tsx` is inspected
    Then no loader function calls `new AuthProvider(...)`, `useAuth()`, or imports `AuthProvider` as a value used inside the loader body
    And no loader function reads identity state from any React context

  @authprovider-ssr-safe
  Scenario: AuthProvider's render path produces no error during SSR
    Given the SSR pass for any route renders the route tree (including `root.tsx → AuthProvider`)
    When `@react-router/node` renders the route tree on the server
    Then `AuthProvider`'s render output does NOT call `window`, `document`, `sessionStorage`, or `localStorage` at render time
    And the SSR pass completes without throwing

  @client-hydration
  Scenario: After hydration the client's AuthProvider reads sessionStorage and exposes the user identity
    Given an SSR'd response from a Slice-2 migrated route
    When the browser parses the HTML and hydrates
    Then `AuthProvider`'s `useEffect` fires and reads the auth token from `sessionStorage`
    And the application's React tree exposes `useAuth().user` with the expected identity (matching pre-MR-0 behavior)

  @no-token-leak-across-requests
  Scenario: Two concurrent SSR requests with different Bearer tokens do not leak each other's identity
    Given a probe Bearer token A and a probe Bearer token B (distinctive, non-overlapping values)
    When request A is sent to the migrated route's path with `Authorization: Bearer <A>`
    And request B is sent to the migrated route's path with `Authorization: Bearer <B>`
    Then the SSR response for request A carries data resolved under bearer A's identity
    And the SSR response for request B carries data resolved under bearer B's identity
    And neither response's HTML body contains the other request's bearer token or its derived identity
    # Validates the request-scoped QueryClient invariant (DWD-2) and the no-shared-state property of web-ssr.
