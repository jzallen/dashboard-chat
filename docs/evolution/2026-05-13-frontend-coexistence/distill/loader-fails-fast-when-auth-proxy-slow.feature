# <!-- DES-ENFORCEMENT : exempt -->
# Loader fails fast when auth-proxy is slow — frontend-coexistence (Slice 4 / MR-3).
#
# Encodes Praxis review-by-system-designer.md §5 "Loader timeout handling".
# Operational-readiness invariant: a slow downstream MUST surface as a
# bounded error response, never a hung request. Failure of this invariant
# manifests in production as browser tabs hung indefinitely while a
# misbehaving upstream eats web-ssr's request handler slots.
#
# Strategy: C (real local) per DI-1. The slow-upstream condition is
# induced via either:
#   (a) a compose-level network delay shim (e.g., tc qdisc), or
#   (b) an `auth-proxy` test-only "slow mode" toggle DELIVER provides.
# DISTILL fixes the contract (≤ 5s wall-clock budget); DELIVER picks the
# induction mechanism.
#
# Driving port: `reverse-proxy` HTTP ingress (the browser URL bar).
# The slow upstream is `auth-proxy`'s `/ui-state/...` endpoint, which a
# Slice-2 migrated loader calls.

@slice-4 @adr-034 @praxis-F-3 @loader-timeout @real-io
Feature: A migrated route's loader fails fast with a bounded error response when auth-proxy is slow
  As the on-call engineer who will respond to a slow-upstream incident,
  We want web-ssr to surface a 5xx within 5 seconds rather than hang for 10+ seconds,
  So that browser tabs do not stall indefinitely and the failure mode is bounded and observable.

  Background:
    Given the post-MR-3 compose topology is up
    And `auth-proxy` is configured to delay its response to `/ui-state/flow/.../projection` by 10 seconds

  @bounded-budget
  Scenario: A loader-backed route responds with 5xx within 5 seconds when its auth-proxy fetch is slow
    Given a Slice-2 migrated route's `loader` fetches from the slowed `auth-proxy` endpoint
    When a browser requests the migrated route's path
    Then the response status is 500 or 504 within 5 seconds wall-clock
    And the browser does NOT observe a request hanging open for 10+ seconds
    # The exact timeout budget (5s) is a Slice-4 contract. DELIVER may tune the upstream
    # timeout configuration (Hono fetch options, RRv7 handler defaults) to meet it.

  @error-boundary-render
  Scenario: The timeout-derived error response is rendered through the route's ErrorBoundary, not a stack trace
    Given the loader-timeout condition above is in effect
    When a browser receives the error response
    Then the response body is the route's `ErrorBoundary` render (or the root `ErrorBoundary`), not a Node stack trace
    And the response body is well-formed HTML5 (a `<html>` root with a user-facing error surface)
