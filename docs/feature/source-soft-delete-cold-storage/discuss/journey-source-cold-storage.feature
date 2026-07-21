Feature: Soft-delete a source into Cold Storage
  As a project curator
  I want to move a source into recoverable Cold Storage via the backend
  So that archived state survives reload, syncs across clients, and no longer 404s

  Background:
    Given an authenticated curator in org "org-A"
    And an ingested, active source "src-1" in a project owned by "org-A"

  Scenario: Archive an active source
    When I PATCH /api/sources/src-1 with {"archived": true}
    Then the response status is 200
    And the source body has "archived_at" set to the request time
    And "retention_until" equals archived_at plus 90 days
    And no child dataset of "src-1" is archived or deleted

  Scenario: Archiving is idempotent
    Given "src-1" was archived at time T
    When I PATCH /api/sources/src-1 with {"archived": true}
    Then the response status is 200
    And "archived_at" is still T

  Scenario: Archived source leaves the default list but is retrievable
    Given "src-1" is archived
    When I GET /api/sources?project_id=<project>
    Then "src-1" is not in the results
    When I GET /api/sources?project_id=<project>&archived=true
    Then "src-1" is in the results with its "archived_at"
    And GET /api/sources/src-1 returns "src-1" with 200

  Scenario: Restore a source from Cold Storage
    Given "src-1" is archived
    When I PATCH /api/sources/src-1 with {"archived": false}
    Then the response status is 200
    And "archived_at" is null
    And "retention_until" is null
    And GET /api/sources?project_id=<project> includes "src-1"

  Scenario: Cross-org isolation
    Given a source "src-2" owned by org "org-B"
    When I (org "org-A") PATCH /api/sources/src-2 with {"archived": true}
    Then the response status is 404

  Scenario: Unknown source
    When I PATCH /api/sources/does-not-exist with {"archived": true}
    Then the response status is 404
