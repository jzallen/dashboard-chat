# Milestone 2 — frontend container identity (AC2.1, AC2.2, AC2.3).
#
# The frontend is an nginx-served static SPA: no native application
# startup log. Its identity surface is the entrypoint-shim stdout line
# AND a machine-readable HTTP endpoint at /_meta.json (DESIGN §6:
# `frontend/docker-entrypoint.sh` writes both surfaces).

@real-io @slow
Feature: Frontend container exposes build identity via stdout and HTTP

  Scenario: Identity line on container stdout (AC2.1)
    Given the bazel image "dashboard-chat/frontend:bazel" has been freshly built
    When the "frontend" service is started via "docker compose up -d"
    Then within the first 50 lines of "docker compose logs frontend" there is exactly one line matching the canonical identity regex
    And the line begins with the service identifier "dashboard-frontend"

  Scenario: Identity available over HTTP at /_meta.json (AC2.2)
    Given "dashboard-frontend" is running and serving the SPA
    When the developer issues "GET /_meta.json"
    Then the response status is 200
    And the response body is JSON of shape {image, sha, dirty, built}
    And the response sha equals the sha emitted in the stdout identity line from AC2.1

  Scenario: Frontend honours the same build-invariants as server services (AC2.3)
    # AC1.2 (built-in not start-in), AC1.3 (+dirty marker), AC1.5
    # (graceful degradation) apply identically to the frontend container.
    # Concrete sub-scenarios live under milestones 1 and 4; this scenario
    # is a structural cross-reference that fails if frontend uses a
    # divergent format.
    Given the frontend identity line and "/_meta.json" body have been captured
    Then the frontend identity line conforms to the canonical regex used by milestones 1 and 4
    And the "/_meta.json" body schema matches the canonical JSON shape
