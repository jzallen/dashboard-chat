"""Specification for CyrusHTTPForwarder — the HTTP replay to Cyrus.

CyrusHTTPForwarder.forward replays a Linear webhook (already fetched from a feed) to
Cyrus's local ``/webhook`` endpoint, so the request Cyrus sees is indistinguishable
from Linear calling it directly. The forwarder is configured once with Cyrus's
base URL and owns the ``/webhook`` path. Behavior covered:

- forward() POSTs the message's raw body and Linear headers to ``base_url/linear-webhook``
- forward() returns a ForwardError (it does not raise) when the replay fails

The HTTP client is injected as a MagicMock standing in for ``requests``, so no
network call is made.

IF YOU'RE AN AGENT, READ THIS:
- These tests are the specification. Implement the forwarder to satisfy them; never
  weaken or rewrite an assertion to fit the implementation.
- Forwarding is fire-and-forget: assert the outgoing call, and on failure expect a
  returned ForwardError ({type, reason}) rather than a raised exception.
"""

from __future__ import annotations

import logging
from typing import Any
from unittest.mock import MagicMock

import requests

from proxy.http_forwarder import CyrusHTTPForwarder
from proxy.messages import ForwardErrorEnum, LinearWebhookMessage

CYRUS_BASE_URL = "http://localhost:3456"
CYRUS_WEBHOOK_URL = "http://localhost:3456/linear-webhook"
DEFAULT_FORWARD_TIMEOUT = 30.0


def a_linear_webhook_message() -> LinearWebhookMessage:
    """A minimal message to replay; ``raw`` is irrelevant to forwarding."""
    return {
        "body": b'{"action": "create", "type": "Comment"}',
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Linear-Signature": "a1b2c3d4e5f6",
        },
        "raw": {},
    }


def test_forward_posts_body_and_headers_to_the_cyrus_webhook_url() -> None:
    request_client = MagicMock()
    message = a_linear_webhook_message()
    forwarder = CyrusHTTPForwarder(base_url=CYRUS_BASE_URL, request_client=request_client)

    forwarder.forward(message)

    request_client.post.assert_called_once_with(
        CYRUS_WEBHOOK_URL,
        data=message["body"],
        headers=message["headers"],
        timeout=DEFAULT_FORWARD_TIMEOUT,
    )


def test_forward_passes_the_configured_request_timeout() -> None:
    """A slow/processing Cyrus must not hang the pump, so the POST carries a timeout."""
    request_client = MagicMock()
    message = a_linear_webhook_message()
    forwarder = CyrusHTTPForwarder(
        base_url=CYRUS_BASE_URL, request_client=request_client, timeout=5.0
    )

    forwarder.forward(message)

    request_client.post.assert_called_once_with(
        CYRUS_WEBHOOK_URL,
        data=message["body"],
        headers=message["headers"],
        timeout=5.0,
    )


def test_forward_returns_error_when_cyrus_returns_an_error_status() -> None:
    request_client = MagicMock()
    request_client.post.return_value.raise_for_status.side_effect = requests.HTTPError(
        "502 Bad Gateway"
    )
    forwarder = CyrusHTTPForwarder(base_url=CYRUS_BASE_URL, request_client=request_client)

    result = forwarder.forward(a_linear_webhook_message())

    assert result == {
        "type": ForwardErrorEnum.FAILED_FORWARD_REQUEST,
        "reason": "502 Bad Gateway",
    }


def test_forward_logs_a_traceback_when_the_replay_fails(caplog: Any) -> None:
    """A failed replay is logged at WARNING with its traceback, not just returned.

    The handled ForwardError drops the stack; logging it with exc_info keeps the
    failure diagnosable.
    """
    request_client = MagicMock()
    request_client.post.return_value.raise_for_status.side_effect = requests.HTTPError(
        "502 Bad Gateway"
    )
    forwarder = CyrusHTTPForwarder(base_url=CYRUS_BASE_URL, request_client=request_client)

    with caplog.at_level(logging.WARNING):
        forwarder.forward(a_linear_webhook_message())

    record = caplog.records[-1]
    assert record.levelno == logging.WARNING and record.exc_info is not None
