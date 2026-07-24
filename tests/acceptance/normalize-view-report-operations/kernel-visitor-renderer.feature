# <!-- DES-ENFORCEMENT : exempt -->
# Story 02 (DC-82) — Kernel visitor + report extension.
#
# The View/Report compilers' shared steps collapse into one kernel visitor the
# report extension composes; a render dispatch catalog enforces build-time
# completeness. The consolidated renderer must produce the same SQL as the
# separate compilers for the same in-test relation. All scenarios @pending until
# this story lands.

@renderer_consolidation @driving_port @pending
Feature: Every relation renders through one kernel visitor with a completeness check
  As an engineer maintaining the renderer,
  I want the View and Report compilers' shared steps collapsed into one kernel
  visitor that the report extension composes
  So that a kernel change is one edit and an unhandled component fails the build.

  Scenario: The consolidated renderer produces the same SQL as the pre-consolidation compilers
    Given the renderer is consolidated behind the kernel visitor and report extension
    Then the consolidated renderer produces the same SQL as the separate View and Report compilers for the same in-test relation
    And no render path reads compiled SQL back as authority

  Scenario: An unhandled component discriminator fails the build instead of silently skipping
    Given a component discriminator with no entry in an active render visitor
    Then the build fails on the unhandled discriminator instead of silently skipping it

  Scenario: An entity-only report renders through the shared kernel path with no aggregation step
    Given an entity-only report with no aggregation
    Then it renders through the shared kernel path with no aggregation step
