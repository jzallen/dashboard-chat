# <!-- DES-ENFORCEMENT : exempt -->
# Milestone 2 — The bundled test rewrite landed and the alias-shim
# debt is gone. Per DWD-2 (DESIGN) — bundled test migration is binding;
# the feature is COMPLETE only when (a) all 105 patches are rewritten,
# (b) the 18-line alias block on http_controller.py is deleted, (c)
# the eight `_uc()` getters in per-aggregate controller files are
# deleted, and (d) the architectural rule passes (covered in
# milestone-3).
#
# DWD-6 (DESIGN) Iron Rule binding: the rewrite is a known L1
# transform — substitute the fixture mechanism without altering
# assertions. This milestone's "identical assertions" scenario pins
# that contract: the migrated test file's assertion lines match the
# pre-migration assertion lines byte-for-byte. The only allowed
# diffs are removed `@patch(...)` decorators, removed `mock_uc`
# parameter names, added local `mock_uc = MagicMock()` lines, and the
# new `_use_cases=lambda: mock_uc` keyword argument on the controller
# call.
#
# Observability: every assertion is on an observable artefact of the
# repository — file contents (grep results), file presence/absence
# (the alias block bytes; the `_uc()` getter bytes), or test-runner
# outcomes (the migrated tests pass). No internal state, no mock-call
# counts on production objects.

@test_migration @real-io @pending
Feature: The bundled test rewrite removes every patch, the alias block, and every `_uc()` getter
  As a backend engineer auditing the refactor's "stuck" property,
  I want the structural debt enumerated in DWD-2 to be physically gone from the repository
  So that no future contributor inherits the alias-shim hazard.

  Scenario: Zero `@patch` references to the legacy use-case aliases remain under backend/tests/controllers/
    Given the production source tree under "backend/tests/controllers/"
    When the engineer scans for `@patch("app.controllers.http_controller.<aggregate>_use_cases")` occurrences
    Then no occurrence remains in any file under that subtree

  Scenario: The 18-line alias block in http_controller.py is absent
    Given the production source tree under "backend/app/controllers/"
    When the engineer reads the contents of "http_controller.py"
    Then no line imports a use-case module under the name "<aggregate>_use_cases"
    And no line imports a use-case submodule under the name "<alias>_uc"
    And the file's docstring no longer warns "Do NOT remove any of the module-level aliases"

  Scenario: The eight `_uc()` getter functions in per-aggregate controllers are absent
    Given the production source tree under "backend/app/controllers/"
    When the engineer scans every "<aggregate>_controller.py" file for `def _uc()`
    Then no per-aggregate controller defines an `_uc()` getter
    And every per-aggregate controller defines at least one `_default_*_uc` factory in its place

  Scenario: Every migrated test file's assertions are byte-identical to the pre-migration assertions (Iron Rule)
    Given the pre-migration assertion lines captured for "backend/tests/controllers/test_organization_controller_char.py"
    When the engineer reads the migrated assertion lines for the same file
    Then every `assert` line, every `assert_awaited_once_with` line, and every `assert_called_with` line is byte-identical to its pre-migration counterpart
    And the only diffs in the file are removed `@patch(...)` decorators, removed `mock_uc` parameter names from method signatures, added local `mock_uc = MagicMock()` constructions, and added `_use_cases=lambda: mock_uc` arguments on controller calls

  Scenario: Every migrated test file passes when the test runner is invoked against it
    Given the migrated state of "backend/tests/controllers/"
    When the engineer runs the backend characterization suite
    Then every test under "backend/tests/controllers/" passes
    And no test under that subtree skips for "patch target missing" reasons

  Scenario: A characterization test that previously patched the alias still pins the same status code through the kwarg path
    Given a characterization test for "OrganizationController.get_my_organization" that previously patched the legacy alias to return Failure(ExternalServiceError)
    When the engineer runs the migrated test using `_use_cases=lambda: mock_uc` instead of the patch
    Then the assertion `status == 502` holds
    And the assertion line text is byte-identical to the pre-migration line

  Scenario: Submodule-aliased test sites in test_conversation_controller_char.py migrate to the matching factory kwarg
    Given a characterization test for "ConversationController.post_session" that previously patched "create_session_uc"
    When the engineer runs the migrated test using `_use_cases=lambda: mock_uc` against the controller method
    Then the assertion lines are byte-identical to the pre-migration lines
    And the test passes

  Scenario: Multi-factory test sites in test_dataset_controller_char.py migrate to the matching factory kwarg
    Given a characterization test for "DatasetController.post_upload" that previously patched "upload_use_cases"
    When the engineer runs the migrated test using `_use_cases=lambda: mock_upload_uc` against the controller method
    Then the assertion lines are byte-identical to the pre-migration lines
    And the test passes
