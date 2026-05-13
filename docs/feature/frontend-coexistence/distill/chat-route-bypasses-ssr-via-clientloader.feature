# <!-- DES-ENFORCEMENT : exempt -->
# Chat / SSE clientLoader-only opt-out — frontend-coexistence (Slice 3 / MR-2).
#
# These scenarios assert DWD-3: routes that include the agent chat
# surface (ChatView) or other SSE-bearing client-only resources DO NOT
# export a server `loader`. They MAY export a `clientLoader`. The
# ADR-015 nginx rule for `/api/channels/:id/presentation-state`
# remains byte-unchanged.
#
# Strategy: C (real local) per DI-1.
#
# Driving port: filesystem (route module inspection) + `reverse-proxy`
# HTTP ingress (nginx routing verification).

@slice-3 @adr-034 @dwd-3 @adr-015 @real-io
Feature: Chat-bearing routes opt out of SSR via clientLoader-only and the ADR-015 nginx rule is preserved
  As the engineering team migrating routes to framework mode,
  We want chat-bearing routes to skip server-side data prefetch entirely,
  So that the SSE stream lifecycle stays purely client-side and the existing direct-to-agent
  presentation-state nginx rule is not bypassed.

  Background:
    Given the post-MR-2 compose topology is up

  @no-server-loader-on-chat-route
  Scenario: A route module whose component tree imports `ChatView` does NOT export a server `loader`
    When the file `frontend/app/routes/chat.<channelId>.tsx` (or the route module that mounts ChatView) is inspected
    Then it does not export a function named `loader`
    And it MAY export a function named `clientLoader` (RRv7's browser-only escape hatch)

  @clientloader-runs-in-browser
  Scenario: A route's clientLoader runs only in the browser, never during SSR
    Given a chat-bearing route module declares `export async function clientLoader({ request, params }) { ... }`
    And the clientLoader, if invoked, would write a marker to a known browser-only sink (e.g., a probe header on a fetch the test can intercept)
    When a server-side request to the chat-bearing route's path arrives at web-ssr
    Then the SSR response body is an HTML shell — no clientLoader-produced output is in the response
    When a browser hydrates that shell
    Then the browser executes the clientLoader after hydration (the probe sink receives the marker)

  @adr-015-rule-preserved
  Scenario: The `/api/channels/:id/presentation-state` nginx rule continues to route directly to agent
    When a request is sent to "/api/channels/test-channel-id/presentation-state" with `Accept: text/event-stream`
    Then the request reaches `agent` directly (bypassing auth-proxy and web-ssr)
    And the response is an SSE stream produced by the agent (per ADR-015)

  @adr-031-§7 @no-direct-presentation-state-loader
  Scenario: No SSR'd route's server loader makes a direct fetch to `/api/channels/:id/presentation-state`
    When every `loader` export in `frontend/app/routes/*.tsx` is inspected
    Then no loader's body contains a fetch to a URL matching `/api/channels/.*/presentation-state`
    # Server-side presentation-state, if ever needed, routes through auth-proxy per ADR-031 §7 inheritance.
    # ADR-015's nginx rule is for client SSE consumers, not server-side prefetch.

  @lint-rule-optional
  Scenario: An optional ESLint rule may flag a `loader` export co-located with a `ChatView` import
    Given the optional ESLint rule "no-loader-with-chat-import" is enabled in `frontend/.eslintrc.*`
    When `eslint` runs on a test fixture that exports both a `loader` and imports `ChatView`
    Then the rule reports an error pointing at the `loader` export line
    # The rule itself is optional (DESIGN deferred its existence to DELIVER); when present, it MUST
    # behave as specified. When absent, this scenario is @skip.
