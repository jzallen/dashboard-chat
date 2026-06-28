"""The Python ambient bind/read contract — mirrors ``app.auth.context``."""

import asyncio

from app.correlation.context import (
    clear_correlation_id,
    get_correlation_id,
    set_correlation_id,
)


def test_binding_an_id_reads_it_back():
    set_correlation_id("corr-binds-and-reads-back")

    assert get_correlation_id() == "corr-binds-and-reads-back"


def test_unset_context_reads_none():
    clear_correlation_id()

    assert get_correlation_id() is None


def test_id_propagates_across_await_boundaries():
    """The whole point of a ContextVar: deep async work sees the bound id."""

    async def deep_call() -> str | None:
        await asyncio.sleep(0)
        return get_correlation_id()

    async def scenario() -> str | None:
        set_correlation_id("corr-survives-await")
        return await deep_call()

    assert asyncio.run(scenario()) == "corr-survives-await"
