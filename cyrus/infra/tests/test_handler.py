"""Specification for the ingress Lambda handler's verify-and-enqueue core.

The handler's job: HMAC-verify a Linear webhook arriving at the Function URL and,
only when valid, enqueue the raw body plus the headers Cyrus needs onto SQS. The
``send_message`` wire contract (body + MessageAttributes) is pinned by the
botocore Stubber's expected params; the enqueue tests then assert the HTTP-shaped
result.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. The enqueue tests pin the
``send_message`` wire contract with the Stubber; the rejection tests inject a
``MagicMock`` client and assert it is never called, proving an unverified webhook
enqueues nothing. Don't weaken either check.
"""

from __future__ import annotations

import base64
from unittest.mock import MagicMock

from conftest import (
    QUEUE_URL,
    SECRET,
    StubPresence,
    make_env,
    make_function_url_event,
)

from handler import handler, process


def _attrs(
    content_type: str, event: str, delivery: str, signature: str, agent: str
) -> dict:
    return {
        "content-type": {"DataType": "String", "StringValue": content_type},
        "linear-event": {"DataType": "String", "StringValue": event},
        "linear-delivery": {"DataType": "String", "StringValue": delivery},
        "linear-signature": {"DataType": "String", "StringValue": signature},
        "user-agent": {"DataType": "String", "StringValue": agent},
    }


def test_process_enqueues_a_validly_signed_webhook(
    webhook_body, linear_headers, stubbed_sqs
):
    client, stubber = stubbed_sqs
    expected_params = {
        "QueueUrl": QUEUE_URL,
        "MessageBody": webhook_body,
        "MessageAttributes": _attrs(
            "application/json; charset=utf-8",
            "AgentSessionEvent",
            "d-123",
            linear_headers["linear-signature"],
            "Linear-Webhook",
        ),
    }
    stubber.add_response(
        "send_message", {"MD5OfMessageBody": "x", "MessageId": "m-1"}, expected_params
    )
    stubber.activate()

    event = make_function_url_event(webhook_body, linear_headers)
    result = process(
        event,
        make_env(),
        sqs_client=lambda: client,
        iot_client=lambda: None,
        presence=lambda: StubPresence(),
    )

    stubber.assert_no_pending_responses()
    assert result == {"statusCode": 200, "body": "queued"}


def test_process_rejects_a_webhook_with_an_invalid_signature(
    webhook_body, linear_headers
):
    client = MagicMock()

    tampered = {**linear_headers, "linear-signature": "00" * 32}
    event = make_function_url_event(webhook_body, tampered)
    result = process(
        event,
        make_env(),
        sqs_client=lambda: client,
        iot_client=lambda: None,
        presence=lambda: StubPresence(),
    )

    client.send_message.assert_not_called()
    assert result == {"statusCode": 401, "body": "invalid signature"}


def test_process_rejects_a_webhook_with_no_signature(webhook_body, linear_headers):
    client = MagicMock()

    unsigned = {k: v for k, v in linear_headers.items() if k != "linear-signature"}
    event = make_function_url_event(webhook_body, unsigned)
    result = process(
        event,
        make_env(),
        sqs_client=lambda: client,
        iot_client=lambda: None,
        presence=lambda: StubPresence(),
    )

    client.send_message.assert_not_called()
    assert result == {"statusCode": 401, "body": "missing signature"}


def test_process_decodes_a_base64_encoded_body_before_verifying_and_enqueuing(
    webhook_body, linear_headers, stubbed_sqs
):
    client, stubber = stubbed_sqs
    expected_params = {
        "QueueUrl": QUEUE_URL,
        "MessageBody": webhook_body,
        "MessageAttributes": _attrs(
            "application/json; charset=utf-8",
            "AgentSessionEvent",
            "d-123",
            linear_headers["linear-signature"],
            "Linear-Webhook",
        ),
    }
    stubber.add_response(
        "send_message", {"MD5OfMessageBody": "x", "MessageId": "m-1"}, expected_params
    )
    stubber.activate()

    encoded = base64.b64encode(webhook_body.encode("utf-8")).decode("ascii")
    event = make_function_url_event(encoded, linear_headers, is_base64=True)
    result = process(
        event,
        make_env(),
        sqs_client=lambda: client,
        iot_client=lambda: None,
        presence=lambda: StubPresence(),
    )

    stubber.assert_no_pending_responses()
    assert result == {"statusCode": 200, "body": "queued"}


def test_handler_wires_env_secret_and_client_then_delegates(
    monkeypatch, webhook_body, linear_headers, stubbed_sqs
):
    client, stubber = stubbed_sqs
    expected_params = {
        "QueueUrl": QUEUE_URL,
        "MessageBody": webhook_body,
        "MessageAttributes": _attrs(
            "application/json; charset=utf-8",
            "AgentSessionEvent",
            "d-123",
            linear_headers["linear-signature"],
            "Linear-Webhook",
        ),
    }
    stubber.add_response(
        "send_message", {"MD5OfMessageBody": "x", "MessageId": "m-1"}, expected_params
    )
    stubber.activate()

    import handler as handler_mod

    monkeypatch.setenv("QUEUE_URL", QUEUE_URL)
    monkeypatch.setattr(handler_mod, "_load_secret", lambda: SECRET)
    monkeypatch.setattr(handler_mod, "_sqs_client", lambda env: client)

    event = make_function_url_event(webhook_body, linear_headers)
    result = handler(event, None)

    stubber.assert_no_pending_responses()
    assert result == {"statusCode": 200, "body": "queued"}
