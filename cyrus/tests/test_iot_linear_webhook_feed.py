"""Specification (RED scaffold) for IoTLinearWebhookFeed — the AWS IoT read side.

These tests describe how the IoT feed turns MQTT messages pushed on the consumer's
own keyed topic (``cyrus/v1/sessions/<creator-id>``) into LinearWebhookMessage value
objects surfaced through the poll-based ``receive()`` / ``acknowledge()`` port, and
how it slots behind the UNCHANGED ``ProxyExecutionLoop``. They cover the five parent
acceptance criteria of DC-22:

1. With the IoT feed wired in, the unchanged ProxyExecutionLoop forwards each received
   message unchanged (the adapter satisfies the existing port).
2. A message arriving on the consumer's key is surfaced byte-identical (body +
   headers) and still passes ``proxy.linear_signature.verify``.
3. Auth is IAM/SigV4 over WebSocket reusing the instance role (no X.509 certs) and the
   subscription is restricted to the consumer's own topic filter.
4. A forward failure leaves the message un-acknowledged → redelivery (at-least-once),
   mirroring the SQS adapter; ``acknowledge`` is the QoS-completion (PUBACK) step.
5. The routing key + endpoint are read from env and ``CYRUS_PROXY_FEED`` selects
   ``iot`` (see ``test_iot_config_selection.py``).

This is a SKELETON: ``IoTLinearWebhookFeed.receive`` / ``acknowledge`` raise
``AssertionError("Not yet implemented — RED scaffold")``, so every test here is
honest RED (fails on that AssertionError), NOT broken (imports resolve, the injected
fake connection and signatures are real). Each test's post-call assertions document
the target a downstream implementation sub-issue must satisfy to turn it green.

IF YOU'RE AN AGENT, READ THIS:
- These tests are the specification. Implement the feed to satisfy them; never weaken
  or rewrite an assertion to fit the implementation.
- Mock only at the port boundary — the injected MQTT connection (FakeIoTConnection).
  Do not mock the feed's internals.
"""

from __future__ import annotations

from typing import Any, Callable, Optional
from unittest.mock import MagicMock

from proxy.execution_loop import ProxyExecutionLoop
from proxy.linear_signature import sign, verify
from proxy.messages import ForwardErrorEnum, LinearWebhookMessage
from webhook_feeds.iot_feed import IoTLinearWebhookFeed, topic_filter_for

ROUTING_KEY = "creator-9f2c-iot-consumer"
ENDPOINT = "a3k7example-ats.iot.us-east-1.amazonaws.com"
REGION = "us-east-1"
SIGNING_SECRET = "iot-shared-webhook-secret"

# A representative raw Linear webhook body (an AgentSessionEvent created), as the
# exact bytes that were published to the topic. Built as a literal so a test cannot
# pass by echoing input the feed itself produced.
WEBHOOK_BODY = (
    b'{"type":"AgentSessionEvent","action":"created",'
    b'"organizationId":"org-1","agentSession":{"id":"sess-1",'
    b'"creator":{"id":"creator-9f2c-iot-consumer"}}}'
)


class FakeIoTConnection:
    """In-memory stand-in for an AWS IoT MQTT-over-WebSocket (SigV4) connection.

    Models the surface a downstream adapter drives — ``connect()``,
    ``subscribe(topic, qos, callback)``, ``disconnect()``, and ``puback(packet_id)``
    — recording the subscriptions and PUBACKs so a test can verify what the feed drove
    at the connection boundary. ``deliver`` simulates the broker pushing a publish on a
    topic, routing it to the registered subscription callback (or buffering it until one
    is registered) so the push-to-poll bridge can be exercised once implemented.
    """

    def __init__(self) -> None:
        self.connected = False
        self.subscriptions: list[tuple[str, int]] = []
        self.pubacked_packet_ids: list[int] = []
        self._callbacks: dict[str, Callable[..., None]] = {}
        self._pending: list[tuple[str, bytes, dict[str, str], int]] = []

    def connect(self) -> None:
        self.connected = True

    def subscribe(self, topic: str, qos: int, callback: Callable[..., None]) -> None:
        self.subscriptions.append((topic, qos))
        self._callbacks[topic] = callback
        for entry in list(self._pending):
            t, payload, headers, packet_id = entry
            if t == topic:
                callback(topic=t, payload=payload, headers=headers, packet_id=packet_id)
                self._pending.remove(entry)

    def disconnect(self) -> None:
        self.connected = False

    def puback(self, packet_id: int) -> None:
        self.pubacked_packet_ids.append(packet_id)

    def deliver(
        self,
        *,
        topic: str,
        payload: bytes,
        headers: dict[str, str],
        packet_id: int = 1,
    ) -> None:
        """Simulate the broker pushing a QoS 1 publish on ``topic``."""
        callback = self._callbacks.get(topic)
        if callback is not None:
            callback(topic=topic, payload=payload, headers=headers, packet_id=packet_id)
        else:
            self._pending.append((topic, payload, headers, packet_id))


