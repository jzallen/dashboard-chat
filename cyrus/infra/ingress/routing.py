"""Opaqueness-safe routing-key extraction for the dual-write ingress (RED scaffold).

The dual-write ingress derives an IoT routing key from the webhook's user
identity — ``agentSession.creator.id`` — so a verified webhook lands on
``cyrus/v1/sessions/{key}``. When that field is absent or the body is
unparseable, extraction returns the ``_unrouted`` sentinel so the handler
publishes to a catch-all and never drops the event (DC-21 AC4).

OPAQUENESS CONTRACT (load-bearing): the bytes covered by ``Linear-Signature``
must never be mutated. ``extract_routing_key`` therefore parses a **separate
copy** of the body — a newly constructed string decoded from the input bytes,
never a reference to the original object that the handler publishes/enqueues.
The input ``body`` is read-only here; the caller's bytes are returned to IoT and
SQS untouched.

IF YOU'RE AN AGENT, READ THIS: this is a scaffold. ``extract_routing_key``
deliberately raises ``AssertionError`` so the DC-30 RED tests fail on the
scaffold marker (RED, not BROKEN). DC-31 turns it green; do not mutate ``body``
to make it pass and do not weaken the byte-identity tests.
"""

from __future__ import annotations

__SCAFFOLD__ = True

#: Catch-all routing key used when ``agentSession.creator.id`` is absent or the
#: body cannot be parsed — the handler still dual-writes, never drops (AC4).
UNROUTED = "_unrouted"

_NOT_IMPLEMENTED = "Not yet implemented — RED scaffold"


def extract_routing_key(body: bytes) -> str:
    """Return the session routing key (``agentSession.creator.id``) or ``UNROUTED``.

    Parses a COPY of ``body`` (decoded into a fresh string) to read the creator
    id; the input bytes are never mutated, preserving the signed-body invariant.
    Returns :data:`UNROUTED` when the field is missing or the body is unparseable.
    """
    raise AssertionError(_NOT_IMPLEMENTED)
