# <!-- DES-ENFORCEMENT : exempt -->
# Walking-skeleton acceptance for refactor-controller-use-case-injection
# (ADR-023). Strategy: real I/O via the actual Python controller class as
# imported from the production package — no module-system mocks, no
# `unittest.mock.patch`. The "real adapter" for this refactor is the
# Python call mechanism that binds keyword-only default values when the
# caller omits the kwarg, and binds the caller's value when supplied.
# The test exercises that adapter end-to-end through the production
# OrganizationController class (driving port).
#
# Walking-skeleton scope: OrganizationController.get_my_organization.
# Justification:
#   - OrganizationController is the smallest aggregate controller (2
#     public methods total: get_my_organization + post_organization).
#   - get_my_organization is the smallest method on that controller —
#     one input (user), one happy path, no kwargs to thread through.
#   - The existing characterization test file
#     backend/tests/controllers/test_organization_controller_char.py is
#     the lightest of the seven char-test files (7 patches across 7
#     tests; smallest blast radius for a phase-00 demo migration).
#   - Choosing the smallest aggregate first matches DESIGN's Mikado
#     ordering recommendation in DWD-2 step 1 ("start with the smallest
#     surface").
#
# Driving port: OrganizationController.get_my_organization (the
# controller method itself, called as a static method, exactly as
# routers/organizations.py:39 calls it today). Observable: the
# tuple[dict, int] envelope the method returns. The fake injected via
# `_use_cases=` lets the scenario assert that what the controller emits
# is what the fake returned — i.e. the kwarg actually wired through
# instead of being silently ignored.
#
# Litmus test (Dim 9d): "If I deleted the real `_default_<aggregate>_uc`
# default-binding mechanism, would this WS still pass?" NO — without the
# kwarg threading through to the call expression, the production
# controller would fall back to its own default factory and the fake's
# data would never appear in the response. WS proves real wiring, not a
# stub.

@walking_skeleton @real-io @driving_adapter
Feature: A controller method accepts an injected use-case factory and returns the fake's data
  As a backend engineer migrating tests off `unittest.mock.patch` of module aliases,
  I want a per-aggregate controller method to accept a `_use_cases` keyword-only
  factory and route its call through that factory
  So that tests bind to the controller's signature, not to a module-level alias.

  Scenario: Engineer injects a fake use-case factory into get_my_organization and the controller returns the fake's data
    Given a fake organization use-cases module returning a single organization named "Acme"
    When the engineer calls get_my_organization with the fake factory injected
    Then the response envelope identifies the organization as "Acme"
    And the response status indicates a successful read
    And the fake's get_organization function received the engineer's user identity
