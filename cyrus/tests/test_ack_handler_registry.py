"""Unit tests for :class:`AckHandlerRegistry` — the manual-ack handle bookkeeping.

MQTT5 surfaces no inbound packet id, so the adapter mints a monotonic one per publish
and stashes the QoS 1 acknowledgement-control handle under it. The registry owns that
mapping (and its lock); these tests pin id allocation and the one-shot pop that makes a
double/late ack a safe no-op. They use plain sentinel objects as handles — the registry
never inspects them, it only hands them back.
"""

from __future__ import annotations

from webhook_feeds.iot_feed import AckHandlerRegistry


def test_register_returns_the_handle_under_a_fresh_id_on_pop() -> None:
    """A registered handle comes back from pop() under the id register() returned."""
    registry = AckHandlerRegistry()
    handle = object()

    packet_id = registry.register(handle)

    assert registry.pop(packet_id) is handle


def test_register_allocates_a_distinct_id_per_publish() -> None:
    """Two registrations get different ids so their handles don't collide."""
    registry = AckHandlerRegistry()

    first_id = registry.register(object())
    second_id = registry.register(object())

    assert first_id != second_id


def test_pop_is_one_shot_so_a_second_pop_returns_none() -> None:
    """A handle pops once; a double/late ack for the same id finds nothing (safe no-op)."""
    registry = AckHandlerRegistry()
    packet_id = registry.register(object())
    registry.pop(packet_id)

    assert registry.pop(packet_id) is None


def test_pop_of_an_unknown_id_returns_none() -> None:
    """Popping an id that was never registered is a safe no-op."""
    registry = AckHandlerRegistry()

    assert registry.pop(999) is None
