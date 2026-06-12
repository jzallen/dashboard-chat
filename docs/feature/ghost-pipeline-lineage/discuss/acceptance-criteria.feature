# Acceptance Criteria — Ghost Pipeline Lineage
#
# DISCUSS-wave capture. Given-When-Then for the behaviors the brainstorm describes,
# written at the BEHAVIORAL level (what the user observes), not the implementation
# level (no schema/API/state-machine decisions — those are DESIGN wave).
# Source of truth for the behaviors: idea-capture.md and journey-ghost-pipeline-visual.md.
# Some criteria are CONDITIONAL on open questions (see open-questions.md) and are
# tagged @open-question where the brainstorm did not settle the detail.

Feature: Ghost Pipeline Lineage
  As a user with several related source files
  I want the assistant to project, preview, and let me commit a downstream pipeline
  So that I get a working, replayable catalog without hand-building every layer

  # --- J1: build a working catalog from related files (AC-1, AC-2) ---

  Scenario: Sources and Datasets are built solid on upload
    Given I have uploaded several related source files
    When the catalog is constructed
    Then a Source node exists for each raw file rendered as SOLID (committed)
    And a Dataset (staging) node exists 1:1 with each Source rendered as SOLID
    And no Dataset node introduces a join

  Scenario: The assistant projects the downstream pipeline as ghost nodes
    Given my Sources and Datasets are built and solid
    When I ask the assistant to build out the pipeline
    Then proposed View and Report nodes and their edges appear as GLASS (proposed)
    And each proposed node carries a payload of transform spec, declared grain, and invariant tests
    And no proposed node is committed automatically

  Scenario: A ghost node is more than a label and a position
    Given the assistant has projected a ghost node
    When I inspect that node's payload
    Then it contains a transform (SQL or spec), a declared grain, and at least the invariant tests the assistant deemed relevant
    # Rationale: a label+position-only node has nothing to commit/execute (idea-capture: "the non-negotiable")

  # --- J2: preview before trusting (AC-3, AC-4) ---

  Scenario: Glass vs solid communicates proposed vs committed on one graph
    Given a lineage graph containing both committed and proposed nodes
    When I view the graph
    Then committed nodes render SOLID and proposed nodes render GLASS
    And proposed-vs-committed is a rendering state of the single graph, not two separate views

  Scenario: Confidence decays with distance from solid ground
    Given a chain of proposed nodes downstream of an unconfirmed join
    When I view that chain
    Then nodes further from solid ground render with lower visual confidence
    And the node immediately downstream of an unconfirmed join carries a distinct marker

  Scenario: Opening a ghost node shows its SQL in a modal
    Given a proposed (glass) node
    When I click it
    Then a modal opens showing the node's SQL
    And the modal is a focused editor, not a full model view

  Scenario: Preview loads real sample rows on demand and advances materialization state
    Given a ghost node's modal is open
    When I request a preview
    Then real sample rows (or a real chart) load for that node
    And the node moves from "proposed" to "previewed" (glass-but-populated)
    # @open-question: sample size, and whether preview requires backend compute in release 1

  # --- J3: edit and understand the blast radius (AC-5, AC-6) ---

  Scenario: A contract-preserving edit marks downstream stale, not broken
    Given a committed downstream node depends on a node I am editing
    When my edit changes data but preserves the output contract (same columns and grain)
    Then the downstream node is marked STALE
    And the downstream node is NOT recomputed eagerly
    And it is refreshed lazily only when I navigate to or preview it

  Scenario: A contract-breaking edit previews the blast radius before commit
    Given downstream nodes depend on a column or grain I am about to change
    When my edit would drop or rename that column or change the join grain
    Then I am shown, before committing, exactly which downstream nodes are affected and why
    And those nodes are flagged as would-break rather than merely stale

  # --- J5: steer the assistant without losing my edits (AC-6 cont.) ---

  Scenario: The assistant proposes diffs, never silent overwrites
    Given I have hand-edited a node's SQL
    And the node-preview modal is open
    When I ask the assistant to suggest a change
    Then the assistant presents its change as a diff against the node spec
    And I can accept or reject the diff
    And my hand-edited SQL is never overwritten without my acceptance

  # --- J4: commit cascade and replay (AC-7, AC-8) ---

  Scenario: Committing a Report cascades down its lineage path
    Given a proposed Report whose upstream View and Datasets are not all committed
    When I select the Report and choose Commit
    Then the entire path behind it (Datasets, View, Report) is materialized in one action
    And it is not possible to commit a node while leaving its required upstream uncommitted

  Scenario: Committing fires invariants and re-grounds the ghosts
    Given a proposed join with a declared grain and a row-count invariant
    When I commit the path and the real join fans out, violating the invariant
    Then the affected downstream ghost visibly cracks
    And the reason (e.g. grain assumption invalidated by fan-out) is shown at the node

  Scenario: A committed pipeline replays on next period's files
    Given a pipeline I previously committed
    When a new batch of the same source files is provided
    And I replay the pipeline
    Then the committed node specs re-execute on the fresh files
    And the catalog regenerates without rebuilding the layers by hand

  # --- View->Report intent gap (realism) ---

  @open-question
  Scenario: An underdetermined Report is offered as several proposals, not one guess
    Given the source files do not determine the intended report grain or aggregation
    When the assistant proposes Reports
    Then it offers several candidate Reports for me to choose from
    And it does not silently commit a single guessed Report
    # @open-question: how many candidates, and how they are presented
