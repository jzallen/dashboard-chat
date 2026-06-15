"""Specification for CanaryLinearWebhookFeed — the AWS-free synthetic feed.

These tests describe how the canary feed exercises the pump without an SQS
connection: it emits a hard-coded Linear webhook once, then idles by sleeping so
the run loop does not busy-spin, and treats acknowledge as a no-op (there is no
queue to delete from). Behavior covered:

- receive() emits the synthetic canary message on the first poll
- receive() idles (sleeps the configured interval) and returns nothing once drained
- acknowledge() is a no-op returning None
- the canary body carries a valid Linear-Signature when a signing secret is given

The idle path is exercised with an injected ``sleep`` MagicMock so the test never
waits in real time, and the assertion confirms the idle interval was slept.

IF YOU'RE AN AGENT, READ THIS:
- These tests are the specification. Implement the feed to satisfy them; never
  weaken or rewrite an assertion to fit the implementation.
- ``sleep`` is injected as a MagicMock everywhere — do NOT use real idle waiting.
- The signature expectation is recomputed from the literal secret, not echoed from
  the implementation, so the test cannot pass by mirroring the code.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from unittest.mock import MagicMock

from webhook_feeds.canary_feed import CanaryIdentity, CanaryLinearWebhookFeed


def test_receive_emits_the_canary_message_on_first_poll() -> None:
    feed = CanaryLinearWebhookFeed(sleep=MagicMock())

    result = feed.receive()

    assert result["error"] is None and len(result["messages"]) == 1


def test_receive_idles_and_returns_nothing_after_draining() -> None:
    sleep = MagicMock()
    feed = CanaryLinearWebhookFeed(sleep=sleep)
    feed.receive()

    result = feed.receive()

    assert result == {"messages": [], "error": None}
    sleep.assert_called_once_with(20)


def test_acknowledge_is_a_noop_returning_none() -> None:
    feed = CanaryLinearWebhookFeed(sleep=MagicMock())

    assert feed.acknowledge({"raw": {"source": "canary"}}) is None


def test_canary_message_is_signed_when_a_secret_is_given() -> None:
    feed = CanaryLinearWebhookFeed(signing_secret="shh", sleep=MagicMock())

    message = feed.receive()["messages"][0]

    expected = hmac.new(b"shh", message["body"], hashlib.sha256).hexdigest()
    assert message["headers"]["Linear-Signature"] == expected


def test_identity_defaults_to_placeholders_when_no_env_is_set() -> None:
    """No CYRUS_PROXY_CANARY_* env -> safe placeholder identity (nothing real to commit)."""
    identity = CanaryIdentity.from_env(env={})

    assert identity == CanaryIdentity()


def test_identity_reads_overrides_from_env() -> None:
    env = {
        "CYRUS_PROXY_CANARY_ORG_ID": "org-9",
        "CYRUS_PROXY_CANARY_ISSUE_ID": "issue-9",
        "CYRUS_PROXY_CANARY_ISSUE_IDENTIFIER": "DC-9",
    }

    identity = CanaryIdentity.from_env(env=env)

    assert identity == CanaryIdentity(
        organization_id="org-9", issue_id="issue-9", issue_identifier="DC-9"
    )


def test_canary_body_is_an_agent_session_event_for_the_identity_issue() -> None:
    feed = CanaryLinearWebhookFeed(
        identity=CanaryIdentity(issue_id="issue-42", issue_identifier="DC-42"),
        sleep=MagicMock(),
    )

    body = json.loads(feed.receive()["messages"][0]["body"])

    assert body["agentSession"]["issue"] == {
        "id": "issue-42",
        "identifier": "DC-42",
        "team": {"key": "CANARY"},
    }
