"""Specification for the ingress Lambda handler's verify-and-enqueue core.

The handler's job: HMAC-verify a Linear webhook arriving at the Function URL and,
only when valid, enqueue the raw body plus the headers Cyrus needs onto SQS. The
``send_message`` wire contract (body + MessageAttributes) is pinned by the
botocore Stubber's expected params; each test then asserts the HTTP-shaped result.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. The rejection tests
activate the Stubber with NO queued response on purpose — any SQS call then raises
— so they prove an unverified webhook enqueues nothing. Don't weaken that by
giving the Stubber a stray response.
"""

from __future__ import annotations

import base64

from conftest import QUEUE_URL, SECRET, make_function_url_event

from handler import handler, process


def _attrs(content_type: str, event: str, delivery: str, signature: str, agent: str) -> dict:
    return {
        "Content-Type": {"DataType": "String", "StringValue": content_type},
        "Linear-Event": {"DataType": "String", "StringValue": event},
        "Linear-Delivery": {"DataType": "String", "StringValue": delivery},
        "Linear-Signature": {"DataType": "String", "StringValue": signature},
        "User-Agent": {"DataType": "String", "StringValue": agent},
    }


def test_process_enqueues_a_validly_signed_webhook(webhook_body, linear_headers, stubbed_sqs):
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
    stubber.add_response("send_message", {"MD5OfMessageBody": "x", "MessageId": "m-1"}, expected_params)
    stubber.activate()

    event = make_function_url_event(webhook_body, linear_headers)
    result = process(event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=client)

    stubber.assert_no_pending_responses()
    assert result == {"statusCode": 200, "body": "queued"}


def test_process_rejects_a_webhook_with_an_invalid_signature(webhook_body, linear_headers, stubbed_sqs):
    client, stubber = stubbed_sqs
    stubber.activate()  # no response queued: any SQS call raises

    tampered = {**linear_headers, "linear-signature": "00" * 32}
    event = make_function_url_event(webhook_body, tampered)
    result = process(event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=client)

    assert result == {"statusCode": 401, "body": "invalid signature"}


def test_process_rejects_a_webhook_with_no_signature(webhook_body, linear_headers, stubbed_sqs):
    client, stubber = stubbed_sqs
    stubber.activate()  # no response queued: any SQS call raises

    unsigned = {k: v for k, v in linear_headers.items() if k != "linear-signature"}
    event = make_function_url_event(webhook_body, unsigned)
    result = process(event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=client)

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
    stubber.add_response("send_message", {"MD5OfMessageBody": "x", "MessageId": "m-1"}, expected_params)
    stubber.activate()

    encoded = base64.b64encode(webhook_body.encode("utf-8")).decode("ascii")
    event = make_function_url_event(encoded, linear_headers, is_base64=True)
    result = process(event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=client)

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
    stubber.add_response("send_message", {"MD5OfMessageBody": "x", "MessageId": "m-1"}, expected_params)
    stubber.activate()

    import handler as handler_mod

    monkeypatch.setenv("QUEUE_URL", QUEUE_URL)
    monkeypatch.setattr(handler_mod, "_load_secret", lambda: SECRET)
    monkeypatch.setattr(handler_mod, "_sqs_client", lambda: client)

    event = make_function_url_event(webhook_body, linear_headers)
    result = handler(event, None)

    stubber.assert_no_pending_responses()
    assert result == {"statusCode": 200, "body": "queued"}
