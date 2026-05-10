"""Unit tests for DatasetLayerHarness.chat_turn(validate_with=...) hook.

Phase 3 of dbt-test-validation (ADR-019 Option β): chat_turn gains a
strictly-additive `validate_with: pa.DataFrameSchema | None` keyword. When
set, after a successful turn the harness internally constructs a
post_turn_check that calls validate_after(dataset_id, validate_with) and
raises AssertionError on validation fail (engaging the existing AC1.5
retry-with-rephrase loop). When None (default), behavior is identical
to today.

Behaviors covered (test budget: 4 behaviors x 2 = 8 unit tests max — under
budget here at 4):
1. validate_with=None preserves the existing zero-check behavior.
2. validate_with set + validator returns "pass" -> trace returned.
3. validate_with set + validator fails twice + passes third -> rephrase
   loop engages, trace eventually returned.
4. validate_with set + validator always fails -> AssertionError raised
   after retries exhaust, message contains the offending column AND the
   per-turn diff.

These are pure unit tests: HTTP boundaries (`harness._chat.send_turn`,
`harness._datasets.get_table_state`) are stubbed via AsyncMock so the test
runs without the compose stack. The PanderaValidator is monkey-patched at
the module-import site the harness uses — this is the same substrate-side
injection pattern milestone-3 probe scenarios use.
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
    TableState,
)
from tests.integration.dataset_layer.validation import pandera_validator as pv_module
from tests.integration.dataset_layer.validation.pandera_validator import (
    ValidationResult,
)

_TRIVIAL_SCHEMA = pa.DataFrameSchema(columns={"x": pa.Column(int)})


def _make_harness_with_stubs(
    *,
    validation_results: list[ValidationResult] | None = None,
) -> tuple[DatasetLayerHarness, AsyncMock, AsyncMock, list[ValidationResult]]:
    """Build a harness with mocked HTTP wrappers and an optional patched validator.

    Returns (harness, send_turn_mock, get_table_state_mock, recorded_results).
    `validation_results` is the FIFO queue of results the patched
    PanderaValidator.validate() will pop on each call. `recorded_results`
    is the list the wrapper appends to so callers can verify count.
    """
    harness = DatasetLayerHarness(
        auth_proxy_url="http://localhost:3000",
        agent_url="http://localhost:8787",
        user_jwt="stub-jwt",
        project_id="proj-stub",
    )
    # Bypass __aenter__ — wire only the wrappers chat_turn touches.
    send_turn_mock = AsyncMock(return_value=ChatEventTrace(events=[], raw_tool_call_seen=False))
    get_table_state_mock = AsyncMock(
        return_value=TableState(
            dataset_id="ds-stub",
            row_count=1,
            columns=[{"name": "x", "type": "integer"}],
            preview=[{"x": 1}],
        )
    )
    harness._chat = type("ChatStub", (), {"send_turn": send_turn_mock})()
    harness._datasets = type("DatasetsStub", (), {"get_table_state": get_table_state_mock})()
    return harness, send_turn_mock, get_table_state_mock, validation_results or []


def _patch_validator(monkeypatch: pytest.MonkeyPatch, results: list[ValidationResult]) -> list[int]:
    """Patch PanderaValidator.validate to return queued results FIFO.

    Returns a one-element list whose single int is the call counter, so
    tests can assert on number of validation invocations.
    """
    counter = [0]

    def _stub_validate(self: Any, df: pd.DataFrame, schema: Any, *, budget_ms: float = 200.0) -> ValidationResult:
        counter[0] += 1
        if not results:
            return ValidationResult(status="pass", errors=[], elapsed_ms=1.0, over_budget=False)
        return results.pop(0)

    monkeypatch.setattr(pv_module.PanderaValidator, "validate", _stub_validate)
    return counter


class TestChatTurnValidateWithHook:
    def test_validate_with_none_preserves_existing_behavior(self) -> None:
        harness, send_turn_mock, get_table_state_mock, _ = _make_harness_with_stubs()

        trace = asyncio.run(harness.chat_turn("hello", dataset_id="ds-stub"))

        assert isinstance(trace, ChatEventTrace)
        assert send_turn_mock.await_count == 1
        # validate_with is None — no table-state fetch, no validation.
        assert get_table_state_mock.await_count == 0

    def test_validate_with_set_and_pass_returns_trace_after_one_attempt(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        harness, send_turn_mock, get_table_state_mock, _ = _make_harness_with_stubs()
        counter = _patch_validator(
            monkeypatch,
            [ValidationResult(status="pass", errors=[], elapsed_ms=1.0, over_budget=False)],
        )

        trace = asyncio.run(
            harness.chat_turn(
                "hello",
                dataset_id="ds-stub",
                validate_with=_TRIVIAL_SCHEMA,
            )
        )

        assert isinstance(trace, ChatEventTrace)
        assert send_turn_mock.await_count == 1
        assert get_table_state_mock.await_count == 1
        assert counter[0] == 1

    def test_validate_with_engages_rephrase_loop_on_first_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        harness, send_turn_mock, get_table_state_mock, _ = _make_harness_with_stubs()
        counter = _patch_validator(
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
                "hello",
                dataset_id="ds-stub",
                validate_with=_TRIVIAL_SCHEMA,
                max_retries=2,
            )
        )

        assert isinstance(trace, ChatEventTrace)
        # Two attempts: original + first rephrase.
        assert send_turn_mock.await_count == 2
        assert get_table_state_mock.await_count == 2
        assert counter[0] == 2

    def test_validate_with_raises_on_exhausted_retries_with_column_and_diff(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        harness, send_turn_mock, _, _ = _make_harness_with_stubs()
        always_fail = ValidationResult(
            status="fail",
            errors=["region: failed check 'isin' (value='Mars')"],
            elapsed_ms=2.0,
            over_budget=False,
        )
        # Provide enough fails for all attempts (3 = 1 + max_retries=2).
        _patch_validator(monkeypatch, [always_fail, always_fail, always_fail])

        with pytest.raises(AssertionError) as excinfo:
            asyncio.run(
                harness.chat_turn(
                    "hello",
                    dataset_id="ds-stub",
                    validate_with=_TRIVIAL_SCHEMA,
                    max_retries=2,
                )
            )

        msg = str(excinfo.value)
        # Outer "after N attempts" wrapper present.
        assert "after 3 attempts" in msg, f"missing exhaustion preamble: {msg!r}"
        # Per the task spec: column name + diff propagate to the final raise.
        assert "region" in msg, f"expected offending column name in message: {msg!r}"
        # The structured per-turn errors list IS the diff — at minimum the
        # check name 'isin' or the failure value 'Mars' should be present so
        # the rephrase prompt has actionable diagnostic context.
        assert "Mars" in msg or "isin" in msg, (
            f"expected validation diff (failure value or check name) in message: {msg!r}"
        )
        # And three send_turn attempts were made before exhaustion.
        assert send_turn_mock.await_count == 3
