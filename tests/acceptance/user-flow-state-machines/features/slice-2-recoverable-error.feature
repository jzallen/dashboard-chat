# Slice 2 — US-003 recoverable error UX.
#
# Demonstrates the value of the pattern: failures are legible to users
# (reference code visible, jargon-free copy, retry CTA), and the retry
# threads the same reference code through every layer for support.

@slice-2 @us-003 @driving_port
Feature: A transient sign-in failure is honest, recoverable, and threadable

  As Maya hitting a transient failure during sign-in,
  I want to see what happened, what to do, and a reference I can share with support
  So that the app feels honest about hiccups and I have a path forward.

  Background:
    Given a clean environment with no organization yet owned by Maya

  @skip @us-003 @happy-path @real-io @clean
  Scenario: Maya sees a recoverable-error page with a shareable reference code on a transient failure
    Given the identity verification service is temporarily unavailable
    When Maya signs in through the production ingress
    Then Maya sees a recoverable-error page titled "We could not verify your identity right now"
    And the page reads "This is usually a brief network issue and resolves with a retry."
    And Maya sees a primary "Try again" action
    And Maya sees a reference code she can share with support
    And Maya does not see a raw error message or a status code at any point

  @skip @us-003 @happy-path @real-io @clean
  Scenario: Maya's retry threads the same reference code across the second attempt
    Given Maya is on a recoverable-error page with reference code "R-7a4f-901c"
    And the identity verification service is now available
    When Maya clicks "Try again"
    Then Maya reaches the welcome page addressed to "maya.chen@acme-data.example"
    And the second attempt is findable in the support trail by reference code "R-7a4f-901c"

  @skip @us-003 @error-path @cookie_blocked
  Scenario: Maya's blocked sign-in cookie shows a specific copy variant
    Given Maya's browser will block the sign-in cookie
    When Maya signs in through the production ingress
    Then Maya sees a recoverable-error page worded for the cookie-blocked case
    And the page suggests allowing cookies for the application or trying another browser
    And Maya sees a reference code she can share with support

  @skip @us-003 @boundary @retries_exhausted
  Scenario: Maya's third failed retry escalates to a contact-support page
    Given Maya has already retried twice from a recoverable-error page
    And the identity verification service will fail Maya's third attempt
    When Maya clicks "Try again" a third time
    Then Maya sees a contact-support page rather than another retry button
    And Maya's reference code remains visible on the contact-support page
    And Maya is not offered another retry from this page

  @skip @us-003 @kpi
  # K3: auth_recoverable_error_shown + auth_retry_clicked + ready_reached
  Scenario: Each recoverable-error event Maya sees is observable for the recovery-rate metric
    Given Maya has seen a recoverable-error page and successfully recovered via retry
    Then an accompanying test agent can observe a recoverable-error-shown signal carrying Maya's reference code
    And an accompanying test agent can observe a retry-clicked signal carrying Maya's reference code
    And an accompanying test agent can observe a ready-reached signal carrying the same reference code
