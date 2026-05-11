"""Wiring unit test for ``DatasetLayerHarness.validate_after``.

ADR-019 Option β / ADR-024 Phase 4. The harness facade exposes
``validate_after(dataset_id, schema)`` for per-turn Pandera validation;
this file covers the wiring contract — the harness threads the supplied
arguments through to ``PanderaValidator.validate`` unchanged.

The companion eject-and-test wiring tests retired with the eject
infrastructure in ADR-024 Phase 4c; ``test_harness_eject_validate_wiring.py``
was reshaped to this file by dropping the three eject-wiring tests and
keeping only behavior 4.

Driving port: ``DatasetLayerHarness``. Test doubles only at port boundaries
— ``PanderaValidator`` (driven port via module-level patch).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.integration.dataset_layer import harness as harness_module
from tests.integration.dataset_layer.harness import DatasetLayerHarness, TableState


def _make_harness() -> DatasetLayerHarness:
    """Build a harness without entering its async context.

    The wiring test does not exercise HTTP clients; we instantiate the
    harness with placeholder URLs/JWT. The lifecycle wrappers
    (``__aenter__``) are not needed because ``validate_after`` only
    composes ``get_table_state`` (monkeypatched here) and
    ``PanderaValidator.validate``.
    """
    return DatasetLayerHarness(
        auth_proxy_url="http://test-proxy.local",
        agent_url="http://test-agent.local",
        user_jwt="test-jwt",
        project_id="harness-project",
    )


@pytest.mark.asyncio
async def test_validate_after_fetches_table_state_and_delegates_to_validator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Per ADR-019 Option β, ``validate_after`` runs Pandera against the
    current ``TableState.df``. The wiring must:
        1. fetch the table state for the supplied dataset_id
        2. construct (or reuse) a PanderaValidator
        3. invoke ``.validate(df, schema)`` and return its result unchanged
    """
    harness = _make_harness()

    # Stub get_table_state — testing the wiring, not the datasets API.
    fake_table_state = TableState(
        dataset_id="ds-1",
        row_count=2,
        columns=[{"name": "order_id", "type": "INTEGER"}],
        preview=[{"order_id": 1}, {"order_id": 2}],
    )
    fetched_for: list[str] = []

    async def _fake_get_table_state(dataset_id: str, *, preview_limit: int = 100) -> TableState:
        fetched_for.append(dataset_id)
        return fake_table_state

    monkeypatch.setattr(harness, "get_table_state", _fake_get_table_state)

    # Patch the PanderaValidator the harness imports. We assert the harness
    # passed `state.df` (not the TableState wrapper) and the schema unchanged.
    expected_result = object()
    captured: dict[str, Any] = {}

    class _FakeValidator:
        def validate(self, df: Any, schema: Any) -> Any:
            captured["df"] = df
            captured["schema"] = schema
            return expected_result

    monkeypatch.setattr(harness_module, "PanderaValidator", _FakeValidator)

    schema_sentinel = MagicMock(name="pa.DataFrameSchema")
    result = await harness.validate_after("ds-1", schema_sentinel)

    assert result is expected_result, "harness should return PanderaValidator's result unchanged"
    assert fetched_for == ["ds-1"], (
        f"harness should fetch table state once for the supplied dataset_id; got fetched_for={fetched_for!r}"
    )
    # The harness must hand a DataFrame (TableState.df) to the validator,
    # not the TableState wrapper itself — Pandera operates on DataFrames.
    assert captured["df"] is not fake_table_state, "harness should pass TableState.df, not the TableState wrapper"
    assert captured["schema"] is schema_sentinel, "harness should pass the supplied schema through unchanged"
