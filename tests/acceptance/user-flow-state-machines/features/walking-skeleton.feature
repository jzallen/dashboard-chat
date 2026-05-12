# Walking skeleton — user-flow-state-machines (J-001 / Slice 1).
#
# Strategy: C (real local adapters + fake WorkOS only) per `distill/wave-decisions.md` §DWD-2.
#
# This skeleton proves the server-owned `login-and-org-setup` machine
# threads end-to-end: a new contributor arrives, signs in through real
# auth-proxy → real ui-state tier → real Redis (FlowEvent log), with
# WorkOS faked over loopback HTTP. The skeleton answers the user-value
# question (Mandate 3): "Can a brand-new contributor see the app
# recognize her identity?"
#
# It is NOT a layer-connectivity proof. The "Then" steps assert user-
# observable outcomes (welcome message visible with email, recoverable-
# error UI absent), not internal side effects (no "row in Redis", no
# "HTTP 200").

@walking_skeleton @real-io @driving_port @us-001 @us-002 @slice-1 @clean
Feature: Maya signs in for the first time and lands on the welcome page with her identity recognized

  As Maya Chen, a brand-new contributor to a data team,
  I want to see that Dashboard Chat already knows who I am the moment I land
  So that I feel confident continuing without re-typing my identity.

  Background:
    Given a clean environment with no organization yet owned by Maya
    And the fake identity provider is configured to recognize Maya's profile
    And the ui-state services are healthy and reachable through the production ingress

  Scenario: Maya completes sign-in and the welcome page recognizes her by name
    Given Maya has never used Dashboard Chat before
    When Maya signs in through the production ingress
    Then Maya sees the welcome message addressed to "maya.chen@acme-data.example"
    And Maya sees a single form asking for her organization name
    And Maya does not see any error message at any point during sign-in
    And Maya's session can be observed in the same place by an accompanying test agent watching her sign-in
