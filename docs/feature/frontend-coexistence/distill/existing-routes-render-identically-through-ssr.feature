# <!-- DES-ENFORCEMENT : exempt -->
# Existing routes render identically through SSR — frontend-coexistence (Slice 1 / MR-0).
#
# After MR-0 lands, every pre-MR-0 route renders the same way it did before
# from the browser's perspective. The framework-mode plumbing is in place
# but no route has a `loader` yet; web-ssr's job at this slice is to be a
# transparent shell-renderer that bootstraps the SPA exactly as nginx's
# `try_files index.html` did. The structural facts that make this true
# (ui-presentation/ gone, App.tsx deleted, providers moved to root.tsx,
# main.tsx is the HydratedRouter entry) are the supporting invariants.
#
# Note: the +1 container-count delta (web-ssr alongside the six pre-MR-0
# services) is a separate observable invariant — see
# `compose-topology-gains-one-service.feature`. The five nginx-rule
# preservation scenarios remain here because they directly assert the
# "identical rendering" invariant: requests that bypassed the SPA before
# (API, worker, presentation-state, health, assets) still bypass it after.
#
# Strategy: C (real local) per DI-1. Most scenarios are file-system or
# HTTP probes; the DOM-fingerprint scenario is marked @needs-playwright
# and deferred per DI-2.
#
# Driving ports: filesystem (repo path) + `reverse-proxy` HTTP ingress
# (the user-facing entry point, host port 5173 in the local compose).

@slice-1 @adr-034 @real-io
Feature: Every pre-MR-0 route continues to render identically from the browser's perspective
  As Maya, opening Dashboard Chat after MR-0 ships,
  I want the page to look and behave exactly as it did before,
  So that the framework-mode plumbing lands without any user-visible regression.

  Background:
    Given the post-MR-0 compose topology is up — reverse-proxy + web-ssr + auth-proxy + agent + ui-state + api + redis are healthy

  # ===== Routing parity (§3.1 nginx-rule preservation) =====

  @dwd-6 @dwd-8 @visual-parity
  Scenario: The five existing nginx rules continue to route to their pre-MR-0 upstreams
    When a request is sent to "/api/v1/health"
    Then the response is produced by auth-proxy, not by web-ssr
    When a request is sent to "/worker/anything"
    Then the response is produced by agent, not by web-ssr
    When a request is sent to "/api/channels/test-channel-id/presentation-state"
    Then the response is produced by agent directly (bypassing auth-proxy and web-ssr), preserving ADR-015
    When a request is sent to "/health"
    Then the response is produced by auth-proxy, not by web-ssr
    When a request is sent to a static asset path under "/assets/"
    Then the response is served by nginx static (cached headers), not by web-ssr

  @dwd-8 @catch-all
  Scenario: The catch-all location proxies all non-static, non-API routes to web-ssr
    When a request is sent to "/login"
    Then the response is produced by web-ssr (a Hono process returning HTML)
    When a request is sent to "/projects/some-project-id"
    Then the response is produced by web-ssr
    When a request is sent to "/some-unmatched-path"
    Then the response is produced by web-ssr (RRv7 returns its 404 route render)

  @visual-parity @needs-playwright
  Scenario: The DOM after hydration is structurally equivalent pre/post MR-0 for the entry routes
    Given a recorded DOM fingerprint of the SPA at "/" after hydration in the pre-MR-0 topology
    When a browser opens "/" against the post-MR-0 topology and waits for hydration to complete
    Then the post-MR-0 DOM fingerprint matches the pre-MR-0 fingerprint within tolerance
    # Note: DELIVER chooses whether this scenario uses playwright-python, moves to e2e/, or
    # is reduced to an HTML-shape assertion. See `distill/wave-decisions.md` DI-2.

  # ===== ui-presentation/ dissolution (§3.5 — structural fact enabling identical rendering) =====

  @dwd-4 @ui-presentation-dissolved
  Scenario: The `ui-presentation/` directory no longer exists in the repo
    When the repo working tree is inspected
    Then the path `ui-presentation/` does not exist as a directory
    And no file in the repo (outside of `docs/`, `CLAUDE.md`, and `.git/`) imports anything from a `ui-presentation/` path

  @dwd-4 @workspace-cleanup
  Scenario: The root `package.json` "workspaces" array no longer contains `ui-presentation`
    When the root `package.json` is inspected
    Then its "workspaces" array does not contain the string "ui-presentation"

  @dwd-4 @scaffold-files-migrated
  Scenario: The five scaffold files from ui-presentation are addressable at their new location under frontend/app/routes/
    When the repo working tree is inspected
    Then the file `frontend/app/routes/copy-variants.ts` exists
    And the file `frontend/app/routes/expired-token-banner.tsx` exists
    And the file `frontend/app/routes/expired-token-banner.test.tsx` exists
    And the file `frontend/app/routes/recoverable-error.tsx` exists
    And the file `frontend/app/routes/recoverable-error.test.tsx` exists
    And the vitest suite that exercises those files passes when run from `frontend/`

  # ===== App.tsx deletion + composition-root migration (§3.7 — structural fact) =====

  @dwd-6 @app-tsx-deleted
  Scenario: `frontend/App.tsx` no longer exists in the repo
    When the repo working tree is inspected
    Then the file `frontend/App.tsx` does not exist

  @dwd-6 @browser-router-removed
  Scenario: No source file in `frontend/` imports `BrowserRouter`
    When the repo source files under `frontend/src/` and `frontend/app/` are inspected
    Then no source file imports the symbol `BrowserRouter` from any module
    # Test files (e.g., `*.test.tsx`, `*.spec.tsx`) MAY use `MemoryRouter` and are excluded.

  @dwd-6 @hydrated-router-entry
  Scenario: `frontend/main.tsx` is the RRv7 hydration entry mounting `<HydratedRouter>`
    When the file `frontend/main.tsx` is inspected
    Then it imports `HydratedRouter` from `react-router/dom`
    And it calls `hydrateRoot(document, ...)` with the `<HydratedRouter />` inside `<StrictMode>`
