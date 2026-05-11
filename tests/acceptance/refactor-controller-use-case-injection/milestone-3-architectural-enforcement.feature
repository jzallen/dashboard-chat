# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 3 — Architectural enforcement (Principle 11) prevents
# regression. Per DWD-8 (DESIGN), a new file
# `backend/tests/architecture/test_controller_imports.py` declares
# three rules:
#   Rule A (anti-regression): app.controllers.http_controller MUST
#     NOT import from app.use_cases at module level.
#   Rule B (positive structural assertion): each per-aggregate
#     controller module MUST define a `_default_<aggregate>_uc`
#     callable AND every public method on its controller class MUST
#     have a keyword-only `_use_cases` parameter with that callable
#     as default.
#   Rule C (γ-prevention): no router file MUST contain
#     `Depends(<X>Controller` for any controller class.
#
# These scenarios prove each rule fires correctly when fed a
# synthetic violator (a file written into a tmp_path, evaluated via
# the same pytest-archon machinery the production rule uses) and
# stays silent against the legitimate codebase. The third scenario
# (FastAPI Depends non-interaction per DWD-3) ALSO has a positive
# regression assertion: every router file under backend/app/routers/
# is scanned and confirmed to call controllers as static methods,
# never via Depends.

@architectural_enforcement @real-io @pending
Feature: An architectural rule prevents future regression of the kwarg-injection mechanism
  As a backend engineer wanting the refactor to "stick",
  I want a CI-time architectural rule that fires the moment anyone
  re-introduces the alias block, drops the `_use_cases` kwarg, or
  wires a controller via `Depends`
  So that the refactor cannot silently regress through a future PR.

  Scenario: Rule A flags a synthetic re-introduction of a module-level use-case alias on http_controller
    Given a synthetic candidate version of "http_controller.py" that imports "from app.use_cases import organization as organization_use_cases" at module level
    When the architectural rule is evaluated against the production source tree augmented with the candidate
    Then the rule fails naming the candidate file
    And the failure message identifies "organization_use_cases" as the offending alias

  Scenario: Rule A stays silent against the legitimate post-refactor http_controller.py
    Given the legitimate post-refactor "backend/app/controllers/http_controller.py"
    When the architectural rule is evaluated
    Then the rule passes with zero violations

  Scenario: Rule B flags a synthetic per-aggregate controller missing the `_default_<aggregate>_uc` factory
    Given a synthetic candidate version of "report_controller.py" with no `_default_report_uc` factory defined
    When the architectural rule is evaluated against the production source tree augmented with the candidate
    Then the rule fails naming the candidate file
    And the failure message identifies the missing factory function

  Scenario: Rule B flags a synthetic per-aggregate controller method missing the `_use_cases` keyword-only parameter
    Given a synthetic candidate version of "report_controller.py" where "list_reports" was edited to drop the `_use_cases` parameter
    When the architectural rule is evaluated against the production source tree augmented with the candidate
    Then the rule fails naming the candidate file
    And the failure message identifies "list_reports" as the offending method

  Scenario: Rule B stays silent against every legitimate per-aggregate controller
    Given the legitimate post-refactor controllers in "backend/app/controllers/"
    When the architectural rule is evaluated
    Then the rule passes with zero violations across all eight per-aggregate controller modules

  Scenario: Rule C flags a synthetic router that wires a controller via FastAPI `Depends`
    Given a synthetic candidate router that contains `Depends(ReportController)` in a route handler signature
    When the architectural rule is evaluated against the production source tree augmented with the candidate
    Then the rule fails naming the candidate file
    And the failure message identifies "ReportController" as the controller wired via Depends

  Scenario: Rule C stays silent against every legitimate router (FastAPI Depends non-interaction per DWD-3)
    Given the production source tree under "backend/app/routers/"
    When the architectural rule scans every router file for `Depends(<X>Controller`
    Then no router contains `Depends(<X>Controller` for any controller class
    And every controller invocation in every router resolves through a direct static-method call

  Scenario: The architectural rule never references `_use_cases` as a use-case-function parameter (Risk 2 mitigation per DESIGN §7)
    Given the production source tree under "backend/app/use_cases/"
    When the architectural rule scans every use-case function signature for a `_use_cases` parameter
    Then no use-case function declares a parameter named `_use_cases`
