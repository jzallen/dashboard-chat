# Milestone 4 — protocol-level invariants preserved across the new layers.
#
# The new validation layers MUST NOT regress existing protocol guards.
# Two invariants in scope:
#
#   - AC1.4 raw-tool-call leak guard (ADR-014, OQ5 in ADR-019): no Groq
#     tool-call deltas with frame prefix '9:' may leak through the worker
#     SSE stream. The harness raises today; this scenario asserts the
#     guard is still raised after eject_and_test() and validate_after()
#     are wired up.
#
#   - ADR-016 5-service compose ingress: the eject orchestrator's HTTP
#     fetch of the project export MUST go through auth-proxy
#     (production-fidelity ingress at port 3000 in the local topology),
#     NOT directly to the backend. Asserted by inspecting the URL the
#     orchestrator uses.
#
# Phase 4 (DELIVER) unpended both scenarios: AC1.4 raw-tool-call leak guard
# and ADR-016 ingress URL invariant. Both are pure assertions on existing
# behavior — no new mechanism. The orchestrator already builds export URLs
# from its configured base_url (the auth-proxy ingress); chat_turn already
# raises on AC1.4 leaks unconditionally, before any post-turn check (so the
# Phase-3 validate_after wiring cannot bypass it).

@real-io
Feature: Existing protocol invariants survive the new validation layers

  Background:
    Given the dataset-layer harness is ready against the running compose stack
    And the eject orchestrator has passed its earned-trust probes

  Scenario: After a chat workflow completes, no raw tool-call delta leaks through
    Given a fresh project with a small orders dataset uploaded
    When the customer runs a complete chat workflow
    Then the chat trace contains no raw tool-call frames

  Scenario: The eject orchestrator reaches the system through the production-ingress URL
    Given a fresh project with a small orders dataset uploaded
    When the customer ejects the project and re-runs the validations
    Then the project export was fetched through the production-ingress URL
    And the project export was not fetched directly from a backend internal port
