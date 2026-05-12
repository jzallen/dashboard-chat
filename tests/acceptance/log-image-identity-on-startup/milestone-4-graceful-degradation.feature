# Milestone 4 — graceful degradation when version.json is absent (AC1.5).
#
# Per DESIGN §8 and upstream-changes.md, the canonical regex was loosened
# to admit literal "unknown" tokens so that a service whose version.json
# is missing or unparseable still emits a single conforming identity line
# rather than crashing. This milestone exercises both the missing-file
# and corrupt-file branches without requiring a rebuilt-without-stamping
# image — instead the test bind-mounts /dev/null or a corrupt blob over
# the file in an otherwise-instrumented image.

@real-io @slow
Feature: Uninstrumented or corrupt version.json degrades gracefully

  Scenario Outline: Missing version.json yields "unknown" tokens, no crash
    Given the bazel image "<image>" has been freshly built
    When the "<service>" container is started with "/etc/dashboard-chat/version.json" overridden by "/dev/null"
    Then the service starts successfully and remains in state "running"
    And within the first 50 lines of "docker compose logs <service>" there is exactly one line matching the canonical identity regex
    And the captured sha equals "unknown"
    And the captured built equals "unknown"

    Examples:
      | service    | image                          |
      | api        | dashboard-chat/api:bazel       |
      | agent      | dashboard-chat/agent:bazel     |
      | auth-proxy | dashboard-chat/auth-proxy:bazel|
      | reverse-proxy   | dashboard-chat/reverse-proxy:bazel  |

  Scenario: Corrupt version.json yields "unknown" tokens, no crash
    Given the bazel image "dashboard-chat/api:bazel" has been freshly built
    When the "api" container is started with "/etc/dashboard-chat/version.json" overridden by a file containing "{not valid json"
    Then the service starts successfully and remains in state "running"
    And the identity line in "docker compose logs api" contains sha=unknown and built=unknown

  Scenario: Frontend "/_meta.json" still serves a fallback when version.json is absent
    Given the bazel image "dashboard-chat/reverse-proxy:bazel" has been freshly built
    When the "reverse-proxy" container is started with "/etc/dashboard-chat/version.json" overridden by "/dev/null"
    Then "GET /_meta.json" returns 200
    And the response body is JSON with sha="unknown" and built="unknown"
