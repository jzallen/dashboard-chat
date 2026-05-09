"""Protocols for the eject-and-test orchestration boundary.

Per ADR-018 D5 the orchestrator MUST expose ``probe()`` and
``eject_and_test()``. ``runtime_checkable`` plus ``mypy`` together catch
the "lite orchestrator without a probe" failure mode at type-check and
construction time. The orchestrator class in ``orchestrator.py``
implements this protocol structurally (Python's duck-typing semantics —
no inheritance required).

The signatures here are intentionally loose (``*args``, ``**kwargs``).
Protocols define the SHAPE of the API the session-fixture binds against;
strict argument typing happens at the concrete-class level.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class EjectOrchestratorProtocol(Protocol):
    """Subtype boundary for the eject orchestrator (ADR-018 D5)."""

    async def probe(self, tmp_path: Path) -> Any:
        """Run the 5 earned-trust probes once (cached); return aggregate."""
        ...

    async def eject_and_test(self, project_id: str, tmp_path: Path) -> Any:
        """Fetch zip -> unzip -> seed profile -> run dbt -> parse -> report."""
        ...
