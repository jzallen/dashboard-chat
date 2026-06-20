"""Opaqueness-safe routing-key extraction for the dual-write ingress.

The dual-write ingress derives an IoT routing key from the webhook's user
identity so a verified webhook lands on ``cyrus/v1/sessions/{key}``. The key is
the **natural key — the Linear username** (e.g. ``testuser``), not the surrogate
``creator.id`` UUID: the operator must supply the same key when configuring their
local pump, and the username is the org-unique, operator-accessible identity.

The catch is that the webhook ``creator`` object has no ``displayName``/username
field — confirmed shape is ``email``, ``id``, ``name``, ``url``. The username
appears only as the trailing path segment of ``creator.url``
(``https://linear.app/<org>/profiles/<username>``). So extraction parses the url
and returns its last non-empty path segment. When that field is absent or the
body is unparseable, extraction returns the ``_unrouted`` sentinel so the handler
publishes to a catch-all and never drops the event.

OPAQUENESS CONTRACT (load-bearing): the bytes covered by ``Linear-Signature``
must never be mutated. ``extract_routing_key`` therefore parses a **separate
copy** of the body — a newly constructed string decoded from the input bytes,
never a reference to the original object that the handler publishes/enqueues.
The input ``body`` is read-only here; the caller's bytes are returned to IoT and
SQS untouched.
"""

from __future__ import annotations

import json
import re
from typing import Optional
from urllib.parse import unquote, urlparse

#: Catch-all routing key used when the username is not derivable from
#: ``creator.url`` or the body cannot be parsed — the handler still dual-writes,
#: never drops.
UNROUTED = "_unrouted"

#: Characters a derived username may contain to be usable as both an MQTT topic
#: segment and a DynamoDB key. Deliberately excludes the MQTT wildcards (``+``,
#: ``#``), the topic separator (``/``), and whitespace so a decoded segment can
#: never widen routing or break the topic. A segment that fails this falls back
#: to :data:`UNROUTED` (catch-all) — safe, since that path still never drops.
_USERNAME_RE = re.compile(r"\A[A-Za-z0-9._~-]+\Z")


def extract_routing_key(body: bytes) -> str:
    """Return the Linear username from ``creator.url`` or ``UNROUTED``.

    Parses a COPY of ``body`` (decoded into a fresh string) to read
    ``agentSession.creator.url`` and returns the username from a url shaped like
    ``.../profiles/<username>`` — the segment immediately after a ``profiles``
    path segment, URL-decoded and validated against :data:`_USERNAME_RE` so it is
    safe as an MQTT topic segment and DynamoDB key. The input bytes are never
    mutated, preserving the signed-body invariant. Returns :data:`UNROUTED` when
    the url is missing, null, empty, not in ``.../profiles/<username>`` shape,
    decodes to characters outside the allowed set, or the body is unparseable.
    Total — never raises for bad input.
    """
    try:
        payload = json.loads(bytes(body).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return UNROUTED

    if not isinstance(payload, dict):
        return UNROUTED

    creator_url = (
        payload.get("agentSession", {}).get("creator", {}).get("url")
        if isinstance(payload.get("agentSession"), dict)
        and isinstance(payload["agentSession"].get("creator"), dict)
        else None
    )
    if not isinstance(creator_url, str) or not creator_url:
        return UNROUTED

    segments = [seg for seg in urlparse(creator_url).path.split("/") if seg]
    if len(segments) < 2 or segments[-2] != "profiles":
        return UNROUTED

    username = unquote(segments[-1])
    if not _USERNAME_RE.match(username):
        return UNROUTED
    return username


def extract_creator_id(body: bytes) -> Optional[str]:
    """Return ``agentSession.creator.id`` (the surrogate UUID) or ``None``.

    The username is the operator-facing routing key, but the ``creator.id`` UUID
    is the stable correlation key for observability — emitted alongside the
    username on the offline path so an operator can correlate the 503 to a Linear
    user. Parses a COPY of ``body``; never mutates the signed bytes; total —
    returns ``None`` for any missing field or unparseable input.
    """
    try:
        payload = json.loads(bytes(body).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None

    if not isinstance(payload, dict):
        return None

    creator_id = (
        payload.get("agentSession", {}).get("creator", {}).get("id")
        if isinstance(payload.get("agentSession"), dict)
        and isinstance(payload["agentSession"].get("creator"), dict)
        else None
    )
    return creator_id if isinstance(creator_id, str) and creator_id else None
