# Scenario SSOT (business language) for first-time organisation onboarding.
#
# REWORKED for client-driven-onboarding (ADR-048/049/050, ratified 2026-06-11).
# The write model moved: the *person's client* now drives every write and reports
# the outcome it observed; the presentation-state coordinator transitions only on
# those reports and never reaches out to anything itself. The business journey is
# unchanged — only the choreography behind each step moved — so the original
# scenarios survive at this language level; new scenarios cover the failure,
# convergence, mode-discovery and session-continuity guarantees the new model adds.
#
# Driving port for every scenario: the user-facing ingress (reverse-proxy). The
# authenticated principal drives the flow — probing existence, creating the
# organisation and the first project, and reporting each outcome to their state
# surface. Technical detail (HTTP, /ui-state, /api, event names) lives in the
# step/driver layer, not here.
#
# Scope: an organisation and a single default project ONLY — no invitations, no
# additional project naming (the first project is created automatically with a
# default name).
#
# Naming rule encoded by these scenarios (ratification amendment 2): a failure is
# NEVER surfaced as a raw machine tag — re-edit failures show friendly inline help
# on the form; everything else shows a generic "something went wrong on our end"
# surface with a way to try again. No failure is a dead end.
#
# Traceability: each scenario maps to a client-driven-onboarding DELIVER slice
# (CDO-S1..S5) and to a test_*.py implementation. See
# ../../../docs/feature/client-driven-onboarding/distill/roadmap.json.

Feature: First-time organisation onboarding
  As an authenticated person whose organisation does not yet exist in the app,
  I am guided to create my organisation and a first project,
  so that I can enter the app with a workspace ready to use.

  Background:
    Given an authenticated person whose organisation is not yet in the app

  # ─────────────────────────── happy path ───────────────────────────

  @walking_skeleton @real_io @happy_path @cdo_s1
  Scenario: A new person creates an organisation and a first project, then enters the app
    When they begin their session
    Then they are waiting to learn whether they have an organisation
    When they find they have no organisation and report it
    Then they are guided to onboarding to set up an organisation
    When they create a valid organisation and report it
    Then the organisation is set up and recorded as owned by them
    And their first project is created automatically and reported
    Then onboarding is complete and they enter the app on a selected project

  @real_io @happy_path @cdo_s1
  Scenario: An organisation-less person is routed to onboarding with their identity shown
    When they begin their session
    Then they are waiting to learn whether they have an organisation
    And their identity is shown on the onboarding surface
    When they find they have no organisation and report it
    Then they are guided to onboarding to set up an organisation

  @real_io @happy_path @cdo_s1
  Scenario: A person whose organisation is absent from the app is routed to onboarding
    Given the app has no organisation owned by them
    When they begin their session and report that they have no organisation
    Then they are guided to onboarding to set up an organisation

  @real_io @happy_path @cdo_s1
  Scenario: Creating an organisation records its owner
    Given they have begun their session and reached organisation setup
    When they create a valid organisation and report it
    Then the organisation is set up
    And the organisation record names them as its owner

  @real_io @happy_path @cdo_s1
  Scenario: After the organisation, the first project is created automatically
    Given they have set up their organisation
    Then they are waiting on their initial project scope
    When their first project is created automatically and reported
    Then onboarding is complete and they enter the app on a selected project

  @real_io @regression @cdo_s2
  Scenario: Setting up an organisation no longer auto-creates a project
    When they create a valid organisation
    Then the organisation is set up
    And no project has been created automatically

  # ─────────────────────────── failure & recovery (no dead ends) ───────────────────────────

  @real_io @error_path @cdo_s2
  Scenario: An invalid organisation name keeps the person on organisation setup
    Given they have begun their session and reached organisation setup
    When they attempt an organisation name that the app rejects as invalid
    Then they are shown a friendly inline problem with the name, not a raw tag
    And they remain on organisation setup
    And they can try a different name and succeed

  @real_io @error_path @cdo_s3
  Scenario: An organisation name already in use keeps the person on organisation setup
    Given they have begun their session and reached organisation setup
    When they attempt an organisation name that is already in use
    Then they are shown a friendly inline problem with the name, not a raw tag
    And they remain on organisation setup
    And they can try a different name and succeed

  @real_io @error_path @cdo_s3
  Scenario: An organisation creation that fails on our end is recoverable
    Given they have begun their session and reached organisation setup
    When their organisation creation fails on our end and is reported
    Then they are shown a generic "something went wrong" surface, not a raw tag
    And they are offered a way to try again
    When they try again and the organisation is created
    Then the organisation is set up and they are no longer in an error state

  @real_io @error_path @cdo_s3
  Scenario: A first-project creation that fails on our end is recoverable and converges
    Given they have set up their organisation
    When their first-project creation fails on our end and is reported
    Then they are offered a way to try again
    When they try again, the project is found to already exist, and they report the resolved scope
    Then onboarding is complete on exactly one project, with no duplicate created

  # ─────────────────────────── convergence & liveness (the crash class) ───────────────────────────

  @real_io @regression @cdo_s3
  Scenario: A late or duplicate report after entering the app changes nothing and never crashes
    Given they have completed onboarding and entered the app
    When a stale report from an earlier step arrives out of phase
    Then no change occurs and the current state is returned
    And the state service is still alive and serving requests

  @real_io @error_path @cdo_s3
  Scenario: An unrecognised report is rejected at the edge
    Given they have completed onboarding and entered the app
    When a report of an unrecognised kind arrives
    Then it is rejected as a bad request and changes nothing

  # ─────────────────────────── sign-in surface (mode discovery + session) ───────────────────────────

  @real_io @happy_path @cdo_s4
  Scenario: The sign-in surface learns the sign-in mode before showing any affordance
    When the sign-in surface asks which sign-in mode is in effect
    Then it learns the mode without any side effect
    And in development the development sign-in affordance is permitted

  @real_io @happy_path @cdo_s4
  Scenario: Creating an organisation refreshes the person's session
    Given they have begun their session and reached organisation setup
    When they create a valid organisation
    Then their session is refreshed so later steps carry the new organisation
