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


def test_extract_routing_key__creator_url_with_profiles_segment__returns_username():
    body = _body("https://linear.app/example-org/profiles/testuser")
    assert routing.extract_routing_key(body) == "testuser"


def test_extract_routing_key__creator_url_has_trailing_slash__returns_username():
    body = _body("https://linear.app/example-org/profiles/testuser/")
    assert routing.extract_routing_key(body) == "testuser"


def test_extract_routing_key__creator_url_absent__returns_unrouted():
    body = b'{"agentSession": {"creator": {"id": "00000000-0000"}}}'
    assert routing.extract_routing_key(body) == "_unrouted"


def test_extract_routing_key__creator_url_empty__returns_unrouted():
    body = _body("")
    assert routing.extract_routing_key(body) == "_unrouted"


def test_extract_routing_key__creator_url_has_no_path_segment__returns_unrouted():
    body = _body("https://linear.app")
    assert routing.extract_routing_key(body) == "_unrouted"


def test_extract_routing_key__url_is_not_a_profiles_url__returns_unrouted():
    """A different url shape must not route its trailing segment as a username."""
    body = _body("https://linear.app/some-org")
    assert routing.extract_routing_key(body) == "_unrouted"


def test_extract_routing_key__username_segment_missing__returns_unrouted():
    """A url ending at ``/profiles`` has no username — catch-all, not literal 'profiles'."""
    assert routing.extract_routing_key(_body("https://linear.app/org/profiles")) == (
        "_unrouted"
    )
    assert routing.extract_routing_key(_body("https://linear.app/org/profiles/")) == (
        "_unrouted"
    )


def test_extract_routing_key__percent_encoded_username__returns_decoded_username():
    body = _body("https://linear.app/org/profiles/test%2Euser")
    assert routing.extract_routing_key(body) == "test.user"


def test_extract_routing_key__decoded_username_has_unsafe_topic_chars__returns_unrouted():
    """A segment decoding to an MQTT wildcard must not widen routing — catch-all."""
    body = _body("https://linear.app/org/profiles/a%23b")
    assert routing.extract_routing_key(body) == "_unrouted"


def test_extract_routing_key__body_unparseable__returns_unrouted():
    assert routing.extract_routing_key(b"not json{{{") == "_unrouted"


def test_extract_routing_key__any_body__does_not_mutate_input_bytes():
    """Opaqueness: the bytes covered by Linear-Signature are left untouched."""
    original = _body("https://linear.app/example-org/profiles/testuser")
    body = bytes(original)  # an independent object to compare against

    routing.extract_routing_key(body)

    assert body == original


def test_extract_creator_id__creator_id_present__returns_creator_id():
    """The surrogate UUID is available as the stable correlation key."""
    body = b'{"agentSession": {"creator": {"id": "00000000-0000"}}}'
    assert routing.extract_creator_id(body) == "00000000-0000"


def test_extract_creator_id__absent_or_unparseable__returns_none():
    assert routing.extract_creator_id(b'{"agentSession": {"creator": {}}}') is None
    assert routing.extract_creator_id(b"not json{{{") is None
