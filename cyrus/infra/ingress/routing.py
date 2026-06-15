"""Opaqueness-safe routing-key extraction for the dual-write ingress.

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
"""

from __future__ import annotations

import json

#: Catch-all routing key used when ``agentSession.creator.id`` is absent or the
#: body cannot be parsed — the handler still dual-writes, never drops (AC4).
UNROUTED = "_unrouted"


def extract_routing_key(body: bytes) -> str:
    """Return the session routing key (``agentSession.creator.id``) or ``UNROUTED``.

    Parses a COPY of ``body`` (decoded into a fresh string) to read the creator
    id; the input bytes are never mutated, preserving the signed-body invariant.
    Returns :data:`UNROUTED` when the field is missing, null, empty, or the body
    is unparseable. Total — never raises for bad input.
    """
    try:
        payload = json.loads(bytes(body).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return UNROUTED

    if not isinstance(payload, dict):
        return UNROUTED

    creator_id = (
        payload.get("agentSession", {}).get("creator", {}).get("id")
        if isinstance(payload.get("agentSession"), dict)
        and isinstance(payload["agentSession"].get("creator"), dict)
        else None
    )
    if isinstance(creator_id, str) and creator_id:
        return creator_id
    return UNROUTED
