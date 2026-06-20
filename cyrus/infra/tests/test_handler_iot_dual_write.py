"""Specification for the dual-write ingress: IoT publish beside the SQS enqueue.

These pin the behavior at the ``process`` boundary: a verified webhook is
published byte-identically to the per-identity IoT topic ``cyrus/v1/sessions/{key}``
AND enqueued to SQS, with an ``_unrouted`` catch-all and a transient-failure
safety net.

``publish`` and ``send_message`` are fire-and-forget side-effects whose return
value the handler ignores, so the happy-path tests assert the call arguments
directly with ``MagicMock`` — the topic + payload bytes and the SQS body +
attributes are stated in the assertion rather than buried in a Stubber's
``expected_params``. The real botocore wire contract (request serialization /
parameter validation) is left to the Stubber-based ``_unrouted`` and
transient-failure tests below, which exercise the same two calls.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. Do not weaken these
assertions — especially the byte-identity ones — or relax a wire contract.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from conftest import (
    QUEUE_URL,
    SECRET,
    TOPIC_PREFIX,
    USERNAME,
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


def test_process__dual_write_valid_webhook__publishes_byte_identical_to_keyed_topic_and_enqueues(
    routable_body,
):
    """Valid sig → IoT publish to cyrus/v1/sessions/{key} + SQS enqueue → 200.

    Asserts the publish and enqueue call arguments directly. MagicMock clients
    accept any call, so botocore's request validation for these two operations is
    covered by the Stubber-based ``_unrouted`` and transient-failure tests.
    """
    headers = headers_for(routable_body)
    iot = MagicMock()
    sqs = MagicMock()

    event = make_function_url_event(routable_body, headers)
    result = process(
        event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=sqs, iot_data_client=iot
    )

    iot.publish.assert_called_once_with(
        topic=f"{TOPIC_PREFIX}{USERNAME}",
        payload=routable_body.encode("utf-8"),
    )
    sqs.send_message.assert_called_once_with(**_sqs_params(routable_body, headers))
    assert result == {"statusCode": 200, "body": "queued"}


def test_process__dual_write_valid_webhook__published_and_enqueued_bytes_match_received_body(
    routable_body,
):
    """Routing reads a COPY; both legs carry the exact bytes Linear signed.

    Cross-checks that the IoT payload and the SQS body are byte-identical to each
    other and to the received body — the opaqueness invariant — by reading the
    captured call arguments off the MagicMock clients.
    """
    headers = headers_for(routable_body)
    iot = MagicMock()
    sqs = MagicMock()

    event = make_function_url_event(routable_body, headers)
    process(
        event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=sqs, iot_data_client=iot
    )

    published_payload = iot.publish.call_args.kwargs["payload"]
    enqueued_body = sqs.send_message.call_args.kwargs["MessageBody"]
    assert (
        published_payload
        == enqueued_body.encode("utf-8")
        == routable_body.encode("utf-8")
    )


def test_process__invalid_signature__returns_401_and_neither_publishes_nor_enqueues(routable_body):
    """Bad sig → 401, and neither client is called."""
    iot = MagicMock()
    sqs = MagicMock()

    tampered = {**headers_for(routable_body), "linear-signature": "00" * 32}
    event = make_function_url_event(routable_body, tampered)
    result = process(
        event, queue_url=QUEUE_URL, secret=SECRET, sqs_client=sqs, iot_data_client=iot
    )

    iot.publish.assert_not_called()
    sqs.send_message.assert_not_called()
    assert result == {"statusCode": 401, "body": "invalid signature"}


def test_process__dual_write_unrouted_body__publishes_to_unrouted_and_enqueues(
    webhook_body, stubbed_sqs, stubbed_iot
):
    """Absent agentSession.creator.id → publish to _unrouted catch-all + enqueue."""
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


def test_process__dual_write_transient_iot_failure__still_enqueues_and_returns_200(
    routable_body, stubbed_sqs, stubbed_iot
):
    """IoT publish errors transiently → SQS enqueue still succeeds, 200 returned."""
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
