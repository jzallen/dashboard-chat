# Retire backendClient and assert the single boundary (DC-15).
#
# The browser reaches the backend through exactly ONE seam: the same-origin
# `/ui-server/*` gateway (RRv7 resource routes forwarding server-side through
# auth-proxy). It never calls the backend `/api` data plane browser-direct. The
# retired seam is `catalog/dataSources/backendClient` (apiGet/apiPost/apiPatch/
# apiUpload — cookie `credentials:"include"` fetches straight to `/api`).
#
# Out of scope (own, separate cookie channels that legitimately stay direct):
# `auth/session.ts` (session refresh) and `lib/state-proxy.ts` (SSE state feed).
#
# Guard: ui/app/__tests__/boundary/no-direct-backend.test.ts

Feature: A single browser-to-backend boundary through the /ui-server gateway

  Scenario: The browser bundle carries no direct-backend transport (AC1)
    Given the ui/ browser module graph (excluding tests and server-only /ui-server routes)
    When the source graph is scanned for the backendClient transport
    Then no module imports from catalog/dataSources/backendClient
    And no module calls apiGet, apiPost, apiPatch, or apiUpload
    And the catalog data-source tree performs no credentials:"include" browser fetch

  Scenario: Every browser flow reaches only the /ui-server gateway at runtime (AC2)
    Given a fetch spy installed over the browser onboarding, catalog, mutation, and upload flows
    When the catalog reads projects
    And a model is renamed
    And a dataset is uploaded in one step
    And the onboarding Phase-B probe runs
    Then zero requested URLs target the backend /api
    And the only reached URLs are same-origin /ui-server/* routes and the storage presigned PUT
