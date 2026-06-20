"""Specification for opaqueness-safe routing-key extraction.

The routing key is the **natural key — the Linear username** (e.g. ``testuser``),
not the surrogate ``agentSession.creator.id`` UUID. The webhook ``creator`` object
carries no ``displayName``/username field; the username appears only as the
trailing path segment of ``agentSession.creator.url``
(``https://linear.app/<org>/profiles/<username>``). When that url is absent,
empty, or unparseable the extractor returns the ``_unrouted`` sentinel so the
handler never drops an event. The load-bearing invariant is opaqueness:
extraction reads a COPY of the body and leaves the caller's bytes untouched.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. ``extract_routing_key``
reads the username WITHOUT mutating the input bytes. Do not weaken the
byte-identity assertion.
"""

from __future__ import annotations

import json

import routing


def _body(url: str) -> bytes:
    return json.dumps({"agentSession": {"creator": {"url": url}}}).encode("utf-8")


def test_extracts_username_from_creator_url_last_segment():
    body = _body("https://linear.app/example-org/profiles/testuser")
    assert routing.extract_routing_key(body) == "testuser"


def test_ignores_a_trailing_slash_on_the_creator_url():
    body = _body("https://linear.app/example-org/profiles/testuser/")
    assert routing.extract_routing_key(body) == "testuser"


def test_returns_unrouted_when_creator_url_is_absent():
    body = b'{"agentSession": {"creator": {"id": "00000000-0000"}}}'
    assert routing.extract_routing_key(body) == "_unrouted"


def test_returns_unrouted_when_creator_url_is_empty():
    body = _body("")
    assert routing.extract_routing_key(body) == "_unrouted"


def test_returns_unrouted_when_creator_url_has_no_path_segment():
    body = _body("https://linear.app")
    assert routing.extract_routing_key(body) == "_unrouted"


def test_returns_unrouted_when_url_is_not_a_profiles_url():
    """A different url shape must not route its trailing segment as a username."""
    body = _body("https://linear.app/some-org")
    assert routing.extract_routing_key(body) == "_unrouted"


def test_returns_unrouted_when_username_segment_is_missing():
    """A url ending at ``/profiles`` has no username — catch-all, not literal 'profiles'."""
    assert routing.extract_routing_key(_body("https://linear.app/org/profiles")) == (
        "_unrouted"
    )
    assert routing.extract_routing_key(_body("https://linear.app/org/profiles/")) == (
        "_unrouted"
    )


def test_percent_encoded_username_is_decoded():
    body = _body("https://linear.app/org/profiles/test%2Euser")
    assert routing.extract_routing_key(body) == "test.user"


def test_returns_unrouted_when_decoded_username_holds_unsafe_topic_chars():
    """A segment decoding to an MQTT wildcard must not widen routing — catch-all."""
    body = _body("https://linear.app/org/profiles/a%23b")
    assert routing.extract_routing_key(body) == "_unrouted"


def test_returns_unrouted_when_body_is_unparseable():
    assert routing.extract_routing_key(b"not json{{{") == "_unrouted"


def test_does_not_mutate_the_input_body_bytes():
    """Opaqueness: the bytes covered by Linear-Signature are left untouched."""
    original = _body("https://linear.app/example-org/profiles/testuser")
    body = bytes(original)  # an independent object to compare against

    routing.extract_routing_key(body)

    assert body == original


def test_extracts_creator_id_for_correlation():
    """The surrogate UUID is available as the stable correlation key."""
    body = b'{"agentSession": {"creator": {"id": "00000000-0000"}}}'
    assert routing.extract_creator_id(body) == "00000000-0000"


def test_creator_id_is_none_when_absent_or_unparseable():
    assert routing.extract_creator_id(b'{"agentSession": {"creator": {}}}') is None
    assert routing.extract_creator_id(b"not json{{{") is None
