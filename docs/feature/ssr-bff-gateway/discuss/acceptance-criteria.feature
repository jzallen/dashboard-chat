# DISCUSS-wave capture. Given-When-Then acceptance criteria for the CAPTURABLE
# outcomes of the SSR-BFF-gateway idea (see idea-capture.md). These describe
# observable outcomes of the strangler-fig phases — they are NOT a test design,
# NOT an endpoint/API contract, and NOT binding on the architect. Concrete route
# names (e.g. /bff/orgs/me) are illustrative placeholders from the brainstorm.

Feature: SSR server as the single client integration point (BFF)
  As the ui/ engineer and the downstream-service owner
  I want the client to integrate against one SSR/BFF origin that brokers
  downstream with service identity
  So that the client has one surface and downstream trusts one caller

  # ── Phase 0: stand up the seam, move nothing ──────────────────────────────

  Scenario: The BFF seam authenticates a downstream read server-side
    Given web-ssr holds service credentials and can mint an M2M token
    And auth-proxy has validated the session and injected an on-behalf-of
      user identity at the edge
    When the client requests a single BFF resource route (e.g. /bff/orgs/me)
    Then web-ssr calls the downstream backend read server-side as the BFF
      acting for that user
    And the response returns the same org data the direct /api/orgs/me path
      returns
    And no browser-forwarded user JWT is required for that downstream call

  Scenario: The Phase-0 seam has zero blast radius on existing paths
    Given the BFF resource route for one endpoint exists
    When a client that still uses the direct /api/orgs/me path loads
    Then it continues to work unchanged
    And only the explicitly migrated endpoint flows through the BFF

  # ── Phase 1: cold reads via server loaders ────────────────────────────────

  Scenario: A migrated cold read is served via a server loader with real data on first paint
    Given a cold/initial read (e.g. the lineage bundle for project-layout) has
      been promoted from a clientLoader to a server loader fetching via the BFF
    When a user navigates to that route
    Then the first server-rendered paint contains the real data, not just a shell
    And the DataCatalog is hydrated from the loader data rather than
      client-fetching it after hydration

  Scenario: The lineage waterfall is aggregated into one client response
    Given the lineage bundle previously required four browser round-trips
      (/api/sources, /api/datasets, /api/projects/{pid}/views,
       /api/projects/{pid}/reports)
    When the migrated server loader serves the lineage bundle
    Then the four downstream calls are aggregated server-side
    And the client receives the bundle in a single response

  Scenario: Reactive reads are deliberately NOT moved to the server
    Given a read that changes reactively after the route loads (e.g. live
      assistant-transform preview reflection)
    When the migration is applied
    Then that read remains served by the client DataCatalog
    And it is not converted to a server loader

  # ── Phase 2: mutations via actions / resource routes ──────────────────────

  Scenario: A migrated mutation flows through a BFF action via M2M on-behalf-of
    Given an optimistic write-through (e.g. the audit toggle) has been moved
      behind an RRv7 action executed by the BFF
    When the user performs that mutation
    Then the optimistic UI update still happens in the catalog
    And the network target is the BFF action rather than client->auth-proxy->backend
    And the BFF executes the downstream write via M2M on-behalf-of the user

  # ── Phase 3: stream relay (captured intent; hardest, last) ────────────────

  Scenario: The agent SSE stream is relayed through the BFF without buffering
    Given a resource route proxies the agent SSE ReadableStream
    When the chat client is pointed at the BFF route instead of /worker/chat
    Then stream chunks arrive incrementally with no buffering introduced by the
      extra hop
    And long-lived connections do not accumulate unbounded memory on web-ssr

  # ── Phase 4: collapse origins + tighten downstream ────────────────────────

  Scenario: Once all paths route through the BFF, downstream trust narrows to the BFF
    Given reads, mutations, and streams all route through the BFF
    When downstream services are tightened
    Then the client no longer knows about /api, /worker, or /ui-state directly
    And downstream services accept only M2M from the BFF and drop
      browser-JWT trust

  # ── Cross-cutting: strangler-fig safety mechanic ──────────────────────────

  Scenario: Any single migration slice can be rolled back independently
    Given a read or mutation has been migrated to a BFF route behind a
      per-route / per-endpoint flip
    And the old direct path is still alive
    When that slice is rolled back
    Then the affected route reverts to the direct path
    And no other migrated or unmigrated slice is affected
