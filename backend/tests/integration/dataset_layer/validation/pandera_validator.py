"""Pandera-based per-turn validator (ADR-018 Option β).

Wraps `pa.DataFrameSchema.validate(df, lazy=True)` to produce a
structured `ValidationResult` carrying status, column-level error
messages, and elapsed wall-clock time. The lazy=True flag makes
Pandera collect every violation rather than failing fast on the
first — the structured diff feeds retry-with-rephrase diagnostic
context (per ADR-018 OQ5).

Per-turn budget: < 200ms (acceptance budget per skill F-004; sub-100ms
typical per design.md §6 OQ4).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd
import pandera.errors as pa_errors
import pandera.pandas as pa


@dataclass
class ValidationResult:
    """Observable outcome of one validate-after invocation.

    `status` is the binary outcome consumed by the harness's chat-turn
    loop. `errors` carries column-level diagnostic messages built from
    Pandera's `failure_cases` frame. `elapsed_ms` lets callers and tests
    enforce the per-turn timing budget.
    """

    status: Literal["pass", "fail"]
    errors: list[str] = field(default_factory=list)
    elapsed_ms: float = 0.0


class PanderaValidator:
    """Validates a DataFrame against a `pa.DataFrameSchema`."""

    def validate(self, df: pd.DataFrame, schema: pa.DataFrameSchema) -> ValidationResult:
        start = time.perf_counter()
        try:
            schema.validate(df, lazy=True)
        except pa_errors.SchemaErrors as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            return ValidationResult(
                status="fail",
                errors=_format_failure_cases(exc.failure_cases),
                elapsed_ms=elapsed_ms,
            )

        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return ValidationResult(status="pass", errors=[], elapsed_ms=elapsed_ms)


def _format_failure_cases(failure_cases: pd.DataFrame) -> list[str]:
    """Build column-level error messages from Pandera's failure_cases frame.

    Pandera's `failure_cases` has one row per violation with `column`,
    `check`, `failure_case`, and `index` columns. We collapse to one
    message per (column, check, value) so identical violations across
    many rows don't drown the diagnostic.
    """
    if failure_cases is None or failure_cases.empty:
        return []

    seen: set[tuple[Any, Any, Any]] = set()
    messages: list[str] = []
    for row in failure_cases.itertuples(index=False):
        column = getattr(row, "column", None) or "<schema>"
        check = getattr(row, "check", "")
        value = getattr(row, "failure_case", "")
        key = (column, check, value)
        if key in seen:
            continue
        seen.add(key)
        messages.append(f"{column}: failed check '{check}' (value={value!r})")
    return messages
