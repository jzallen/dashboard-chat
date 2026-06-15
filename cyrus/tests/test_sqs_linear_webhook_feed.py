"""Specification for SQSLinearWebhookFeed — the SQS read side of the webhook pump.

These tests describe how the feed turns SQS messages (enqueued upstream by the
Linear -> Lambda -> SQS pipe) into LinearWebhookMessage value objects, and how a
processed message is acknowledged so SQS does not redeliver it. Behavior covered:

- receive() returns pending webhooks with their raw body and Linear headers intact
- receive() returns nothing when the queue is empty
- receive() reports a handled error (empty messages + FeedError) when the client fails
- acknowledge() deletes the message from the queue by its receipt handle
- acknowledge() returns a handled FeedError when the client fails

Happy-path receive() is exercised with a botocore Stubber (real request/response
validation). The acknowledge() side-effect check and both failure-path checks use a
MagicMock to drive the outgoing call or raise a generic error. Neither touches AWS.

IF YOU'RE AN AGENT, READ THIS:
- These tests are the specification. Implement the feed to satisfy them; never
  weaken or rewrite an assertion to fit the implementation.
- Expected values are built from literals (see make_linear_webhook_message), not
  from the conftest fixtures that feed the input — so a test cannot pass by echoing
  its own input. Override only the field a test is about.
- Compare whole objects, and keep one assertion per test.
"""

from __future__ import annotations

import logging
from typing import Any
from unittest.mock import MagicMock

from proxy.messages import FeedErrorEnum, LinearWebhookMessage
from webhook_feeds.sqs_feed import SQSLinearWebhookFeed, _region_from_queue_url
from tests.conftest import QUEUE_URL


def make_linear_webhook_message(**overrides: Any) -> LinearWebhookMessage:
    """Build the representative LinearWebhookMessage; override fields as needed.

    ``raw`` is the representative SQS message the adapter sourced this from — the
    body and headers above are what it extracted for the HTTP replay, and the
    receipt handle the adapter needs to acknowledge lives only in ``raw``.
    """
    body = b'{"action": "create", "type": "Comment", "actor": {"id": "b5ea5f1f-8adc-4f52-b4bd-ab4e84cf51ba", "type": "user", "name": "Linear Orbit", "email": "orbit@linear.app", "url": "https://linear.app/company/profiles/orbit"}, "data": {"id": "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9", "createdAt": "2020-01-23T12:53:18.084Z", "body": "This is a comment on an issue", "issueId": "539068e2-ae88-4d09-bd75-22eb4a59612f"}, "url": "https://linear.app/issue/LIN-1778/title#comment-id", "organizationId": "dc844923-f9a4-40a3-825c-dea7747e57d6", "createdAt": "2020-01-23T12:53:18.084Z", "webhookTimestamp": 1676056940508, "webhookId": "000042e3-d123-4980-b49f-8e140eef9329"}'
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Linear-Event": "Comment",
        "Linear-Delivery": "e3c1b2a4-5d6f-4a7b-8c9d-0e1f2a3b4c5d",
        "Linear-Signature": "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
        "User-Agent": "Linear-Webhook",
    }
    raw = {
        "MessageId": "11111111-2222-3333-4444-555555555555",
        "ReceiptHandle": "AQEBRECEIPT-handle-for-the-representative-comment-message==",
        "Body": body.decode("utf-8"),
        "MessageAttributes": {
            name: {"DataType": "String", "StringValue": value}
            for name, value in headers.items()
        },
    }
    fields: dict[str, Any] = {"body": body, "headers": headers, "raw": raw}
    fields.update(overrides)
    return LinearWebhookMessage(**fields)


def test_receive_parses_pending_message_into_model_with_body_and_headers_intact(
    stubbed_sqs: Any,
    receive_response: dict[str, Any],
) -> None:
    client, stubber = stubbed_sqs
    stubber.add_response(
        "receive_message",
        receive_response,
        expected_params={
            "QueueUrl": QUEUE_URL,
            "MaxNumberOfMessages": 10,
            "MessageAttributeNames": ["All"],
            "WaitTimeSeconds": 20,
        },
    )
    feed = SQSLinearWebhookFeed(queue_url=QUEUE_URL, sqs_client=client)
    expected_message = make_linear_webhook_message()

    with stubber:
        result = feed.receive()

    assert result == {"messages": [expected_message], "error": None}


