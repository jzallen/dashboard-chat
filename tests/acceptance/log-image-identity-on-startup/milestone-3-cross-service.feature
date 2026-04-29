# Milestone 3 — cross-service consistency (AC3.1, AC3.2).
#
# A developer comparing services should be able to read all four
# identities at a glance with `docker compose logs | grep '^dashboard-'`,
# without translating formats. This milestone asserts the structural
# guarantee that all four images produced by the same bazel invocation
# emit identical sha and built tokens.

@real-io @slow
Feature: All four bazel-built services share one identity format

  @pending
  Scenario: Single shared format across services (AC3.1)
    Given all four services are started from images produced by the same "bazel run //...:image_load" invocation
    When the developer runs "docker compose logs --since 1m" and filters for identity lines
    Then exactly four lines match the canonical identity regex — one per service
    And the captured sha is identical across all four lines
    And the captured built timestamp is identical across all four lines

  @pending
  Scenario: Service name is unambiguous (AC3.2)
    Given the four bazel-built services are running
    When the developer pipes "docker compose logs" through "awk '{print $1}'"
    Then the unique service identifiers in the output include exactly:
      | dashboard-api          |
      | dashboard-frontend     |
      | dashboard-auth-proxy   |
      | dashboard-agent        |
