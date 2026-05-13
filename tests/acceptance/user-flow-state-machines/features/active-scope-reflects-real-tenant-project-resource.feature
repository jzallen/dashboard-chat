# Slice 1 — Scope resolver invariants (ADR-029 I1-I5).
#
# These scenarios verify the ActiveScope contract that every flow other
# than login itself depends on. Tagged @us-002 because US-002 carries
# the scope-chain ACs in the user-stories doc.

@slice-1 @us-002 @scope-resolver @driving_port
Feature: Maya's active scope reflects her real tenant, project, and resource on every page

  As Maya navigating Dashboard Chat,
  I want the organization, project, and resource I see in the shell to match what the app actually uses
  So that I never act on a stale link or cross into another tenant's data.

  @us-002 @happy-path @real-io @clean
  Scenario: Maya's app shell shows organization, name, and project on first paint after deep-linking to a project
    Given Maya has organization "Acme Data" with project "Q4 Analytics" already set up
    When Maya opens the deep link to project "Q4 Analytics" cold
    Then Maya sees "Acme Data" as the active organization on first paint
    And Maya sees "Q4 Analytics" as the active project on first paint
    And Maya sees the project's dashboard content on the same first paint
    And no placeholder text ("Loading...", "Default Project", or empty) appears anywhere on first paint

  @skip @us-002 @error-path @cross_tenant
  Scenario: Maya cannot view a project that belongs to a different tenant
    Given Maya belongs to organization "Acme Data"
    And another tenant owns a project with id "proj-foreign-xyz999"
    When Maya opens a deep link to the foreign project
    Then Maya sees an access-denied page
    And Maya's app shell continues to show "Acme Data" as the active organization
    And the access-denied page names "cross-tenant access" as the reason

  @skip @us-002 @edge-case @stale_link
  Scenario: Maya's stale bookmark to a renamed project reconciles to the project's current name
    Given Maya bookmarked project "Q4 Analytics" when its name was "Q4 Data"
    And the project's name was later changed to "Q4 Analytics"
    When Maya opens the stale bookmark
    Then Maya sees "Q4 Analytics" as the active project on first paint
    And a scope-reconciled signal is observable by an accompanying test agent
    And Maya is not asked to pick the project again

  @skip @us-002 @boundary @resource_pair_atomicity
  Scenario: Maya's deep link with a resource type but no resource id is treated as a project-only link
    Given Maya has project "Q4 Analytics"
    When Maya opens a deep link that names "dataset" as the resource type with no resource id
    Then Maya sees "Q4 Analytics" as the active project on first paint
    And no resource is shown as active in the chips
    And Maya is not shown an error about a malformed link
