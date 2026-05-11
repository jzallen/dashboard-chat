# Journey invariants — IC-1 through IC-6 from
# `docs/product/journeys/login-and-org-setup.yaml`.
#
# These are property-shaped invariants that any J-001 implementation
# must hold across ALL transitions, not just for a single scenario.
# Tagged @property to signal DELIVER's crafter to implement as
# property-based tests with generators.

@journey @property @driving_port
Feature: J-001 cross-state invariants hold across every sign-in attempt

  @skip @ic-1 @property
  Scenario: For any sign-in attempt, every signal Maya can observe carries the same reference code
    Given any sign-in attempt Maya makes
    When the attempt emits any observable signal
    Then every signal from that attempt carries the same reference code that was minted when she clicked sign in

  @skip @ic-2 @property @real-io
  Scenario: For any successful sign-in, Maya's access token agrees with the organization the app shows
    Given any sign-in attempt where Maya reaches the ready state
    When the harness inspects Maya's access token and the app shell
    Then the organization id on the token equals the organization id the app shell displays

  @skip @ic-3 @property
  Scenario: Maya is returned to the welcome page when her organization name fails validation
    Given Maya is on the welcome page
    When Maya submits an organization name that fails any validation rule
    Then Maya stays on the welcome page with the form showing an inline error
    And no organization has been created in Maya's tenant
    And Maya's access token has not been reissued

  @skip @ic-4 @property
  Scenario: After Maya's organization is created, the app does not declare her ready until the access reissue is also visible
    Given Maya has just submitted a valid organization name
    When the organization row is created but the access reissue has not yet succeeded
    Then Maya does not see the app shell yet
    And Maya sees a "Creating..." indication until both writes are visible

  @skip @ic-5 @property
  Scenario: Any 401 Maya encounters carries the reference code of the request that caused it
    Given any in-flight request Maya has sent during a session
    When the request returns with an access-expired signal
    Then the access-expired signal carries the reference code Maya's original request carried

  @skip @ic-6 @property
  Scenario: Maya's silent renewal is attempted at most once per expiry event
    Given Maya's access has just expired
    When silent renewal is triggered
    Then exactly one renewal attempt is made before any user-visible recovery page appears
