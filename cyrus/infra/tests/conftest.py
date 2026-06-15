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


def sign(body: str) -> str:
    """Independent reference HMAC-SHA256 hex digest for ``body`` under ``SECRET``."""
    return hmac.new(SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()


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
