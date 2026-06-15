"""Specification for the dual-write ingress: IoT publish beside the SQS enqueue.

These pin DC-21's behavior at the ``process`` boundary: a verified webhook is
published byte-identically to the per-identity IoT topic ``cyrus/v1/sessions/{key}``
AND enqueued to SQS, with an ``_unrouted`` catch-all and a transient-failure
safety net. Both wire contracts are pinned by botocore Stubbers — the IoT
``publish`` payload and topic, and the SQS ``send_message`` body and attributes.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec, and right now they are RED
by design — ``routing.extract_routing_key`` and ``iot_publisher.publish`` are
scaffolds that raise ``AssertionError("Not yet implemented — RED scaffold")``.
DC-31/DC-32/DC-34 turn them green. Do NOT weaken these assertions (especially the
byte-identity ones) or hand the Stubbers stray responses to mask the scaffold.
"""

from __future__ import annotations

from conftest import (
    CREATOR_ID,
    QUEUE_URL,
    SECRET,
    TOPIC_PREFIX,
    headers_for,
    make_function_url_event,
)

from handler import process


def _sqs_params(body: str, headers: dict) -> dict:
    return {
        "QueueUrl": QUEUE_URL,
        "MessageBody": body,
        "MessageAttributes": {
            "Content-Type": {
                "DataType": "String",
                "StringValue": headers["content-type"],
            },
            "Linear-Event": {
                "DataType": "String",
                "StringValue": headers["linear-event"],
            },
            "Linear-Delivery": {
                "DataType": "String",
                "StringValue": headers["linear-delivery"],
            },
            "Linear-Signature": {
                "DataType": "String",
                "StringValue": headers["linear-signature"],
            },
            "User-Agent": {"DataType": "String", "StringValue": headers["user-agent"]},
        },
    }


def test_valid_webhook_publishes_byte_identical_body_to_keyed_topic_and_enqueues(
    routable_body, stubbed_sqs, stubbed_iot
):
    """AC1: valid sig → IoT publish to cyrus/v1/sessions/{key} + SQS enqueue → 200."""
    sqs, sqs_stub = stubbed_sqs
    iot, iot_stub = stubbed_iot
    headers = headers_for(routable_body)

    iot_stub.add_response(
        "publish",
        {},
        {
            "topic": f"{TOPIC_PREFIX}{CREATOR_ID}",
            "payload": routable_body.encode("utf-8"),
        },
    )
    sqs_stub.add_response(
        "send_message",
        {"MD5OfMessageBody": "x", "MessageId": "m-1"},
        _sqs_params(routable_body, headers),
    )
    iot_stub.activate()
    sqs_stub.activate()

    event = make_function_url_event(routable_body, headers)
    result = process(
        event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=sqs, iot_data_client=iot
    )

    iot_stub.assert_no_pending_responses()
    sqs_stub.assert_no_pending_responses()
    assert result == {"statusCode": 200, "body": "queued"}


def test_published_and_enqueued_bytes_are_identical_to_the_received_body(
    routable_body, stubbed_sqs, stubbed_iot
):
    """AC2: routing reads a COPY; what is published/enqueued is byte-identical input."""
    sqs, sqs_stub = stubbed_sqs
    iot, iot_stub = stubbed_iot
    headers = headers_for(routable_body)

    published: dict = {}
    enqueued: dict = {}

    def _capture_publish(params, **_):
        published["payload"] = params["payload"]
        return {}

    def _capture_send(params, **_):
        enqueued["body"] = params["MessageBody"]
        return {"MD5OfMessageBody": "x", "MessageId": "m-1"}

    iot_stub.add_response("publish", _capture_publish)
    sqs_stub.add_response("send_message", _capture_send)
    iot_stub.activate()
    sqs_stub.activate()

    event = make_function_url_event(routable_body, headers)
    process(
        event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=sqs, iot_data_client=iot
    )

    # Byte-identity: the IoT payload and the SQS body are the exact bytes Linear
    # signed — extraction never mutated them.
    assert published["payload"] == routable_body.encode("utf-8")
    assert enqueued["body"] == routable_body


def test_invalid_signature_neither_publishes_nor_enqueues(
    routable_body, stubbed_sqs, stubbed_iot
):
    """AC3: bad sig → 401, no IoT publish, no SQS enqueue (both stubbers stay armed)."""
    sqs, sqs_stub = stubbed_sqs
    iot, iot_stub = stubbed_iot
    sqs_stub.activate()  # no response queued: any call raises
    iot_stub.activate()

    tampered = {**headers_for(routable_body), "linear-signature": "00" * 32}
    event = make_function_url_event(routable_body, tampered)
    result = process(
        event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=sqs, iot_data_client=iot
    )

    assert result == {"statusCode": 401, "body": "invalid signature"}


def test_missing_creator_id_publishes_to_unrouted_and_still_enqueues(
    webhook_body, stubbed_sqs, stubbed_iot
):
    """AC4: absent agentSession.creator.id → publish to _unrouted catch-all + enqueue."""
    sqs, sqs_stub = stubbed_sqs
    iot, iot_stub = stubbed_iot
    headers = headers_for(webhook_body)  # webhook_body has no agentSession.creator

    iot_stub.add_response(
        "publish",
        {},
        {"topic": f"{TOPIC_PREFIX}_unrouted", "payload": webhook_body.encode("utf-8")},
    )
    sqs_stub.add_response(
        "send_message",
        {"MD5OfMessageBody": "x", "MessageId": "m-1"},
        _sqs_params(webhook_body, headers),
    )
    iot_stub.activate()
    sqs_stub.activate()

    event = make_function_url_event(webhook_body, headers)
    result = process(
        event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=sqs, iot_data_client=iot
    )

    iot_stub.assert_no_pending_responses()
    sqs_stub.assert_no_pending_responses()
    assert result == {"statusCode": 200, "body": "queued"}


def test_transient_iot_failure_still_enqueues_sqs_and_returns_200(
    routable_body, stubbed_sqs, stubbed_iot
):
    """AC5: IoT publish errors transiently → SQS enqueue still succeeds, 200 returned."""
    sqs, sqs_stub = stubbed_sqs
    iot, iot_stub = stubbed_iot
    headers = headers_for(routable_body)

    iot_stub.add_client_error("publish", service_error_code="ThrottlingException")
    sqs_stub.add_response(
        "send_message",
        {"MD5OfMessageBody": "x", "MessageId": "m-1"},
        _sqs_params(routable_body, headers),
    )
    iot_stub.activate()
    sqs_stub.activate()

    event = make_function_url_event(routable_body, headers)
    result = process(
        event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=sqs, iot_data_client=iot
    )

    # The dual-write safety net: a failed IoT leg must not lose the SQS write.
    sqs_stub.assert_no_pending_responses()
    assert result == {"statusCode": 200, "body": "queued"}
