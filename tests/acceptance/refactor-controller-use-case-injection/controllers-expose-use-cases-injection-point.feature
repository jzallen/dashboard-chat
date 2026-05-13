# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 1 — The kwarg-injection mechanism is structurally present
# and behaviourally correct on every per-aggregate controller. Per
# DWD-1 (this distill) and DWD-1 (DESIGN), each of the six simple
# per-aggregate controllers gains:
#   (a) a module-private `_default_<aggregate>_uc` factory whose body
#       performs the deferred `from app.use_cases import <aggregate>`
#       import,
#   (b) a keyword-only `_use_cases=_default_<aggregate>_uc` parameter on
#       every public method,
# and the two multi-factory controllers (dataset, conversation) gain
# multiple factories named after each distinct use-case dependency
# (per upstream-changes.md §3).
#
# This milestone proves the mechanism is both STRUCTURALLY present
# (factory exists; kwarg appears; default callable is the factory) and
# BEHAVIOURALLY correct (default factory returns the real module; an
# injected factory replaces it; routers calling without the kwarg are
# unaffected — the FastAPI `Depends` non-interaction per DWD-3).
#
# The Scenario Outline parameterises the six simple per-aggregate
# controllers. Two standalone scenarios cover the multi-factory cases
# (dataset_controller's three factories; conversation_controller's
# submodule-aliased factories per upstream-changes.md §3). One
# regression scenario asserts that omitting `_use_cases` continues to
# resolve through the default factory (this pins the production-path
# behaviour: routers don't pass the kwarg; default wins).

@kwarg_injection @real-io @driving_adapter @pending
Feature: Every per-aggregate controller method exposes a working `_use_cases` injection point
  As a backend engineer rewriting characterization tests off module-level patches,
  I want every public per-aggregate controller method to accept a `_use_cases`
  keyword-only factory and to honour both the default and any caller-supplied value
  So that I can pass fakes via argument without touching `unittest.mock.patch`.

  Scenario Outline: <controller> exposes a `_use_cases` keyword-only parameter with the per-aggregate factory as default
    Given the per-aggregate controller module for "<aggregate>"
    When the engineer inspects the signature of "<method>"
    Then the parameter "_use_cases" is keyword-only
    And the parameter's default callable is the module-private factory "<factory>"
    And calling "<factory>" returns the real "<aggregate>" use-cases module

    Examples: simple per-aggregate controllers
      | controller              | aggregate     | method                   | factory                   |
      | report_controller       | report        | list_reports             | _default_report_uc        |
      | project_controller      | project       | list_projects            | _default_project_uc       |
      | query_engine_controller | query_engine  | list_query_engines       | _default_query_engine_uc  |
      | sql_access_controller   | sql_access    | get_sql_access           | _default_sql_access_uc    |
      | organization_controller | organization  | post_organization        | _default_organization_uc  |
      | view_controller         | view          | list_views               | _default_view_uc          |

  Scenario: A test-supplied factory replaces the default at call time on every simple per-aggregate controller
    Given a fake use-cases module that records every method invocation
    When the engineer calls each simple per-aggregate controller method with the fake injected via `_use_cases`
    Then every recorded invocation came through the fake module
    And no recorded invocation came through the real module

  Scenario: Routers calling controllers without the `_use_cases` kwarg get the default factory
    Given a router-style call to a simple per-aggregate controller method that omits `_use_cases`
    When the call resolves
    Then the default factory is invoked
    And the real use-cases module's method was the one called

  Scenario: dataset_controller exposes three named factories — one per distinct use-case dependency
    Given the per-aggregate controller module for "dataset"
    When the engineer inspects the module's factory functions
    Then a factory "_default_dataset_uc" is defined and returns the real "app.use_cases.dataset" module
    And a factory "_default_upload_uc" is defined and returns the real "app.use_cases.upload" module
    And a factory "_default_search_uc" is defined and returns the real "app.use_cases.dataset.search_datasets" submodule
    And every public method on DatasetController accepts a `_use_cases` keyword-only parameter whose default is one of the three factories

  Scenario: conversation_controller exposes a factory per submodule-aliased use case
    Given the per-aggregate controller module for "conversation"
    When the engineer inspects the module's factory functions
    Then a factory exists for each of the five submodule aliases — get_project_memory, create_session, list_sessions, list_session_events, update_session
    And every public method on ConversationController accepts a `_use_cases` keyword-only parameter whose default is the matching factory

  Scenario: Injecting a factory that raises propagates the failure to the caller
    Given a fake use-cases factory that raises a domain exception when invoked
    When the engineer calls a per-aggregate controller method with that factory injected via `_use_cases`
    Then the controller's response envelope describes the domain exception
    And the response status is the mapped error status

  Scenario: Injecting a factory whose returned module lacks the expected method surfaces an attribute error
    Given a fake use-cases factory whose returned module is missing the method the controller calls
    When the engineer calls the per-aggregate controller method with that factory injected via `_use_cases`
    Then an attribute error is raised naming the missing method
