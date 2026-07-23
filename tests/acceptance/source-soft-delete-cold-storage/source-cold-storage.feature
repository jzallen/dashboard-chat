Feature: Move a source to Cold Storage
  As a project curator
  I want to move a source I no longer need into recoverable Cold Storage
  So that my active catalog stays uncluttered while the source stays safe,
    and its archived state holds across reloads and every client — not just my tab

  # Scenario SSOT for the DISTILL wave (source-soft-delete-cold-storage).
  # Ratified by ADR-055 (PATCH = soft-delete, DELETE reserved for hard-delete).
  # Driving port: PATCH /api/sources/{source_id} {"archived": bool} and
  # GET /api/sources?project_id=..&archived=.. through the FastAPI sources router.
  # Cross-org returns 403 (not 404) per ADR-055 §amendment — the platform posture
  # (deps.py:88) supersedes the DISCUSS AC1.2 404 assumption.
  # Slice tags map scenarios to the carpaccio slices in story-map.md.
  # All three slices are delivered; every scenario is live (no @skip).

  Background:
    Given I am a curator working in my own organization
    And my project has an active source I ingested earlier

  # ── Slice 1 — Archive a source (PATCH → Cold Storage) ──────────────────────────

  @slice1 @real-io @adapter-integration
  Scenario: Archiving a source moves it to Cold Storage
    When I move that source to Cold Storage
    Then the source is marked as archived from that moment
    And it is scheduled to be retained for 90 days before it can be purged
    And the datasets built from that source are left untouched

  @slice1
  Scenario: Moving an already-archived source to Cold Storage changes nothing
    Given I already moved that source to Cold Storage earlier
    When I move it to Cold Storage again
    Then it stays archived with its original archive time unchanged

  @slice1
  Scenario: Moving a source that isn't there tells me it isn't there
    When I try to move a source that does not exist to Cold Storage
    Then I am told the source cannot be found

  @slice1
  Scenario: I cannot touch a source that belongs to another organization
    Given a source that belongs to a different organization
    When I try to move it to Cold Storage
    Then I am told I am not allowed to act on that source

  # ── Slice 2 — Cold-Storage listing (default-exclude + browse Cold Storage) ─────

  @slice2
  Scenario: Archived sources leave the active catalog but stay findable
    Given I moved that source to Cold Storage
    When I browse my project's active sources
    Then the archived source is not among them
    But when I browse Cold Storage
    Then I find the archived source there, showing when it was archived
    And I can still open the source directly to inspect it

  # ── Slice 3 — Restore (symmetric PATCH {"archived": false}) ────────────────────

  @slice3
  Scenario: Restoring a source brings it back into the active catalog
    Given I moved that source to Cold Storage
    When I restore it from Cold Storage
    Then it is no longer marked as archived
    And its retention schedule is cleared
    And it appears among my project's active sources again

  @slice3
  Scenario: Restoring an already-active source changes nothing
    When I restore a source that was never archived
    Then it stays active with no retention schedule