def linear_headers(signature: str) -> dict[str, str]:
    """The forwarded Linear headers carried alongside the body, with a real signature."""
    return {
        "Content-Type": "application/json; charset=utf-8",
        "Linear-Event": "AgentSessionEvent",
        "Linear-Delivery": "iot-delivery-1",
        "User-Agent": "Linear-Webhook",
        "Linear-Signature": signature,
    }


def make_feed(connection: FakeIoTConnection) -> IoTLinearWebhookFeed:
    """Build the feed under test with the injected fake connection (no live AWS)."""
    return IoTLinearWebhookFeed(
        routing_key=ROUTING_KEY,
        endpoint=ENDPOINT,
        region=REGION,
        connection=connection,
    )


def test_loop_forwards_each_iot_message_unchanged_through_the_unchanged_port() -> None:
    """AC1: the unchanged ProxyExecutionLoop forwards a received IoT message unchanged.

    Drives the real ``run_once`` (no loop changes) against the IoT feed; the message
    pushed on the consumer's topic must reach the forwarder with its raw body intact.
    """
    connection = FakeIoTConnection()
    connection.deliver(
        topic=topic_filter_for(ROUTING_KEY),
        payload=WEBHOOK_BODY,
        headers=linear_headers(sign(WEBHOOK_BODY, SIGNING_SECRET)),
    )
    forwarder = MagicMock()
    forwarder.forward.return_value = None
    loop = ProxyExecutionLoop(feed=make_feed(connection), forwarder=forwarder)

    loop.run_once()

    forwarded: LinearWebhookMessage = forwarder.forward.call_args.args[0]
    assert forwarded["body"] == WEBHOOK_BODY


def test_received_message_is_byte_identical_and_passes_signature_verification() -> None:
    """AC2: the surfaced body is byte-identical and still verifies against the secret."""
    signature = sign(WEBHOOK_BODY, SIGNING_SECRET)
    connection = FakeIoTConnection()
    connection.deliver(
        topic=topic_filter_for(ROUTING_KEY),
        payload=WEBHOOK_BODY,
        headers=linear_headers(signature),
    )
    feed = make_feed(connection)

    envelope = feed.receive()

    message = envelope["messages"][0]
    assert message["body"] == WEBHOOK_BODY
    assert message["headers"]["Linear-Signature"] == signature
    assert verify(
        message["body"], SIGNING_SECRET, message["headers"]["Linear-Signature"]
    )


def test_subscribes_only_to_its_own_keyed_topic_on_the_first_receive() -> None:
    """AC3: the first ``receive()`` subscribes to exactly the consumer's key, no wildcard.

    The subscription target is the feed's behaviour, verified at the connection
    boundary: it must be ``cyrus/v1/sessions/<routing-key>`` at QoS 1, never a
    wildcard. The IAM/SigV4-over-WebSocket auth with no X.509 certificate is a
    structural property of how ``build_default_iot_connection`` builds the connection
    (``websockets_with_default_aws_signing`` takes no certificate), not something the
    feed decides — so it is not asserted on the injected double here.
    """
    connection = FakeIoTConnection()
    feed = make_feed(connection)

    feed.receive()

    assert connection.subscriptions == [(f"cyrus/v1/sessions/{ROUTING_KEY}", 1)]


def test_failed_forward_leaves_message_unacknowledged_for_redelivery() -> None:
    """AC4: a forward failure must NOT acknowledge — the message is redelivered.

    Mirrors the SQS at-least-once contract: the unchanged loop only acknowledges a
    cleanly-forwarded message, so a failed forward leaves the IoT message un-PUBACKed
    and the broker redelivers it. Asserted against the feed via a spy on acknowledge.
    """
    connection = FakeIoTConnection()
    connection.deliver(
        topic=topic_filter_for(ROUTING_KEY),
        payload=WEBHOOK_BODY,
        headers=linear_headers(sign(WEBHOOK_BODY, SIGNING_SECRET)),
    )
    feed = make_feed(connection)
    feed.acknowledge = MagicMock(wraps=feed.acknowledge)  # type: ignore[method-assign]
    forwarder = MagicMock()
    forwarder.forward.return_value = {
        "type": ForwardErrorEnum.FAILED_FORWARD_REQUEST,
        "reason": "connection refused",
    }
    loop = ProxyExecutionLoop(feed=feed, forwarder=forwarder)

    loop.run_once()

    feed.acknowledge.assert_not_called()


def test_acknowledge_sends_qos1_puback_so_the_broker_stops_redelivering() -> None:
    """AC4 (ack path): acknowledge() PUBACKs the message's packet id (QoS 1 complete)."""
    connection = FakeIoTConnection()
    feed = make_feed(connection)
    message: LinearWebhookMessage = {
        "body": WEBHOOK_BODY,
        "headers": linear_headers(sign(WEBHOOK_BODY, SIGNING_SECRET)),
        "raw": {"topic": topic_filter_for(ROUTING_KEY), "packet_id": 7, "qos": 1},
    }

    result: Optional[Any] = feed.acknowledge(message)

    assert result is None
    assert connection.pubacked_packet_ids == [7]
