"""Shared fixtures for the ingress Lambda handler tests.

Models a Linear webhook arriving at a Lambda Function URL: header names are
delivered lowercased, the raw JSON body rides in ``body`` (base64 only when
binary), and the ``Linear-Signature`` is the hex HMAC-SHA256 of the raw body.
The signature here is produced by an INDEPENDENT stdlib oracle (not the handler)
so the tests pin the wire contract rather than mirror the implementation.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

import boto3
import pytest
from botocore.stub import Stubber

SECRET = "test-linear-secret"
QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/000000000000/cyrus-linear-webhooks"
IOT_ENDPOINT = "abc123-ats.iot.us-east-1.amazonaws.com"
TOPIC_PREFIX = "cyrus/v1/sessions/"
# The routing key is the natural key — the Linear username — read from the
# trailing segment of ``creator.url``. ``CREATOR_ID`` is the surrogate UUID the
# webhook also carries (kept for correlation), but it is NOT the routing key.
USERNAME = "zallen"
CREATOR_ID = "92f69e9d-cf2a-4475-9fbb-9a81b6512797"
CREATOR_URL = f"https://linear.app/tackle-chop-urgent/profiles/{USERNAME}"


def sign(body: str) -> str:
    """Independent reference HMAC-SHA256 hex digest for ``body`` under ``SECRET``."""
    return hmac.new(
        SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def headers_for(body: str) -> dict[str, str]:
    """Linear's lowercased Function URL headers, signed correctly for ``body``."""
    return {
        "content-type": "application/json; charset=utf-8",
        "linear-event": "AgentSessionEvent",
        "linear-delivery": "d-123",
        "linear-signature": sign(body),
        "user-agent": "Linear-Webhook",
    }


def make_function_url_event(
    body: str, headers: dict[str, str], *, is_base64: bool = False
) -> dict[str, Any]:
    """Build a Lambda Function URL (payload v2.0) event with lowercased headers."""
    return {
        "version": "2.0",
        "rawPath": "/",
        "headers": dict(headers),
        "body": body,
        "isBase64Encoded": is_base64,
        "requestContext": {"http": {"method": "POST"}},
    }


@pytest.fixture
def webhook_body() -> str:
    """The raw webhook body string exactly as Linear would POST it."""
    return json.dumps(
        {"type": "AgentSessionEvent", "action": "created", "organizationId": "org-1"}
    )


@pytest.fixture
def routable_body() -> str:
    """A webhook body whose ``creator.url`` routes to the username (``USERNAME``).

    Mirrors the confirmed webhook ``creator`` shape: ``email``/``id``/``name``/
    ``url`` with no username field, so the routing key must come from ``url``'s
    trailing segment.
    """
    return json.dumps(
        {
            "type": "AgentSessionEvent",
            "action": "created",
            "organizationId": "org-1",
            "agentSession": {
                "creator": {
                    "email": "tackle-chop-urgent@duck.com",
                    "id": CREATOR_ID,
                    "name": "Zach Allen",
                    "url": CREATOR_URL,
                }
            },
        }
    )


@pytest.fixture
def valid_signature(webhook_body: str) -> str:
    """A correct ``Linear-Signature`` for ``webhook_body`` (independent oracle)."""
    return sign(webhook_body)


@pytest.fixture
def linear_headers(valid_signature: str) -> dict[str, str]:
    """Linear's headers as a Function URL delivers them (names lowercased)."""
    return {
        "content-type": "application/json; charset=utf-8",
        "linear-event": "AgentSessionEvent",
        "linear-delivery": "d-123",
        "linear-signature": valid_signature,
        "user-agent": "Linear-Webhook",
    }


@pytest.fixture
def stubbed_sqs() -> Any:
    """A real boto3 SQS client with a botocore Stubber attached.

    Yields ``(client, stubber)``. Tests queue the expected ``send_message`` (with
    exact params) before activating; an activated stubber with no queued response
    raises on any call, which is how the rejection tests prove nothing is enqueued.
    """
    client = boto3.client(
        "sqs",
        region_name="us-east-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    stubber = Stubber(client)
    yield client, stubber
    stubber.deactivate()


@pytest.fixture
def stubbed_iot() -> Any:
    """A real boto3 IoT Data-plane client with a botocore Stubber attached.

    Yields ``(client, stubber)`` mirroring ``stubbed_sqs``. The dual-write tests
    queue the expected ``publish`` (exact topic + byte payload) before activating;
    an activated stubber with no queued response raises on any call, which is how
    the rejection tests prove nothing is published.
    """
    client = boto3.client(
        "iot-data",
        region_name="us-east-1",
        endpoint_url=f"https://{IOT_ENDPOINT}",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    stubber = Stubber(client)
    yield client, stubber
    stubber.deactivate()
