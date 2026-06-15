"""SQS-backed feed adapter for Linear webhook events.

Reads the webhook events an upstream Lambda enqueued on SQS and exposes them
through the feed contract the HTTP-forwarder consumes. Carries no runtime
dependency on the proxy core: it returns plain dicts conforming to the boundary
TypedDicts, which are imported under ``TYPE_CHECKING`` only.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import urlsplit

import boto3

if TYPE_CHECKING:
    from proxy.messages import FeedError, LinearWebhookMessage, WebhookFeedEnvelope

logger = logging.getLogger(__name__)


def _region_from_queue_url(queue_url: str) -> Optional[str]:
    """Parse the AWS region from an SQS queue URL host (``sqs.<region>.amazonaws.com``).

    Lets the feed self-configure its region from the queue URL alone, so the pump
    needs no ``AWS_REGION`` in the environment. Returns ``None`` for hosts that
    aren't standard AWS SQS endpoints (e.g. LocalStack), leaving region resolution
    to boto3's normal chain.
    """
    host = urlsplit(queue_url).hostname or ""
    parts = host.split(".")
    if len(parts) >= 4 and parts[0].startswith("sqs") and parts[-2:] == ["amazonaws", "com"]:
        return parts[1]
    return None


class SQSLinearWebhookFeed:
    """SQS-backed implementation of ``LinearWebhookFeedProtocol`` (structural).

    Reads Linear webhook events that an upstream Lambda enqueued, where the SQS
    message ``Body`` holds the raw webhook JSON and the Linear HTTP headers ride
    along in ``MessageAttributes`` (each as a ``StringValue``).

    Satisfies ``proxy.execution_loop.LinearWebhookFeedProtocol`` structurally
    (duck-typed Protocol) — it does not import or subclass the port.

    Batch size is fixed at construction (``max_messages``) so callers invoke
    ``receive()`` with no arguments, keeping the port transport-agnostic. Polling
    uses SQS long-poll: ``receive()`` asks the queue to wait up to ``wait_seconds``
    for arrivals before returning, so a batch is delivered as soon as messages
    arrive rather than on a fixed timer.

    The ``sqs_client`` is injected for testability and defaults to a real
    ``boto3.client("sqs")`` when not supplied, with its region derived from the
    queue URL (see :func:`_region_from_queue_url`) so the pump needs no
    ``AWS_REGION`` in the environment. Tests pass a ``botocore`` Stubber-attached
    client instead.
    """

    def __init__(
        self,
        queue_url: str,
        sqs_client: Any | None = None,
        max_messages: int = 10,
        wait_seconds: int = 20,
    ) -> None:
        self._queue_url = queue_url
        self._sqs_client = sqs_client or boto3.client(
            "sqs", region_name=_region_from_queue_url(queue_url)
        )
        self._max_messages = max_messages
        self._wait_seconds = wait_seconds

    def receive(self) -> WebhookFeedEnvelope:
        """Poll SQS and return pending Linear webhooks as LinearWebhookMessages.

        Builds each message from the SQS message: the raw webhook JSON from
        ``Body`` (kept as bytes so the ``Linear-Signature`` HMAC stays valid) and
        the Linear headers from ``MessageAttributes``. The original SQS message is
        carried opaquely in ``raw`` so ``acknowledge`` can recover its receipt
        handle later.

        A client failure is caught and reported as a handled
        ``FAILED_FEED_RECEIVE`` error so the forwarder can react rather than
        crash.
        """
        logger.debug(
            "polling SQS queue %s (max=%d, wait=%ds)",
            self._queue_url,
            self._max_messages,
            self._wait_seconds,
        )
        try:
            response = self._sqs_client.receive_message(
                QueueUrl=self._queue_url,
                MaxNumberOfMessages=self._max_messages,
                MessageAttributeNames=["All"],
                WaitTimeSeconds=self._wait_seconds,
            )
        except Exception as exc:
            logger.warning("SQS receive failed: %s", exc, exc_info=True)
            error: FeedError = {
                "type": "failed_feed_receive",
                "reason": str(exc),
            }
            return {"messages": [], "error": error}
        messages: list[LinearWebhookMessage] = [
            {
                "body": message["Body"].encode("utf-8"),
                "headers": {
                    name: attribute["StringValue"]
                    for name, attribute in message.get("MessageAttributes", {}).items()
                },
                "raw": message,
            }
            for message in response.get("Messages", [])
        ]
        logger.debug("received %d message(s) from %s", len(messages), self._queue_url)
        return {"messages": messages, "error": None}

    def acknowledge(self, message: LinearWebhookMessage) -> Optional[FeedError]:
        """Delete a processed message from SQS so it is not redelivered.

        Returns ``None`` on success. A client failure is caught and reported as
        a handled ``FAILED_MESSAGE_ACKNOWLEDGE`` error so the forwarder can react
        rather than abort its loop.
        """
        receipt_handle = message["raw"]["ReceiptHandle"]
        try:
            self._sqs_client.delete_message(
                QueueUrl=self._queue_url,
                ReceiptHandle=receipt_handle,
            )
        except Exception as exc:
            logger.warning("SQS delete failed: %s", exc, exc_info=True)
            return {
                "type": "failed_message_acknowledge",
                "reason": str(exc),
            }
        logger.debug("acknowledged message %s", message["raw"].get("MessageId"))
        return None
