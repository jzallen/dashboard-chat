# <!-- DES-ENFORCEMENT : exempt -->
# Compose topology gains one service — frontend-coexistence (Slice 1 / MR-0).
#
# After MR-0 lands, the compose topology has exactly one new application
# service: `web-ssr`. No pre-MR-0 service is removed, renamed, or has its
# role changed. `web-ssr` exposes its port internally only (no host
# binding) — like `ui-state`, it is reachable only over the compose
# network from `reverse-proxy`.
#
# This invariant is the topology-shape contract DESIGN ratified in
# ADR-034 §"Topology" and DWD-5/DWD-8 codified. It is separable from
# the "routes render identically" invariant (which is about HTML
# response shape) — hence its own behavior-first feature file.
#
# Strategy: C (real local) per DI-1. Scenarios use `docker compose
# config --services` and `docker compose config` YAML inspection;
# skip cleanly when the docker CLI is not available.
#
# Driving port: `docker compose` CLI against the repo's
# `docker-compose.yml`.

@slice-1 @adr-034 @dwd-5 @real-io
Feature: The compose topology gains exactly one new service (web-ssr) and no pre-MR-0 service is removed
  As the engineering team validating MR-0's topology delta,
  We want the compose stack to have one additional container after MR-0,
  So that the topology change is bounded, auditable, and reversible.

  Background:
    Given the repo working tree reflects post-MR-0 state

  @container-delta
  Scenario: The compose topology lists web-ssr as a new service alongside the existing six application services
    When the command `docker compose config --services` runs against the post-MR-0 `docker-compose.yml`
    Then the output lists `web-ssr`
    And the output lists `reverse-proxy`
    And the output lists `auth-proxy`
    And the output lists `agent`
    And the output lists `api`
    And the output lists `ui-state`
    And the output lists `redis`
    And no application service that existed pre-MR-0 has been removed

  @web-ssr-internal-only
  Scenario: The new web-ssr service does not expose a host port (only an internal port)
    When the post-MR-0 `docker-compose.yml` `web-ssr:` block is inspected
    Then it declares `expose: ["3001"]` (internal-only)
    And it does not declare any `ports:` mapping (no host-port binding)
