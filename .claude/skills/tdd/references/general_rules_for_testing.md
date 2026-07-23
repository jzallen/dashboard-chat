# General Rules for Testing

Practices to follow when writing or refactoring tests in this repo. These are
conventions, not just style — follow them unless a test has a documented reason not to.

## The test is the specification

- A test describes intended behavior. **Never weaken or rewrite an assertion to make a
  failing test pass** (the project Iron Rule). If the implementation disagrees with the
  test, fix the implementation or escalate — do not edit the spec to match the bug.
- Write the test first; let it fail (RED) for the right reason before implementing.

## Documentation: docstrings, not a comment diary

- Prefer well-formatted docstrings on the test module and on non-trivial helpers over a
  running commentary of inline `# Behavior N:` comments. Let the assertions carry the
  meaning.
- A module-level docstring should give a human a quick read on **what is under test and
  the general behavior**. It may end with an agent section delimited by
  `IF YOU'RE AN AGENT, READ THIS:` holding short process rules (e.g. "tests are the
  spec — don't weaken assertions"), never running commentary.

## Test naming: `test_<unit>__<condition>__<outcome>`

- Name every test with three parts separated by **double underscores**:
  `test_<service or method>__<under-condition>__<produces-outcome>`. The name alone
  should read as a spec line — *what* is exercised, *under which* condition, and the
  *observable* result.
  ```python
  async def test_patch_source_archived__when_use_case_succeeds__returns_200_with_cold_storage_envelope(): ...
  async def test_patch_source_archived__when_source_not_found__returns_404_error_envelope(): ...
  ```
- The first segment is the unit under test (the method/function/service), **not** a vague
  "success"/"failure". The condition and outcome carry the behavior — if you can't name a
  distinct condition and outcome, the test is probably describing more than one behavior
  (see the one-assertion rule below).
- The self-describing name replaces grouping-by-class as the primary organizer; a class is
  optional sugar, never where the behavior description lives.

## Assertions: one per test, aggregate-to-aggregate

- Aim for **a single assertion per test**. If you find yourself making several, the test
  is probably describing more than one behavior — split it.
- **Compare whole objects, not disaggregated fields.** Don't pick a DTO apart
  (`assert msg.id == ...; assert msg.body == ...`). Build one explicit expected value —
  `expected_message`, `expected_result` — and compare the aggregate:
  `assert list(messages) == [expected_message]`. Frozen dataclasses / value objects make
  this clean because equality compares all fields.
- For a call with no return value, the assertion is at the boundary (e.g. a mock/stub
  verification that the call fired with the expected arguments).

## Build expected values from literals, not from the input's fixtures

- The expected value must **not** be re-derived from the same fixtures that build the
  test's input — otherwise the test can pass by echoing its own input (a tautology).
- Construct expected values from **literals / built-ins**. The deliberate duplication
  between the input fixtures and the literal expectation is the point: it pins the
  expectation independently and surfaces drift if the input data later changes.
- Verify the test passes for the *right* reason: when literal expectations duplicate
  fixture-derived data, confirm they actually match a correct parse before trusting GREEN.

## Builders for repeated construction

- When ~80% of an object's construction is identical across tests, extract a **builder
  helper with literal defaults** and let each test **override only the field it is
  about**:
  ```python
  def make_linear_webhook_message(**overrides):
      fields = {"message_id": "...", "receipt_handle": "...", "body": b"...", "headers": {...}}
      fields.update(overrides)
      return LinearWebhookMessage(**fields)
  ```
  A test about the receipt handle calls `make_linear_webhook_message(receipt_handle="...")`;
  everything else stays at its representative default.

## Helper-naming and pytest collection

- pytest collects any function named `test*`. **Do not put "test" in a helper's name** or
  it will be collected and run as a (broken) test. Name helpers to read as helpers:
  `make_*`, `build_*`, or a leading underscore (`_arrange_*`) for file-private helpers.

## Fixtures

- Fixtures live in `conftest.py` and are injected **by parameter name** — declare the
  leaf fixture you need and pytest resolves the dependency graph. `conftest.py` is
  auto-discovered for every test in its directory tree; never import the fixtures.
- Module-level **constants** in `conftest.py` are plain values — `import` them explicitly;
  they are not injected like fixtures.
- Mock only at port/boundary seams (injected clients, repositories). Do not mock internal
  classes.
