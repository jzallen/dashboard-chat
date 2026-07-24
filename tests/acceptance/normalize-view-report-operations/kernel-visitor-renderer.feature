# <!-- DES-ENFORCEMENT : exempt -->
# Phase 02 (slice 02, DC-82) — Kernel visitor + report extension.
#
# The View/Report compilers' shared steps collapse into one kernel visitor the
# report extension composes; a render dispatch catalog enforces build-time
# completeness. BLOCKED BY Phase 00 (the characterization gate must be green
# before this merge). The snapshot must stay byte-identical. All scenarios
# @pending until Phase 02 lands.

@renderer_consolidation @driving_port @pending
Feature: Every relation renders through one kernel visitor with a completeness check
  As an engineer maintaining the renderer,
  I want the View and Report compilers' shared steps collapsed into one kernel
  visitor that the report extension composes
  So that a kernel change is one edit and an unhandled component fails the build.

  Scenario: The consolidated renderer produces byte-identical SQL to the characterization snapshot
    Given the renderer is consolidated behind the kernel visitor and report extension
    Then the consolidated renderer reproduces the characterization snapshot byte-for-byte
    And no render path reads compiled SQL back as authority

  Scenario: An unhandled component discriminator fails the build instead of silently skipping
    Given a component discriminator with no entry in an active render visitor
    Then the build fails on the unhandled discriminator instead of silently skipping it

  Scenario: An entity-only report renders through the shared kernel path with no aggregation step
    Given an entity-only report with no aggregation
    Then it renders through the shared kernel path with no aggregation step
