"""Specification for opaqueness-safe routing-key extraction.

The routing key is ``agentSession.creator.id``; when absent or unparseable the
extractor returns the ``_unrouted`` sentinel so the handler never drops an event.
The load-bearing invariant is opaqueness: extraction must read a COPY of the body
and leave the caller's bytes untouched.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. ``extract_routing_key``
reads the creator id WITHOUT mutating the input bytes. Do not weaken the
byte-identity assertion.
"""

from __future__ import annotations

import json

from conftest import CREATOR_ID, routable_body  # noqa: F401 — used as a fixture

import routing


def test_extracts_creator_id_as_the_routing_key():
    body = json.dumps({"agentSession": {"creator": {"id": CREATOR_ID}}}).encode("utf-8")
    assert routing.extract_routing_key(body) == CREATOR_ID


def test_returns_unrouted_when_creator_id_is_absent():
    body = json.dumps({"type": "AgentSessionEvent"}).encode("utf-8")
    assert routing.extract_routing_key(body) == routing.UNROUTED


def test_returns_unrouted_when_body_is_unparseable():
    assert routing.extract_routing_key(b"not json{{{") == routing.UNROUTED


def test_does_not_mutate_the_input_body_bytes():
    """Opaqueness: the bytes covered by Linear-Signature are left untouched."""
    original = json.dumps({"agentSession": {"creator": {"id": CREATOR_ID}}}).encode(
        "utf-8"
    )
    body = bytes(original)  # an independent object to compare against

    routing.extract_routing_key(body)

    assert body == original
