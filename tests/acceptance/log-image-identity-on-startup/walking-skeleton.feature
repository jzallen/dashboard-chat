# Walking-skeleton acceptance for dc-1k8 (log image identity on startup).
#
# Strategy C (real local I/O): builds a real bazel image and starts a real
# container via docker compose, then asserts on real docker compose logs.
# This scenario is the e2e proof that the build->image->startup->stdout pipe
# works end-to-end through the developer's actual invocation path
# (bazel + docker compose). Per the DISTILL skill's Driving Adapter mandate
# (RCA P1, 2026-04-10), at least one walking-skeleton scenario MUST exercise
# the user's real invocation; this is that scenario.

@walking_skeleton @real-io @driving_adapter @slow
Feature: Image identity is announced on container startup
  As a developer iterating locally with bazel + docker compose,
  I want each freshly-built bazel image to log its identity on startup
  So I can confirm at a glance whether the running container matches the
  build I just produced — without docker inspect / digest reasoning.

  Background:
    Given the bazel image "dashboard-chat/api:bazel" has been freshly built

  Scenario: dashboard-api logs its identity within the first lines of stdout
    When the "api" service is started via "docker compose up -d"
    Then within the first 50 lines of "docker compose logs api" there is exactly one line matching the canonical identity regex
    And the captured sha equals the STABLE_GIT_COMMIT recorded by the workspace-status command at build time
