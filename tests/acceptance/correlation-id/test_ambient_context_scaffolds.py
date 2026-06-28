"""Ambient-context seams — the bind/read surface the K1 assertion stands on.

The correlation id must surface on log lines emitted deep in a handler without
being threaded through call signatures, so each runtime binds it ambiently: the
Python `correlation_id` `ContextVar` and the Node `AsyncLocalStorage` store.

The Python seam is exercised here directly and is RED until its implementation
sub-issue lands — `set` then `get` must round-trip, which today raises (the
scaffold is not implemented). This RED is stack-independent, so the suite
classifies RED even with no compose stack up. The Node seam is a TypeScript
module; its behaviour is proven RED in the Node test suites and transitively by
the K1 cross-service assertion, so here we only guard that the module the step
defs / production code import is present.
"""

from __future__ import annotations

from pathlib import Path
from types import ModuleType

import pytest


@pytest.mark.scaffold
def test_python_correlation_seam_binds_and_reads_back(
    python_correlation_context: ModuleType,
) -> None:
    correlation_id = "k1-binds-and-reads-back"

    python_correlation_context.set_correlation_id(correlation_id)

    assert python_correlation_context.get_correlation_id() == correlation_id


@pytest.mark.scaffold
def test_node_correlation_store_module_is_present(repo_root: Path) -> None:
    """The Node `AsyncLocalStorage` seam must exist for the services to import it."""
    store = repo_root / "shared" / "correlation-id" / "store.ts"

    assert store.exists(), (
        f"Node correlation store seam missing at {store} — auth-proxy, agent, "
        f"and ui-state import it to bind the id ambiently"
    )
