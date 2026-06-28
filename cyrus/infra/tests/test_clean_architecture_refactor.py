"""Structural specification for the clean-architecture reframing of the ingress.

These tests pin the *shape* the ingress Lambda is being refactored toward — the
behaviour is already pinned (and must stay green) by the rest of the suite. Each
layer of the framing gets one or two assertions:

* identity is a pure value object (routing key + ``is_routed`` only, no body),
* presence is a ``Protocol`` (boolean read, fail-closed owned by the adapter),
* a single presenter is the sole producer of HTTP status codes,
* the two delivery paths are named use-case functions (addressed-consumer vs
  buffer), neither branching on ``delivery_mode`` (a composition-root wiring
  decision).

IF YOU'RE AN AGENT, READ THIS: these are RED until the refactor lands, so each is
``skip``-gated and imports its target symbol INSIDE the test body — collection
stays green and the behaviour-preservation suite is untouched. Enable them one at
a time as you implement each layer. The symbol names below are the issue's
*suggestions*; if you land different names, update the import in the one test you
are enabling (do not weaken the assertion). The properties — no body in the VO,
boolean ``Protocol``, no status literal in a use case, no ``delivery_mode`` branch
in a use case — are load-bearing; the names are not.
"""

from __future__ import annotations

import inspect
import json
import typing

import pytest

import routing

# Suggested target symbols (final names at implementer discretion — see module
# docstring). Each test imports what it needs locally so this stays collectable
# before the refactor exists.
_PENDING = "enable when the clean-architecture refactor lands (see distill roadmap)"

ROUTABLE_BODY = json.dumps(
    {
        "type": "AgentSessionEvent",
        "agentSession": {
            "creator": {
                "id": "00000000-0000-0000-0000-000000000000",
                "url": "https://linear.app/example-org/profiles/testuser",
            }
        },
    }
).encode("utf-8")

UNROUTABLE_BODY = json.dumps({"type": "AgentSessionEvent"}).encode("utf-8")


@pytest.mark.skip(reason=_PENDING)
def test_consumer_identity__holds_key_and_is_routed_only_no_body():
    """Identity is an immutable, no-I/O value object: routing key + ``is_routed``
    only, never the signed body bytes (opaqueness is load-bearing)."""
    from consumers import ConsumerIdentity  # type: ignore[attr-defined]

    identity = ConsumerIdentity.from_body(ROUTABLE_BODY)

    assert identity.key == "testuser"
    assert identity.is_routed is True

    # No body bytes are stored anywhere on the VO — the signed bytes must never
    # round-trip through identity.
    stored = [v for v in vars(identity).values()]
    assert ROUTABLE_BODY not in stored
    assert not any(isinstance(v, (bytes, bytearray)) for v in stored)

    # Immutable and equality-based: two identities for the same key are equal,
    # and attributes cannot be reassigned.
    assert identity == ConsumerIdentity.from_body(ROUTABLE_BODY)
    with pytest.raises(Exception):
        identity.key = "other"  # type: ignore[misc]


@pytest.mark.skip(reason=_PENDING)
def test_consumer_identity__unrouted_key__is_not_routed():
    """A body with no derivable key yields the ``_unrouted`` sentinel and
    ``is_routed is False`` — the addressed-consumer use case skips presence."""
    from consumers import ConsumerIdentity  # type: ignore[attr-defined]

    identity = ConsumerIdentity.from_body(UNROUTABLE_BODY)

    assert identity.key == routing.UNROUTED
    assert identity.is_routed is False


@pytest.mark.skip(reason=_PENDING)
def test_presence__is_modeled_as_a_protocol():
    """Presence is a ``typing.Protocol`` (``is_offline(username) -> bool``) that the
    DynamoDB-backed adapter satisfies structurally; fail-closed is the adapter's,
    documented in its docstring."""
    import presence
    from consumers import ConsumerPresenceRepository  # type: ignore[attr-defined]

    assert getattr(ConsumerPresenceRepository, "_is_protocol", False) is True

    sig = inspect.signature(ConsumerPresenceRepository.is_offline)
    assert list(sig.parameters)[-1] == "username"
    assert sig.return_annotation in (bool, "bool")

    # The adapter the handler builds satisfies the Protocol without inheritance.
    check = presence.make_offline_check(_StubDynamo(offline=True), "PresenceTable")
    assert isinstance(check, ConsumerPresenceRepository) or callable(check)


@pytest.mark.skip(reason=_PENDING)
def test_presenter__is_the_sole_producer_of_http_status():
    """No use-case function emits an HTTP status; a single presenter maps domain
    results to the ``HTTPResponse``."""
    import consumers

    use_case_names = ("relay_webhook_event_to_consumer", "enqueue_webhook_event")
    for name in use_case_names:
        fn = getattr(consumers, name)
        src = inspect.getsource(fn)
        assert "statusCode" not in src, f"{name} must not produce an HTTP status"
        assert "503" not in src and "200" not in src, (
            f"{name} must not hard-code HTTP codes — that is the presenter's job"
        )

    # The presenter exists and turns a domain result into the wire shape.
    presenter = consumers._shape_response  # type: ignore[attr-defined]
    assert "statusCode" in inspect.getsource(presenter)


@pytest.mark.skip(reason=_PENDING)
def test_strategies__exist_as_named_use_case_functions():
    """The two delivery paths are functions named for their single responsibility;
    the buffer use case does not hide its optimistic IoT probe."""
    import consumers

    relay = getattr(consumers, "relay_webhook_event_to_consumer")
    enqueue = getattr(consumers, "enqueue_webhook_event")
    assert callable(relay) and callable(enqueue)

    # The buffer name/structure must surface that it also probes IoT.
    enqueue_src = inspect.getsource(enqueue)
    assert "iot" in enqueue_src.lower() or "publish" in enqueue_src.lower()


@pytest.mark.skip(reason=_PENDING)
def test_use_cases__do_not_branch_on_delivery_mode():
    """``delivery_mode`` is a composition-root wiring decision; no use-case
    function references it."""
    import consumers

    for name in ("relay_webhook_event_to_consumer", "enqueue_webhook_event"):
        src = inspect.getsource(getattr(consumers, name))
        assert "delivery_mode" not in src, (
            f"{name} must not branch on delivery_mode — wire the strategy at the root"
        )


class _StubDynamo:
    """Minimal DynamoDB stand-in for the Protocol-satisfaction check."""

    def __init__(self, *, offline: bool) -> None:
        self._offline = offline

    def get_item(self, **_kwargs: typing.Any) -> dict[str, typing.Any]:
        if self._offline:
            return {}
        return {"Item": {"connected": {"BOOL": True}}}
