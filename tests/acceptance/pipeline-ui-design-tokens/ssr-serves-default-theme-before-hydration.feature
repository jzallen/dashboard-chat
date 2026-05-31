# MR-1 — design-token foundation + dark-mode plumbing.
#
# This is the TRUE port-to-port driving-adapter check for the no-flash
# guarantee: the user's browser fetches server-rendered HTML through the
# reverse-proxy ingress, and that HTML must already carry the theme class +
# the inline pre-hydration init script BEFORE any client JS runs.
#
# DEFERRED — blocked by the SSR asset-hash 404 issue (distill/upstream-issues.md
# UI-1). The walking skeleton is gated in vitest instead (frontend/app/theme/
# theme.test.tsx, AC1), which proves the same init mechanism without the
# container stack. Un-skip these once the SSR stack serves cleanly.

@real-io @adapter-integration @requires_external @skip
Feature: SSR ingress serves the default theme before hydration (no flash)

  Scenario: First-time visitor receives Neobrutalist-light markup before hydration
    Given the local compose stack is serving through the reverse-proxy ingress
    When a visitor with no stored theme preference requests the landing page
    Then the served HTML root carries the single Neobrutalist aesthetic class
    And the served HTML does not carry the dark class
    And the document head contains the inline pre-hydration theme init script

  Scenario: Returning dark-mode visitor receives dark markup before hydration
    Given the local compose stack is serving through the reverse-proxy ingress
    When the served HTML's inline init script runs against a stored "dark" preference
    Then the root resolves to the dark theme on first paint with no flash
