"""Ambient correlation-id binding — the bind/read contract the trace stands on.

The correlation id must surface on log lines emitted deep in a handler without
being threaded through call signatures, so each runtime binds it ambiently: the
Python `correlation_id` `ContextVar` and the Node `AsyncLocalStorage` store.

This pins the Python half: a value bound to the current context reads back. It
needs no compose stack, so it fails RED for the right reason in any environment
until the binding lands. The Node half is pinned by its own round-trip test in
`shared/correlation-id/store.test.ts`.
"""

from __future__ import annotations

from types import ModuleType


def test_binding_an_id_reads_it_back(
    python_correlation_context: ModuleType,
) -> None:
    correlation_id = "corr-binds-and-reads-back"

    python_correlation_context.set_correlation_id(correlation_id)

    assert python_correlation_context.get_correlation_id() == correlation_id
