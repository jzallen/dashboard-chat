"""Shared fixtures for the cyrus-sqs-proxy feed tests.

Models the wire shape the upstream Lambda produces: the SQS message ``Body``
is the raw Linear webhook JSON string, and the Linear HTTP headers ride in
``MessageAttributes`` as ``StringValue`` entries. One representative message
(a ``Comment`` create event) plus the canned ``receive_message`` responses the
Stubber returns.
"""

from __future__ import annotations

import json
from typing import Any

import boto3
import pytest
from botocore.stub import Stubber

QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/000000000000/cyrus-linear-webhooks"


@pytest.fixture
def linear_payload() -> dict[str, Any]:
    """A representative Linear webhook payload (a Comment create event)."""
    return {
        "action": "create",
        "type": "Comment",
        "actor": {
            "id": "b5ea5f1f-8adc-4f52-b4bd-ab4e84cf51ba",
            "type": "user",
            "name": "Linear Orbit",
            "email": "orbit@linear.app",
            "url": "https://linear.app/company/profiles/orbit",
        },
        "data": {
            "id": "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
            "createdAt": "2020-01-23T12:53:18.084Z",
            "body": "This is a comment on an issue",
            "issueId": "539068e2-ae88-4d09-bd75-22eb4a59612f",
        },
        "url": "https://linear.app/issue/LIN-1778/title#comment-id",
        "organizationId": "dc844923-f9a4-40a3-825c-dea7747e57d6",
        "createdAt": "2020-01-23T12:53:18.084Z",
        "webhookTimestamp": 1676056940508,
        "webhookId": "000042e3-d123-4980-b49f-8e140eef9329",
    }


@pytest.fixture
def linear_body(linear_payload: dict[str, Any]) -> str:
    """The raw webhook body as a JSON string (what Linear POSTed verbatim)."""
    return json.dumps(linear_payload)


@pytest.fixture
def linear_headers() -> dict[str, str]:
    """The Linear HTTP headers needed to reconstruct the original request."""
    return {
        "Content-Type": "application/json; charset=utf-8",
        "Linear-Event": "Comment",
        "Linear-Delivery": "e3c1b2a4-5d6f-4a7b-8c9d-0e1f2a3b4c5d",
        "Linear-Signature": (
            "a1b2c3d4e5f60718293a4b5c6d7e8f90"
            "112233445566778899aabbccddeeff00"
        ),
        "User-Agent": "Linear-Webhook",
    }


@pytest.fixture
def receipt_handle() -> str:
    """The SQS receipt handle used to acknowledge (delete) the message."""
    return "AQEBRECEIPT-handle-for-the-representative-comment-message=="


@pytest.fixture
def message_id() -> str:
    """The SQS message id of the representative message."""
    return "11111111-2222-3333-4444-555555555555"


def _to_message_attributes(headers: dict[str, str]) -> dict[str, Any]:
    """Render the Linear headers as SQS MessageAttributes (StringValue each)."""
    return {
        name: {"DataType": "String", "StringValue": value}
        for name, value in headers.items()
    }


@pytest.fixture
def receive_response(
    linear_body: str,
    linear_headers: dict[str, str],
    receipt_handle: str,
    message_id: str,
) -> dict[str, Any]:
    """A fully-formed SQS ``receive_message`` response with ONE message."""
    return {
        "Messages": [
            {
                "MessageId": message_id,
                "ReceiptHandle": receipt_handle,
                "Body": linear_body,
                "MessageAttributes": _to_message_attributes(linear_headers),
            }
        ]
    }


@pytest.fixture
def empty_receive_response() -> dict[str, Any]:
    """An empty-poll SQS ``receive_message`` response (no Messages key)."""
    return {}


@pytest.fixture
def stubbed_sqs() -> Any:
    """A real boto3 SQS client with a botocore Stubber attached.

    Yields ``(client, stubber)``. The test queues canned responses on the
    stubber, then activates it. ``stubber.assert_no_pending_responses()`` at
    teardown confirms every queued response was consumed.
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
