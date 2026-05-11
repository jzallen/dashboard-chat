# Slice 1 error paths — covers US-001 + US-002 negative branches.
#
# Failure modes from `docs/product/journeys/login-and-org-setup.yaml`:
#   workos_profile_corrupt, jwks_not_warm, cookie_blocked,
#   org_validation_failed, jwt_reissue_failed_after_org_create.
#
# All scenarios @skip until DELIVER enables them one at a time per
# `roadmap.json` (Mandate: one scenario enabled at a time).

@slice-1 @us-001 @us-002 @driving_port
Feature: Sign-in and org-setup error paths are honest and recoverable

  As Maya signing in for the first time,
  I want every failure during sign-in or org creation to leave me with a clear path forward
  So that I never see a blank screen or a raw error message.

  Background:
    Given a clean environment with no organization yet owned by Maya
    And the flow-state services are healthy and reachable through the production ingress

  @skip @us-001 @us-002 @real-io @clean
  Scenario: Maya sees the checking-identity panel while sign-in takes 1.8 seconds
    Given the fake identity provider will respond after 1.8 seconds
    When Maya begins signing in through the production ingress
    Then within 100 milliseconds Maya sees a "Checking your identity..." panel
    And the panel reassures her "This usually takes about two seconds."
    And Maya never sees a blank page or a raw error at any moment
    And eventually Maya reaches the welcome page addressed to "maya.chen@acme-data.example"

  @skip @us-001 @error-path @workos_profile_corrupt @real-io @clean
  Scenario: Maya is shown a recoverable-error page when her identity profile is missing required fields
    Given the fake identity provider will return a profile missing the email field
    When Maya signs in through the production ingress
    Then Maya sees a recoverable-error page rather than a welcome page
    And the recoverable-error page displays a reference code Maya can share with support
    And Maya is not silently routed to a welcome page with a blank greeting

  @skip @us-002 @error-path @org_validation_failed @real-io @clean
  Scenario: Maya's duplicate organization name is rejected inline without losing her place
    Given Maya has reached the welcome page addressed to "maya.chen@acme-data.example"
    And another member of Maya's tenant has already taken "Acme Data"
    When Maya submits the organization name "Acme Data"
    Then Maya stays on the welcome page
    And Maya sees "That name is already in use in your organization" beside the input
    And Maya's organization has not been created
    And Maya's access token has not been reissued

  @skip @us-002 @error-path @jwt_reissue_failed_after_org_create @real-io @clean
  Scenario: Maya's organization survives a transient failure during access reissue
    Given Maya has reached the welcome page addressed to "maya.chen@acme-data.example"
    And the access reissue service will fail twice and succeed on the third attempt
    When Maya submits the organization name "Acme Data"
    Then Maya sees a "Creating..." message for the duration of the retries
    And exactly one organization named "Acme Data" exists for Maya's tenant when she lands in the app shell
    And Maya's app shell displays "Acme Data" as the active organization on first paint

  @skip @us-002 @error-path @jwt_reissue_failed_after_org_create @real-io @clean
  Scenario: Maya sees a partial-setup recovery page when access reissue exhausts retries
    Given Maya has reached the welcome page addressed to "maya.chen@acme-data.example"
    And the access reissue service will fail every attempt
    When Maya submits the organization name "Acme Data"
    Then Maya sees a recoverable-error page worded for the partial-setup case
    And Maya sees a "Try again" action that retries only the access reissue, not the organization creation
    And exactly one organization named "Acme Data" exists for Maya's tenant

  @skip @us-001 @us-002 @degraded @with-stale-config
  Scenario: Maya can still reach the welcome page when one ingress route still points to the old frontend
    Given the production ingress has one route still wired to the legacy frontend
    And Maya's identity route has been migrated to the new frontend
    When Maya signs in through the production ingress
    Then Maya reaches the welcome page addressed to "maya.chen@acme-data.example"
    And the legacy frontend remains the responder for any unmigrated route Maya visits
