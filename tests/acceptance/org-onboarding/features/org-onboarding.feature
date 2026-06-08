# Scenario SSOT (business language) for the org-onboarding feature.
#
# Driving port for every scenario: the user-facing ingress (reverse-proxy) —
# the authenticated principal drives the flow by sending events to their state
# surface and by creating an organisation. Technical detail (HTTP, /ui-state,
# /api) lives in the step/driver layer, not here.
#
# Scope: an organisation and a single default project ONLY — no invitations, no
# additional project naming.
#
# Traceability: each scenario maps to a DELIVER slice (S1–S4) and to a
# test_*.py implementation. See ../../../docs/feature/org-onboarding/distill/roadmap.json.

Feature: First-time organisation onboarding
  As an authenticated person whose organisation does not yet exist in the app,
  I am guided to create my organisation and a first project,
  so that I can enter the app with a workspace ready to use.

  Background:
    Given an authenticated person whose organisation is not yet in the app
    And the dev-reachability affordance is enabled

  @walking_skeleton @real_io @happy_path @s4_ui_default_project
  Scenario: A new person creates an organisation and a first project, then enters the app
    When they begin their session
    Then they are guided to onboarding to set up an organisation
    When they submit a valid organisation name
    Then the organisation is set up and recorded as owned by them
    And they are asked to create their first project
    When they submit a name for their first project
    Then the first project is created
    And onboarding is complete and they can enter the app

  @real_io @happy_path @s3_ui_onboarding
  Scenario: An organisation-less person is routed to onboarding with their identity shown
    When they begin their session
    Then they are guided to onboarding to set up an organisation
    And their identity is shown on the onboarding surface

  @real_io @happy_path @s1_backend
  Scenario: Creating an organisation records its owner
    Given they have begun their session and reached organisation setup
    When they submit a valid organisation name
    Then the organisation is set up
    And the organisation record names them as its owner

  @real_io @happy_path @s4_ui_default_project
  Scenario: After the organisation, the person creates the default project
    Given they have set up their organisation
    Then they are asked to create their first project
    When they submit a name for their first project
    Then the first project is created
    And onboarding is complete and they can enter the app

  @real_io @error_path @s3_ui_onboarding
  Scenario: An invalid organisation name keeps the person on organisation setup
    Given they have begun their session and reached organisation setup
    When they submit an organisation name that is not allowed
    Then they are shown an inline problem with the name
    And they remain on organisation setup

  @real_io @regression @s1_backend
  Scenario: Setting up an organisation no longer auto-creates a project
    When they submit a valid organisation name
    Then the organisation is set up
    And no project has been created automatically

  @real_io @error_path @s1_backend
  Scenario: A person whose organisation is absent from the app is routed to onboarding
    Given the app has no organisation owned by them
    When they begin their session
    Then they are guided to onboarding to set up an organisation
