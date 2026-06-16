"""AWS IoT-backed feed adapter for Linear webhook events (RED scaffold).

Holds a persistent AWS IoT **MQTT-over-WebSocket (SigV4)** connection authenticated
by the devpod **instance role** (IAM credentials from the default AWS provider chain;
**no X.509 device certificates**), subscribes to this consumer's own keyed topic
``cyrus/v1/sessions/<creator-id>`` (no wildcards), and exposes received messages
through the same ``receive()`` / ``acknowledge()`` port the SQS and canary feeds
satisfy — so the adapter slots behind ``LinearWebhookFeedProtocol`` with NO changes
to ``ProxyExecutionLoop``. Like the sibling adapters it carries no runtime dependency
on the proxy core: it returns plain dicts conforming to the boundary TypedDicts,
imported under ``TYPE_CHECKING`` only.

This module is a **skeleton**: the public surface (class, constructor signature,
``receive`` / ``acknowledge``) is fixed so downstream implementation sub-issues can
turn the RED tests green, but the method bodies raise ``AssertionError`` rather than
talking to AWS. See ``__SCAFFOLD__`` below.

Push-to-poll adaptation
-----------------------
MQTT delivery is **push**-based: the broker fires an on-message callback when a
publish arrives on the subscribed topic. The feed port, however, is **poll**-based
(``receive()`` returns a batch on demand). The adapter bridges the two with an
internal thread-safe queue: the subscription callback enqueues each arriving message
and ``receive()`` drains the queue into a :class:`WebhookFeedEnvelope` batch
(mirroring how ``SQSLinearWebhookFeed.receive()`` returns a batch). The first
``receive()`` is responsible for establishing the connection and subscription if not
already connected.

Byte-identity / opaqueness contract
-----------------------------------
The body surfaced by ``receive()`` MUST be the **raw payload bytes** of the MQTT
message, byte-identical to the originally published/verified webhook body, so it
still passes ``proxy.linear_signature.verify`` against the same secret used to sign.
The adapter never re-serializes or mutates the body; it carries the forwarded Linear
headers alongside it and stashes transport details (topic, packet id, QoS) opaquely
in ``raw`` for ``acknowledge``.

QoS / acknowledge semantics (the at-least-once contract)
--------------------------------------------------------
Subscribe at **MQTT QoS 1 (at-least-once)** with **manual acknowledgement**: the
broker holds a message as un-acked until the client sends the PUBACK. The adapter
maps this onto the port exactly as SQS does — *buffer, drain, forward, then ack*:

1. The on-message callback enqueues the arriving message in the internal buffer.
2. ``receive()`` drains the buffer into a batch (without acking).
3. The loop forwards each message; **only on a clean forward** does it call
   ``acknowledge(message)``, which sends the PUBACK (completes the packet) so the
   broker stops redelivering.
4. A failed forward leaves the message **un-acked**, so the broker **redelivers** it
   on reconnect / next delivery — identical to the SQS adapter leaving an undeleted
   message for redelivery. This yields the same **at-least-once** guarantee.

(QoS 1 + manual-ack-after-forward is chosen over QoS 0, which is fire-and-forget and
would silently drop a message whose forward failed.)
"""

from __future__ import annotations

import logging
import queue
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from proxy.messages import FeedError, LinearWebhookMessage, WebhookFeedEnvelope

logger = logging.getLogger(__name__)

# RED scaffold marker: this module defines signatures and documents the contract but
# does not implement IoT I/O. Downstream DC-22 sub-issues replace the raising bodies.
__SCAFFOLD__ = True

_NOT_IMPLEMENTED = "Not yet implemented — RED scaffold"

# Topic namespace each consumer subscribes under; the routing key is the creator id.
TOPIC_PREFIX = "cyrus/v1/sessions/"


def topic_filter_for(routing_key: str) -> str:
    """Return the exact (wildcard-free) topic filter for a consumer's routing key.

    The consumer subscribes only to its own key — ``cyrus/v1/sessions/<creator-id>``
    — never a wildcard, so it receives only the sessions addressed to it.
    """
    return f"{TOPIC_PREFIX}{routing_key}"


class IoTLinearWebhookFeed:
    """AWS IoT (MQTT-over-WebSocket, SigV4) implementation of the feed port (scaffold).

    Satisfies ``proxy.execution_loop.LinearWebhookFeedProtocol`` structurally — it
    neither imports nor subclasses the port. The MQTT/IoT ``connection`` is injected
    so tests pass a fake and never touch AWS; in production the composition root
    builds a real connection authenticated by the instance role via SigV4 over
    WebSocket (no device certs). ``endpoint``, ``routing_key`` (this consumer's
    ``creator.id``) and ``region`` configure that connection and the keyed
    subscription.

    Arriving messages are buffered in an internal thread-safe queue by the
    subscription callback and drained by ``receive()`` (push-to-poll); see the module
    docstring for the QoS 1 / manual-ack at-least-once contract.
    """

    def __init__(
        self,
        *,
        routing_key: str,
        endpoint: str,
        region: Optional[str] = None,
        connection: Any | None = None,
        max_messages: int = 10,
    ) -> None:
        self._routing_key = routing_key
        self._endpoint = endpoint
        self._region = region
        self._connection = connection
        self._max_messages = max_messages
        self._topic_filter = topic_filter_for(routing_key)
        # Push-to-poll bridge: the on-message callback fills this, receive() drains it.
        self._buffer: "queue.Queue[LinearWebhookMessage]" = queue.Queue()

    @property
    def topic_filter(self) -> str:
        """The wildcard-free topic this consumer subscribes to (its own key only)."""
        return self._topic_filter

    def receive(self) -> WebhookFeedEnvelope:
        """Drain buffered MQTT messages into a batch (connecting/subscribing first).

        Downstream: on the first call establish the SigV4-over-WebSocket connection
        and subscribe at QoS 1 to :attr:`topic_filter`, registering an on-message
        callback that enqueues arrivals; then drain up to ``max_messages`` from the
        buffer into a :class:`WebhookFeedEnvelope`. Each surfaced message carries the
        **raw payload bytes** unchanged plus the forwarded Linear headers, with the
        QoS ack token (packet id / topic) stashed in ``raw`` for ``acknowledge``.
        """
        raise AssertionError(_NOT_IMPLEMENTED)

    def acknowledge(self, message: LinearWebhookMessage) -> Optional[FeedError]:
        """Send the QoS 1 PUBACK for a forwarded message so it is not redelivered.

        Downstream: recover the packet id / topic from ``message['raw']`` and PUBACK
        it on the connection, returning ``None`` on success or a handled
        ``FAILED_MESSAGE_ACKNOWLEDGE`` :class:`FeedError`. A message never acked
        (e.g. its forward failed) is redelivered by the broker — the at-least-once
        contract mirroring the SQS adapter.
        """
        raise AssertionError(_NOT_IMPLEMENTED)
