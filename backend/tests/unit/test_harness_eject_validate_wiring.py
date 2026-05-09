"""Wiring unit tests for ``DatasetLayerHarness.eject_and_test`` / ``validate_after``.

Step 00-08 (dbt-test-validation, ADR-018 Option β). The harness facade gains
two extension methods that delegate to already-tested components:

    * ``eject_and_test(project_id, *, tmp_path=...)``
        delegates to the injected ``EjectOrchestratorProtocol``.
    * ``validate_after(dataset_id, schema)``
        fetches the staging ``TableState`` then runs ``PanderaValidator``.

Both components have full happy-path + failure coverage in their own unit
modules (``test_eject_orchestrator.py``, ``test_pandera_validator.py``). This
file's job is the WIRING — the smallest set of tests that prove the
harness threads its arguments through unchanged and surfaces the right
errors when callers skip the composition root.

Driving port: ``DatasetLayerHarness`` (the customer's actual entry point per
the WS .feature's ``@driving_adapter`` tag). Test doubles only at port
boundaries: ``EjectOrchestratorProtocol`` (driven port), ``PanderaValidator``
(driven port via module-level patch).

Test budget: 4 distinct wiring behaviors x 2 = 8. Using 4.
    1. eject_and_test delegates to injected orchestrator with (project_id, tmp_path)
    2. eject_and_test raises a clear error when no orchestrator was injected
    3. eject_and_test raises a clear error when no tmp_path was supplied
    4. validate_after fetches table state then delegates to PanderaValidator
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.integration.dataset_layer import harness as harness_module
from tests.integration.dataset_layer.harness import DatasetLayerHarness, TableState

# ---------------------------------------------------------------------------
# Fakes for the two driven ports the wiring touches.
# ---------------------------------------------------------------------------


@dataclass
class _FakeReport:
    """Stand-in for the orchestrator's ``EjectTestReport`` return value."""

    status: str = "pass"
    models_built: list[str] = field(default_factory=lambda: ["stg_orders"])
    tests_run: list[str] = field(default_factory=lambda: ["not_null_stg_orders_order_id"])


class _FakeOrchestrator:
    """Records ``eject_and_test`` calls; returns a fixed ``_FakeReport``."""

    def __init__(self, report: _FakeReport | None = None) -> None:
        self.report = report or _FakeReport()
        self.calls: list[tuple[str, Path]] = []

    async def probe(self, tmp_path: Path) -> Any:  # pragma: no cover — not exercised
        return None

    async def eject_and_test(self, project_id: str, tmp_path: Path) -> _FakeReport:
        self.calls.append((project_id, tmp_path))
        return self.report


def _make_harness(
    *,
    eject_orchestrator: Any | None = None,
    project_id: str | None = "harness-project",
) -> DatasetLayerHarness:
    """Build a harness without entering its async context.

    The wiring tests do not exercise HTTP clients; we instantiate the
    harness with placeholder URLs/JWT and inject the orchestrator
    directly. The lifecycle wrappers (``__aenter__``) are not needed
    because ``eject_and_test`` does not depend on them.
    """
    return DatasetLayerHarness(
        auth_proxy_url="http://test-proxy.local",
        agent_url="http://test-agent.local",
        user_jwt="test-jwt",
        project_id=project_id,
        eject_orchestrator=eject_orchestrator,
    )


# ---------------------------------------------------------------------------
# Behavior 1: eject_and_test delegates with (project_id, tmp_path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_eject_and_test_delegates_to_injected_orchestrator(tmp_path: Path) -> None:
    fake = _FakeOrchestrator()
    harness = _make_harness(eject_orchestrator=fake)

    report = await harness.eject_and_test("proj-abc", tmp_path=tmp_path)

    assert report is fake.report, "harness should return the orchestrator's report unchanged"
    assert fake.calls == [("proj-abc", tmp_path)], (
        f"orchestrator should be called once with the supplied project_id + tmp_path; got {fake.calls!r}"
    )


# ---------------------------------------------------------------------------
# Behavior 2: missing orchestrator raises a clear error
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_eject_and_test_without_orchestrator_raises_clear_error(tmp_path: Path) -> None:
    """The composition root is the ``eject_orchestrator`` session fixture
    (ADR-018 §11). Calling ``eject_and_test`` on a harness that was never
    handed an orchestrator is a wiring bug — fail loudly, not silently."""
    harness = _make_harness(eject_orchestrator=None)

    with pytest.raises(RuntimeError, match=r"eject_orchestrator"):
        await harness.eject_and_test("proj-abc", tmp_path=tmp_path)


# ---------------------------------------------------------------------------
# Behavior 3: missing tmp_path raises a clear error
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_eject_and_test_without_tmp_path_raises_clear_error() -> None:
    """The orchestrator's contract (orchestrator.py docstring) is that the
    caller supplies ``tmp_path`` — the orchestrator never allocates its own.
    The harness mirrors that discipline; calling without ``tmp_path`` is a
    programmer error and must surface immediately."""
    fake = _FakeOrchestrator()
    harness = _make_harness(eject_orchestrator=fake)

    with pytest.raises(RuntimeError, match=r"tmp_path"):
        await harness.eject_and_test("proj-abc")


# ---------------------------------------------------------------------------
# Behavior 4: validate_after fetches table state then delegates to PanderaValidator
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validate_after_fetches_table_state_and_delegates_to_validator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Per ADR-018 Option β, ``validate_after`` runs Pandera against the
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
