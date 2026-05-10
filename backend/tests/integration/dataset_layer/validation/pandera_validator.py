"""Pandera-based per-turn validator (ADR-019 Option β).

Wraps `pa.DataFrameSchema.validate(df, lazy=True)` to produce a
structured `ValidationResult` carrying status, column-level error
messages, and elapsed wall-clock time. The lazy=True flag makes
Pandera collect every violation rather than failing fast on the
first — the structured diff feeds retry-with-rephrase diagnostic
context (per ADR-019 OQ5).

Per-turn budget: < 200ms (acceptance budget per skill F-004; sub-100ms
typical per design.md §6 OQ4).

Phase 5: ``serialize_diff`` parses ``ValidationResult.errors`` into a
structured diff payload (``list[dict]``). ``DatasetLayerHarness.chat_turn``
attaches this to ``StructuredRetryExhaustion.validation_diff`` so callers
can introspect the failure shape rather than parsing the formatted
message back out.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd
import pandera.errors as pa_errors
import pandera.pandas as pa

# Mirrors the format ``_format_failure_cases`` emits below:
#     "<column>: failed check '<check>' (value=<value>)"
# Capture column / check / value separately so the structured diff carries
# parseable fields, not just a string. ``value`` is captured raw (Pandera
# already calls repr() into _format_failure_cases) so the structured form
# round-trips the original error text.
_DIFF_ENTRY_PATTERN = re.compile(r"^(?P<column>[^:]+):\s*failed check\s*'(?P<check>[^']*)'\s*\(value=(?P<value>.*)\)$")


@dataclass
class ValidationResult:
    """Observable outcome of one validate-after invocation.

    `status` is the binary outcome consumed by the harness's chat-turn
    loop. `errors` carries column-level diagnostic messages built from
    Pandera's `failure_cases` frame. `elapsed_ms` lets callers and tests
    enforce the per-turn timing budget. `over_budget` flips True when
    `elapsed_ms` exceeds the supplied `budget_ms` — a soft signal (status
    semantics are independent of timing) so callers can surface a budget
    breach in CI without failing the validation outright.
    """

    status: Literal["pass", "fail"]
    errors: list[str] = field(default_factory=list)
    elapsed_ms: float = 0.0
    over_budget: bool = False


class PanderaValidator:
    """Validates a DataFrame against a `pa.DataFrameSchema`."""

    def validate(
        self,
        df: pd.DataFrame,
        schema: pa.DataFrameSchema,
        *,
        budget_ms: float = 200.0,
    ) -> ValidationResult:
        start = time.perf_counter()
        try:
            schema.validate(df, lazy=True)
        except pa_errors.SchemaErrors as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            return ValidationResult(
                status="fail",
                errors=_format_failure_cases(exc.failure_cases),
                elapsed_ms=elapsed_ms,
                over_budget=elapsed_ms > budget_ms,
            )

        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return ValidationResult(
            status="pass",
            errors=[],
            elapsed_ms=elapsed_ms,
            over_budget=elapsed_ms > budget_ms,
        )


def serialize_diff(result: ValidationResult) -> list[dict[str, Any]]:
    """Parse ``ValidationResult.errors`` into a structured diff payload.

    Each entry has ``column`` / ``check`` / ``value`` fields when the
    error string matches the canonical format emitted by
    ``_format_failure_cases``. Entries that don't match (e.g. a future
    Pandera version with a different message shape) fall through with
    a ``raw`` field carrying the original string — diff payloads never
    silently drop information.

    Returns ``[]`` for pass-status results so callers can branch on
    ``if diff:`` without checking ``status`` separately.
    """
    if result.status != "fail":
        return []
    diff: list[dict[str, Any]] = []
    for error in result.errors:
        match = _DIFF_ENTRY_PATTERN.match(error)
        if match is None:
            diff.append({"raw": error})
            continue
        diff.append(
            {
                "column": match.group("column"),
                "check": match.group("check"),
                "value": match.group("value"),
            }
        )
    return diff


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
