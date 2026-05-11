"""Retry-semantics unit tests — port of M2.2 / M2.3 / M5.2 (ADR-024 Phase 3).

These tests assert the AC1.5 retry-with-rephrase contract on
``DatasetLayerHarness.chat_turn`` and the ``StructuredRetryExhaustion``
typed-attribute contract. They are reclassified out of the v1
``tests/acceptance/dbt-test-validation/`` suite, where they were unit
tests wearing acceptance-test clothing — the v1 step glue already
monkeypatched ``PanderaValidator.validate`` to drive deterministic
pass/fail/exhaustion paths, so a real compose stack and Groq round-trip
added latency without adding signal.

Test home decision (Phase 3 kickoff): pure unit. The retry-loop logic
is in-process inside ``chat_turn``; with ``ChatApi.send_turn`` and
``DatasetsApi.get_table_state`` stubbed via AsyncMock plus a
monkeypatched validator, the loop runs without HTTP, without an LLM,
without compose. The companion file
``backend/tests/unit/test_chat_turn_validate_with.py`` already
established the same stub shape for the ``validate_with`` hook;
Phase 3 reuses that shape here for the v1-scenario-named contracts.

Mapping to v1 scenarios:

* ``test_retry_success_on_rephrase`` ↔
  M2.2 ``Wrong-shape frame engages the retry-with-rephrase budget on
  first rephrase success`` (milestone-2-validate-after.feature).
* ``test_retry_exhausted_with_structured_diff`` ↔ merged port of
  M2.3 ``Wrong-shape frame exhausts the retry budget and raises with
  diagnostic context`` (milestone-2) + M5.2 ``Retry budget is exhausted
  — chat workflow fails with the validation diff visible``
  (milestone-5-failure-modes.feature). Both v1 scenarios drive the
  same path through ``chat_turn`` raising
  ``StructuredRetryExhaustion``; M5.2 is M2.3 plus the typed-attribute
  contract on the structured exception. Merging keeps the assertion
  set in one place.
* ``test_retry_budget_respects_ac15`` — sanity test that the
  AC1.5 budget cap (``max_retries=2`` ⇒ 3 attempts max) is honored:
  success on the last allowed attempt returns a trace; no fourth
  attempt is made.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

import pandas as pd
import pandera.pandas as pa
import pytest

from tests.integration.dataset_layer.harness import (
    ChatEventTrace,
    DatasetLayerHarness,
    StructuredRetryExhaustion,
    TableState,
)
from tests.integration.dataset_layer.validation import pandera_validator as pv_module
from tests.integration.dataset_layer.validation.pandera_validator import (
    ValidationResult,
)

_TRIVIAL_SCHEMA = pa.DataFrameSchema(columns={"x": pa.Column(int)})


def _make_stubbed_harness() -> tuple[DatasetLayerHarness, AsyncMock, AsyncMock]:
    """Build a harness with HTTP boundaries stubbed — pure unit shape.

    Returns ``(harness, send_turn_mock, get_table_state_mock)``. The
    chat-API mock returns a non-empty trace so the SSE-transcript
    assertion in ``test_retry_exhausted_with_structured_diff`` has
    something observable to capture; callers may overwrite
    ``send_turn_mock.return_value`` for tests that need different
    transcripts per attempt.
    """
    harness = DatasetLayerHarness(
        auth_proxy_url="http://localhost:3000",
        agent_url="http://localhost:8787",
        user_jwt="stub-jwt",
        project_id="proj-stub",
    )
    send_turn_mock = AsyncMock(
        return_value=ChatEventTrace(
            events=[{"type": "turn_started"}, {"type": "turn_done"}],
            raw_tool_call_seen=False,
        ),
    )
    get_table_state_mock = AsyncMock(
        return_value=TableState(
            dataset_id="ds-stub",
            row_count=1,
            columns=[{"name": "x", "type": "integer"}],
            preview=[{"x": 1}],
        ),
    )
    harness._chat = type("ChatStub", (), {"send_turn": send_turn_mock})()
    harness._datasets = type("DatasetsStub", (), {"get_table_state": get_table_state_mock})()
    return harness, send_turn_mock, get_table_state_mock


def _patch_validator_with_results(
    monkeypatch: pytest.MonkeyPatch,
    results: list[ValidationResult],
) -> None:
    """Patch ``PanderaValidator.validate`` to pop results FIFO.

    Mirrors the v1 step glue's substrate-side injection pattern so the
    rephrase loop sees a deterministic pass/fail sequence regardless of
    LLM / table-state behavior.
    """

    queue = list(results)

    def _stub_validate(self: Any, df: pd.DataFrame, schema: Any, *, budget_ms: float = 200.0) -> ValidationResult:
        if not queue:
            return ValidationResult(status="pass", errors=[], elapsed_ms=1.0, over_budget=False)
        return queue.pop(0)

    monkeypatch.setattr(pv_module.PanderaValidator, "validate", _stub_validate)


def test_retry_success_on_rephrase(monkeypatch: pytest.MonkeyPatch) -> None:
    """M2.2 port — fail-then-pass engages the rephrase loop and succeeds.

    Asserts both ends of the contract:

    * The rephrase loop engages (two ``send_turn`` calls, two validations).
    * The second ``send_turn`` receives a *rephrased* prompt — the v1
      contract says the harness re-prompts on validation failure rather
      than re-sending the original verbatim. The default rephrase
      strategy prefixes ``"In other words: "`` for prompts not in its
      lookup table; asserting on the prefix change pins the rephrase
      observable without coupling to the exact lookup table.
    """
    harness, send_turn_mock, get_table_state_mock = _make_stubbed_harness()
    _patch_validator_with_results(
        monkeypatch,
        [
            ValidationResult(
                status="fail",
                errors=["region: failed check 'isin' (value='Mars')"],
                elapsed_ms=2.0,
                over_budget=False,
            ),
            ValidationResult(status="pass", errors=[], elapsed_ms=1.0, over_budget=False),
        ],
    )

    trace = asyncio.run(
        harness.chat_turn(
            "validate the staging frame",
            dataset_id="ds-stub",
            validate_with=_TRIVIAL_SCHEMA,
            max_retries=2,
        ),
    )

    assert isinstance(trace, ChatEventTrace), "harness should return the trace from the successful attempt"
    assert send_turn_mock.await_count == 2, "rephrase loop must run a second send_turn after the first fail"
    assert get_table_state_mock.await_count == 2, "validation must re-fetch table state on the rephrase attempt"

    # AC1.5 contract: the second prompt is a rephrase of the original,
    # not the original verbatim. The default _default_rephrase prefixes
    # "In other words: " when the prompt isn't in its lookup table.
    first_prompt = send_turn_mock.await_args_list[0].args[0]
    second_prompt = send_turn_mock.await_args_list[1].args[0]
    assert first_prompt == "validate the staging frame", "first attempt sends original prompt"
    assert second_prompt != first_prompt, "rephrase loop must mutate the prompt, not resend the original"


def test_retry_exhausted_with_structured_diff(monkeypatch: pytest.MonkeyPatch) -> None:
    """M2.3 + M5.2 merged port — exhaustion raises with structured + string diff.

    M2.3 (v1 milestone-2) asserts on the formatted message:
    ``str(exc)`` carries the offending column AND the validation diff
    so a human reading the failure has actionable context.

    M5.2 (v1 milestone-5) asserts the structured contract:
    ``StructuredRetryExhaustion`` carries typed ``prompt``, ``attempts``,
    ``validation_diff`` (parsed list[dict]), and ``sse_transcript``
    (last attempt's events) so callers can introspect the failure
    programmatically rather than parsing the message back out.

    Both contracts drive the same path through ``chat_turn``, so they
    are merged here into one assertion set. The rephrase loop runs the
    full AC1.5 budget (3 attempts at ``max_retries=2``) before raising.
    """
    harness, send_turn_mock, _ = _make_stubbed_harness()
    always_fail = ValidationResult(
        status="fail",
        errors=[
            "region: failed check 'isin' (value='Mars')",
            "quantity: failed check 'in_range(1, 10000)' (value=0)",
        ],
        elapsed_ms=2.0,
        over_budget=False,
    )
    _patch_validator_with_results(monkeypatch, [always_fail, always_fail, always_fail])

    with pytest.raises(StructuredRetryExhaustion) as excinfo:
        asyncio.run(
            harness.chat_turn(
                "validate the staging frame",
                dataset_id="ds-stub",
                validate_with=_TRIVIAL_SCHEMA,
                max_retries=2,
            ),
        )

    exc = excinfo.value

    # M2.3 contract: subclass of AssertionError so existing call sites
    # catching AssertionError keep working.
    assert isinstance(exc, AssertionError), (
        "StructuredRetryExhaustion must subclass AssertionError so v1 "
        "pytest.raises(AssertionError) call sites continue to fire"
    )

    # M2.3 contract: formatted message names the offending column AND
    # carries the validation diff text so a human reading the failure
    # gets actionable context without unpacking attributes.
    msg = str(exc)
    assert "region" in msg, f"expected offending column 'region' in message: {msg!r}"
    assert "Mars" in msg or "isin" in msg, f"expected validation diff (failure value or check name) in message: {msg!r}"

    # M5.2 contract: typed attributes carry the full structured payload.
    assert exc.prompt == "validate the staging frame", "prompt attribute must echo the original (unrepased) prompt"
    assert exc.attempts == 3, f"AC1.5 budget = max_retries(2) + 1; got {exc.attempts}"

    # validation_diff is parsed via serialize_diff into list[dict] with
    # per-column structured fields — the contract subsumes M2.3's
    # diff-string assertion (the parsed form round-trips the string).
    assert isinstance(exc.validation_diff, list), "validation_diff must be a list of structured entries"
    diff_columns = {entry.get("column") for entry in exc.validation_diff}
    assert {"region", "quantity"} <= diff_columns, (
        f"expected both failing columns in structured diff: {exc.validation_diff!r}"
    )

    # sse_transcript carries the LAST attempt's ChatEvents so the failure
    # post-mortem can see what the agent emitted before exhaustion.
    transcript_types = [e.get("type") for e in exc.sse_transcript]
    assert "turn_done" in transcript_types, f"expected last attempt's transcript: {transcript_types!r}"

    # AC1.5: exactly max_retries+1 send_turn calls, no more.
    assert send_turn_mock.await_count == 3, (
        f"AC1.5 budget violated: expected 3 attempts (max_retries=2 + 1), got {send_turn_mock.await_count}"
    )


def test_retry_budget_respects_ac15(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC1.5 sanity — success on the LAST allowed attempt returns the trace.

    Boundary case the M2.2 / M2.3 ports do not directly cover: with
    ``max_retries=2`` the budget is 3 attempts (1 original + 2
    rephrases). If the validator passes only on attempt 3, the harness
    must accept that result and return — it must NOT raise simply
    because the prior attempts failed. A regression here would mean the
    AC1.5 budget cap was off-by-one in either direction.
    """
    harness, send_turn_mock, _ = _make_stubbed_harness()
    fail = ValidationResult(
        status="fail",
        errors=["region: failed check 'isin' (value='Mars')"],
        elapsed_ms=2.0,
        over_budget=False,
    )
    pass_ = ValidationResult(status="pass", errors=[], elapsed_ms=1.0, over_budget=False)
    # fail, fail, pass — pass on attempt 3 (the last AC1.5 allows).
    _patch_validator_with_results(monkeypatch, [fail, fail, pass_])

    trace = asyncio.run(
        harness.chat_turn(
            "validate the staging frame",
            dataset_id="ds-stub",
            validate_with=_TRIVIAL_SCHEMA,
            max_retries=2,
        ),
    )

    assert isinstance(trace, ChatEventTrace), "third-attempt success must return the trace, not raise"
    assert send_turn_mock.await_count == 3, (
        f"third attempt should fire (last allowed under AC1.5); got {send_turn_mock.await_count}"
    )
