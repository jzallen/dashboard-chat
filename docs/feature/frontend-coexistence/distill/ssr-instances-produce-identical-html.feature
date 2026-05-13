# <!-- DES-ENFORCEMENT : exempt -->
# SSR instances produce identical HTML — frontend-coexistence (Slice 4 / MR-3).
#
# Encodes Praxis review-by-system-designer.md §5 "Horizontal scale
# assertion". Application-architecture.md §6.4 names web-ssr as
# horizontally scalable (no session affinity, stateless handlers,
# request-scoped QueryClient). This file verifies that property end-to-end:
# under `docker compose up -d --scale web-ssr=2`, every instance
# produces byte-equivalent SSR'd HTML for the same route + bearer.
#
# Strategy: C (real local) per DI-1.
#
# Driving port: `reverse-proxy` HTTP ingress. Nginx distributes requests
# across the two web-ssr instances; tests observe responses without
# direct knowledge of which instance answered.

@slice-4 @adr-034 @praxis-F-3 @horizontal-scale @real-io
Feature: Two web-ssr instances behind nginx produce byte-equivalent SSR'd HTML
  As the engineering team that needs web-ssr to scale out without quirks,
  We want every instance to be interchangeable for any given (route, bearer) pair,
  So that we can scale horizontally without introducing session-affinity bugs
  or cache-pollution between instances.

  Background:
    Given the compose stack is brought up with `docker compose up -d --scale web-ssr=2`

  @byte-equivalent
  Scenario: Two sequential requests to the same route + bearer produce byte-equivalent HTML across instances
    Given a Slice-2 migrated route exists at a known path
    When two sequential requests are issued for that path with the same Authorization Bearer token
    Then both responses are 200 text/html
    And the two response bodies are byte-equivalent (modulo headers like `Request-Id` if present)
    # Validates the scale-N property in `application-architecture.md` §6.4: no session affinity,
    # no fixed host port, stateless request handlers.

  @no-cross-bearer-leak
  Scenario: Distinct bearers' SSR responses do not contaminate each other across instances
    And probe Bearer tokens A and B are minted with distinct identities
    When request A is issued (potentially routed to one web-ssr instance) and request B is issued (potentially routed to the other)
    Then request A's SSR'd HTML does NOT contain Bearer B's identity or B's prefetched data
    And request B's SSR'd HTML does NOT contain Bearer A's identity or A's prefetched data
    # Validates the request-scoped QueryClient invariant (DWD-2): no module-level state
    # survives across requests, even when those requests hit different web-ssr instances.
