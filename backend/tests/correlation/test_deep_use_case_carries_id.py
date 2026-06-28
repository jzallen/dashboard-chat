"""AC1.4: a log line emitted deep inside a use case carries the request's id.

The use case takes NO correlation id in its signature. The id reaches its log
line purely through the ``ContextVar`` bound at the request edge — the guarantee
that lets an operator trace one request across every line it produced.

``handle_returns`` is the real seam: it logs ``Error in <use_case>`` through the
``app.use_cases`` logger whenever a wrapped use case raises, so a failing use
case emits a genuine deep log line with no id threaded through its arguments.
"""

import asyncio
import io
import json
import logging

from app.correlation.context import clear_correlation_id, set_correlation_id
from app.correlation.logging_config import CorrelationJsonFormatter
from app.use_cases import handle_returns


@handle_returns
async def _use_case_that_fails(project_id: str):
    """A representative use case — note: no correlation id in the signature."""
    raise ValueError(f"cannot process {project_id}")


def test_use_case_error_line_carries_bound_correlation_id():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(CorrelationJsonFormatter())
    use_case_logger = logging.getLogger("app.use_cases")
    use_case_logger.addHandler(handler)

    try:
        set_correlation_id("corr-deep-in-use-case")
        result = asyncio.run(_use_case_that_fails("proj-42"))
    finally:
        use_case_logger.removeHandler(handler)
        clear_correlation_id()

    assert result.failure() is not None  # the use case failed, producing the log line

    lines = [line for line in stream.getvalue().splitlines() if line.strip()]
    records = [json.loads(line) for line in lines]
    deep_line = next(r for r in records if r["event.module"] == "app.use_cases")
    assert deep_line["attributes"]["correlation_id"] == "corr-deep-in-use-case"
