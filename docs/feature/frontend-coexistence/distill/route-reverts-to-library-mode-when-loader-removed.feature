# <!-- DES-ENFORCEMENT : exempt -->
# Reversibility — frontend-coexistence (Slice 3 / MR-2).
#
# These scenarios assert the symmetric escape hatch ADR-034
# §"Reversibility" promises: a migrated route reverts to library-mode
# by deleting its `loader` export, without touching the component file
# or any data on disk.
#
# Strategy: C (real local) per DI-1.
#
# Driving port: `reverse-proxy` HTTP ingress + file-system mutation
# (DELIVER's MR-2 mechanically reverts the Slice-2 migrated route by
# removing the `loader` export from the route module file).

@slice-3 @adr-034 @reversibility @real-io
Feature: A migrated route reverts to library-mode by removing its loader export
  As the engineering team that just shipped Slice-2's first SSR'd route,
  We want to be able to undo that migration with a one-line change to the route module,
  So that any per-route regression we discover post-migration is rollback-able without
  re-architecting the route's data flow.

  Background:
    Given the post-MR-2 compose topology is up — every Slice-1 invariant still holds
    And a previously-migrated route module has had its `loader` export removed by the MR-2 change

  @forward-then-reverse
  Scenario: A route reverted from framework-mode to library-mode no longer SSRs its data
    Given a valid Authorization Bearer token is presented
    When a browser requests the formerly-migrated route's path
    Then the response status is 200
    And the response Content-Type is text/html
    And the response body is an HTML shell (a `<div id="root">` mount point + the client `<Scripts>` reference)
    And the response body does NOT contain the route component's data-dependent text (no pre-rendered loader output)
    And after hydration, the route component fetches its data client-side via TanStack Query (matching pre-Slice-2 behavior)

  @component-untouched
  Scenario: The route component file's source is byte-unchanged across the migration+revert cycle
    Given the route component file as it existed before Slice-2 added the `loader` export
    When the MR-2 change removes the `loader` export and reverts the route module to its original component-only shape
    Then a `git diff` between the component file's pre-Slice-2 state and its post-MR-2 state shows zero net changes to the component's body (the only diff is the `loader` export being added then removed)

  @symmetry
  Scenario: The forward and reverse migration paths produce mirror-image diffs
    Given the diff of Slice-2's per-route migration MR (added a `loader` export to the route module)
    And the diff of MR-2's per-route revert (removed the `loader` export from the route module)
    Then the two diffs are mirror images: the lines MR-2 removes are exactly the lines Slice-2 added; the lines MR-2 adds (if any) are exactly the lines Slice-2 removed
