# Milestone 1 — server-process identity (AC1.1, AC1.2, AC1.3, AC1.4).
#
# Covers the three bazel-built server processes that have native stdout:
# dashboard-api, dashboard-agent, dashboard-auth-proxy. The frontend
# (nginx-served SPA) has its own milestone because of its asymmetric
# surface (entrypoint shim + HTTP /_meta.json).
#
# Tagged @pending until DELIVER enables them one at a time. Walking
# skeleton already exercises one path through this set; these scenarios
# extend coverage to dirty markers, restart invariance, and stale-vs-fresh
# diagnosis.

@real-io @slow
Feature: Server-process containers log build identity on startup

  @pending
  Scenario Outline: Identity line is emitted on startup, end-to-end (AC1.1)
    Given the bazel image "<image>" has been freshly built
    When the "<service>" service is started via "docker compose up -d"
    Then within the first 50 lines of "docker compose logs <service>" there is exactly one line matching the canonical identity regex
    And the line begins with the service identifier "<service-name>"
    And the captured sha equals the STABLE_GIT_COMMIT recorded by the workspace-status command at build time

    Examples:
      | service    | service-name           | image                          |
      | api        | dashboard-api          | dashboard-chat/api:bazel       |
      | agent      | dashboard-agent        | dashboard-chat/agent:bazel     |
      | auth-proxy | dashboard-auth-proxy   | dashboard-chat/auth-proxy:bazel|

  @pending
  Scenario Outline: Identity is built-in, not start-in (AC1.2)
    Given the bazel image "<image>" has been freshly built at build commit <commit>
    When the "<service>" container is started, stopped, and restarted three times
    Then every startup logs sha=<commit> and built equals the original build timestamp

    Examples:
      | service    | image                          | commit |
      | api        | dashboard-chat/api:bazel       | HEAD   |
      | agent      | dashboard-chat/agent:bazel     | HEAD   |
      | auth-proxy | dashboard-chat/auth-proxy:bazel| HEAD   |

  @pending
  Scenario: Dirty working tree is flagged (AC1.3)
    Given there are uncommitted changes in the working tree
    When the bazel workspace-status command is invoked
    Then it emits "STABLE_GIT_DIRTY 1"
    And a freshly-built image started under those conditions logs an identity line containing "+dirty" immediately after the SHA

  @pending
  Scenario: Stale-vs-fresh diagnosis end-to-end (AC1.4)
    Given the bazel image "dashboard-chat/api:bazel" has been freshly built for the current HEAD
    When the developer runs "docker compose up -d api" and inspects "docker compose logs api"
    Then the captured sha equals "git rev-parse --short=7 HEAD"
    And if instead an out-of-date image is started without rebuilding, the captured sha differs from "git rev-parse --short=7 HEAD"