def test_receive_returns_nothing_on_empty_poll(
    stubbed_sqs: Any,
    empty_receive_response: dict[str, Any],
) -> None:
    client, stubber = stubbed_sqs
    stubber.add_response(
        "receive_message",
        empty_receive_response,
        expected_params={
            "QueueUrl": QUEUE_URL,
            "MaxNumberOfMessages": 10,
            "MessageAttributeNames": ["All"],
            "WaitTimeSeconds": 20,
        },
    )
    feed = SQSLinearWebhookFeed(queue_url=QUEUE_URL, sqs_client=client)

    with stubber:
        result = feed.receive()

    assert result == {"messages": [], "error": None}


def test_receive_reports_failed_feed_receive_when_the_client_raises() -> None:
    """A generic client failure becomes a handled envelope error, not a crash.

    We don't care about the wire structure of the failure here, only that
    receive() catches it and reports FAILED_FEED_RECEIVE with the underlying
    reason, so a MagicMock raising a generic error stands in for the client.
    """
    sqs_client = MagicMock()
    sqs_client.receive_message.side_effect = RuntimeError("sqs unavailable")
    feed = SQSLinearWebhookFeed(queue_url=QUEUE_URL, sqs_client=sqs_client)

    result = feed.receive()

    assert result == {
        "messages": [],
        "error": {"type": FeedErrorEnum.FAILED_FEED_RECEIVE, "reason": "sqs unavailable"},
    }


def test_receive_logs_a_traceback_when_the_client_raises(caplog: Any) -> None:
    """Failures are not silently swallowed — the traceback is logged at WARNING.

    The handled FeedError loses the stack; logging it with exc_info is what keeps
    the failure diagnosable.
    """
    sqs_client = MagicMock()
    sqs_client.receive_message.side_effect = RuntimeError("sqs unavailable")
    feed = SQSLinearWebhookFeed(queue_url=QUEUE_URL, sqs_client=sqs_client)

    with caplog.at_level(logging.WARNING):
        feed.receive()

    record = caplog.records[-1]
    assert record.levelno == logging.WARNING and record.exc_info is not None


def test_acknowledge_deletes_message_at_sqs_boundary_with_receipt_handle() -> None:
    """Happy-path side-effect check, not a wire-contract check.

    We assume the SQS delete succeeds and validate only the outgoing call —
    that acknowledge() asks the client to delete_message with the message's
    queue url and receipt handle. Normally we use Stubber for request/response validation,
    here we use MagicMock simply to ensure feed.acknowledge() calls the client correctly.
    """
    sqs_client = MagicMock()
    message = make_linear_webhook_message()
    feed = SQSLinearWebhookFeed(queue_url=QUEUE_URL, sqs_client=sqs_client)

    feed.acknowledge(message)

    sqs_client.delete_message.assert_called_once_with(
        QueueUrl=QUEUE_URL,
        ReceiptHandle=message["raw"]["ReceiptHandle"],
    )


def test_region_is_parsed_from_a_standard_sqs_queue_url() -> None:
    """The pump self-configures its region from the queue URL host, no env needed."""
    region = _region_from_queue_url(
        "https://sqs.eu-west-2.amazonaws.com/123456789012/my-queue"
    )

    assert region == "eu-west-2"


def test_region_is_none_for_a_non_aws_queue_url() -> None:
    """A non-AWS host yields no region, so boto3 falls back to its own resolution."""
    region = _region_from_queue_url("http://localhost:4566/000000000000/my-queue")

    assert region is None


def test_feed_without_an_injected_client_builds_one_in_the_queues_region() -> None:
    """When no client is injected, the feed creates one targeting the queue's region."""
    feed = SQSLinearWebhookFeed(
        queue_url="https://sqs.ap-southeast-2.amazonaws.com/123456789012/q"
    )

    assert feed._sqs_client.meta.region_name == "ap-southeast-2"


def test_acknowledge_reports_failed_message_acknowledge_when_the_client_raises() -> None:
    """A generic client failure during delete becomes a handled FeedError, not a
    crash, so the forwarder can react rather than abort the loop.
    """
    sqs_client = MagicMock()
    sqs_client.delete_message.side_effect = RuntimeError("sqs unavailable")
    feed = SQSLinearWebhookFeed(queue_url=QUEUE_URL, sqs_client=sqs_client)

    result = feed.acknowledge(make_linear_webhook_message())

    assert result == {
        "type": FeedErrorEnum.FAILED_MESSAGE_ACKNOWLEDGE,
        "reason": "sqs unavailable",
    }
