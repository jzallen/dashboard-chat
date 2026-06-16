"""AWS IoT-backed feed adapter for Linear webhook events.

Holds a persistent AWS IoT **MQTT-over-WebSocket (SigV4)** connection authenticated
by the devpod **instance role** (IAM credentials from the default AWS provider chain;
**no X.509 device certificates**), subscribes to this consumer's own keyed topic
``cyrus/v1/sessions/<creator-id>`` (no wildcards), and exposes received messages
through the same ``receive()`` / ``acknowledge()`` port the SQS and canary feeds
satisfy — so the adapter slots behind ``LinearWebhookFeedProtocol`` with NO changes
to ``ProxyExecutionLoop``. Like the sibling adapters it carries no runtime dependency
on the proxy core: it returns plain dicts conforming to the boundary TypedDicts,
imported under ``TYPE_CHECKING`` only.

Push-to-poll adaptation
-----------------------
MQTT delivery is **push**-based: the broker fires an on-message callback when a
publish arrives on the subscribed topic. The feed port, however, is **poll**-based
(``receive()`` returns a batch on demand). The adapter bridges the two with an
internal thread-safe queue: the subscription callback enqueues each arriving message
and ``receive()`` drains the queue into a :class:`WebhookFeedEnvelope` batch
(mirroring how ``SQSLinearWebhookFeed.receive()`` returns a batch). The first
``receive()`` establishes the connection and subscription, then returns whatever is
already buffered without blocking; subsequent calls block up to
``poll_timeout_seconds`` for the next pushed message so the steady-state loop waits
on the broker instead of busy-spinning (the push analogue of SQS long-poll).

Byte-identity / opaqueness contract
-----------------------------------
The body surfaced by ``receive()`` is the **raw payload bytes** of the MQTT message,
byte-identical to the originally published/verified webhook body, so it still passes
``proxy.linear_signature.verify`` against the same secret used to sign. The adapter
never re-serializes or mutates the body; it carries the forwarded Linear headers
alongside it and stashes transport details (topic, packet id, QoS) opaquely in
``raw`` for ``acknowledge``.

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

Header transport boundary
--------------------------
The forwarded Linear headers (``Linear-Signature`` and friends) arrive alongside the
body through the injected connection's on-message callback — the seam this adapter is
written against. The publish side (DC-21) currently sends the raw body only over the
IoT Data-plane API and carries the headers on the SQS leg, so end-to-end header
delivery over IoT is the integration contract the connection seam abstracts: a real
connection sources the headers from the transport (e.g. MQTT user properties) and
hands them to the callback. This adapter stays agnostic to how they travel — it
surfaces whatever the connection delivers byte-for-byte.
"""

from __future__ import annotations

import logging
import queue
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from proxy.messages import FeedError, LinearWebhookMessage, WebhookFeedEnvelope

logger = logging.getLogger(__name__)

# Topic namespace each consumer subscribes under; the routing key is the creator id.
TOPIC_PREFIX = "cyrus/v1/sessions/"

# MQTT QoS 1 (at-least-once): the broker holds the publish un-acked until PUBACK, so a
# failed forward leaves the message for redelivery (see the module docstring).
_QOS_AT_LEAST_ONCE = 1


def topic_filter_for(routing_key: str) -> str:
    """Return the exact (wildcard-free) topic filter for a consumer's routing key.

    The consumer subscribes only to its own key — ``cyrus/v1/sessions/<creator-id>``
    — never a wildcard, so it receives only the sessions addressed to it.
    """
    return f"{TOPIC_PREFIX}{routing_key}"


class IoTLinearWebhookFeed:
    """AWS IoT (MQTT-over-WebSocket, SigV4) implementation of the feed port.

    Satisfies ``proxy.execution_loop.LinearWebhookFeedProtocol`` structurally — it
    neither imports nor subclasses the port. The MQTT/IoT ``connection`` is injected so
    tests pass a fake and never touch AWS; when omitted the first ``receive()`` tries to
    build the default instance-role SigV4 connection, which is the not-yet-wired
    live-AWS integration step (see :func:`build_default_iot_connection`). ``endpoint``,
    ``routing_key`` (this consumer's ``creator.id``) and ``region`` configure that
    connection and the keyed subscription.

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
        poll_timeout_seconds: float = 20.0,
    ) -> None:
        self._routing_key = routing_key
        self._endpoint = endpoint
        self._region = region
        self._connection = connection
        # An injected connection is owned by the caller; a lazily-built one is ours to
        # drop on stop() so a restart rebuilds a fresh connection.
        self._owns_connection = connection is None
        self._max_messages = max_messages
        self._poll_timeout_seconds = poll_timeout_seconds
        self._topic_filter = topic_filter_for(routing_key)
        self._started = False
        # Push-to-poll bridge: the on-message callback fills this, receive() drains it.
        self._buffer: "queue.Queue[LinearWebhookMessage]" = queue.Queue()

    @property
    def topic_filter(self) -> str:
        """The wildcard-free topic this consumer subscribes to (its own key only)."""
        return self._topic_filter

    def receive(self) -> WebhookFeedEnvelope:
        """Drain buffered MQTT messages into a batch (connecting/subscribing first).

        On the first call this establishes the SigV4-over-WebSocket connection and
        subscribes at QoS 1 to :attr:`topic_filter`, then returns whatever has already
        been buffered without blocking. Later calls block up to
        ``poll_timeout_seconds`` for the next pushed message before draining, so the
        loop waits on the broker rather than busy-spinning. Each surfaced message
        carries the **raw payload bytes** unchanged plus the forwarded Linear headers,
        with the QoS ack token (packet id / topic) stashed in ``raw`` for
        ``acknowledge``. A connection/subscription failure is reported as a handled
        ``FAILED_FEED_RECEIVE`` error so the loop can back off rather than crash.
        """
        try:
            first_poll = not self._started
            self._ensure_started()
        except Exception as exc:
            logger.warning("IoT connect/subscribe failed: %s", exc, exc_info=True)
            error: FeedError = {"type": "failed_feed_receive", "reason": str(exc)}
            return {"messages": [], "error": error}
        messages = self._drain(block=not first_poll)
        if messages:
            logger.debug(
                "drained %d IoT message(s) from %s", len(messages), self._topic_filter
            )
        return {"messages": messages, "error": None}

    def acknowledge(self, message: LinearWebhookMessage) -> Optional[FeedError]:
        """Send the QoS 1 PUBACK for a forwarded message so it is not redelivered.

        Recovers the packet id from ``message['raw']`` and PUBACKs it on the
        connection, returning ``None`` on success or a handled
        ``FAILED_MESSAGE_ACKNOWLEDGE`` :class:`FeedError`. A message never acked
        (e.g. its forward failed) is redelivered by the broker — the at-least-once
        contract mirroring the SQS adapter.
        """
        packet_id = message["raw"]["packet_id"]
        try:
            self._connection.puback(packet_id)
        except Exception as exc:
            logger.warning("IoT PUBACK failed: %s", exc, exc_info=True)
            return {"type": "failed_message_acknowledge", "reason": str(exc)}
        logger.debug("acknowledged IoT packet %s", packet_id)
        return None

    def stop(self) -> None:
        """Disconnect the IoT connection cleanly (idempotent best-effort).

        A lazily-built connection is dropped so a later ``receive()`` rebuilds a fresh
        one rather than reconnecting an already-disconnected connection; an injected
        connection is left in place for its owner (e.g. tests).
        """
        if self._connection is not None and self._started:
            try:
                self._connection.disconnect()
            except Exception as exc:
                logger.warning("IoT disconnect failed: %s", exc, exc_info=True)
            self._started = False
            if self._owns_connection:
                self._connection = None

    def _ensure_started(self) -> None:
        """Connect and subscribe to the consumer's own topic exactly once."""
        if self._started:
            return
        if self._connection is None:
            self._connection = build_default_iot_connection(
                endpoint=self._endpoint,
                routing_key=self._routing_key,
                region=self._region,
            )
        self._connection.connect()
        self._connection.subscribe(
            self._topic_filter, _QOS_AT_LEAST_ONCE, self._on_message
        )
        self._started = True
        logger.info(
            "subscribed to %s at QoS %d", self._topic_filter, _QOS_AT_LEAST_ONCE
        )

    def _on_message(
        self,
        *,
        topic: str,
        payload: bytes,
        headers: dict[str, str],
        packet_id: int,
    ) -> None:
        """Enqueue a pushed MQTT publish for ``receive()`` to drain (push-to-poll)."""
        message: LinearWebhookMessage = {
            "body": payload,
            "headers": headers,
            "raw": {"topic": topic, "packet_id": packet_id, "qos": _QOS_AT_LEAST_ONCE},
        }
        self._buffer.put(message)

    def _drain(self, *, block: bool) -> list[LinearWebhookMessage]:
        """Drain up to ``max_messages`` buffered messages.

        When ``block`` is true, wait up to ``poll_timeout_seconds`` for the first
        message (the steady-state long-poll analogue); the remainder of the batch is
        always drained without blocking. An empty buffer yields an empty batch.
        """
        messages: list[LinearWebhookMessage] = []
        if block:
            try:
                messages.append(self._buffer.get(timeout=self._poll_timeout_seconds))
            except queue.Empty:
                return messages
        while len(messages) < self._max_messages:
            try:
                messages.append(self._buffer.get_nowait())
            except queue.Empty:
                break
        return messages


def build_default_iot_connection(
    *,
    endpoint: str,
    routing_key: str,
    region: Optional[str] = None,
) -> "_AwsCrtIoTConnection":
    """Build the production MQTT-over-WebSocket (SigV4) connection for the feed.

    The intended wiring (the live-AWS integration step) builds an awscrt **MQTT5**
    client via ``websockets_with_default_aws_signing`` over the **default AWS
    credentials provider chain** — so the devpod **instance role** signs the WebSocket
    handshake and **no X.509 device certificate** is involved — targeting
    ``endpoint``/``region`` with a client id derived from ``routing_key``, and wraps it
    in an :class:`_AwsCrtIoTConnection`.

    It is **not yet wired**: the feed's at-least-once contract needs *manual* QoS 1
    acknowledgement (PUBACK only after a clean forward), which requires the MQTT5
    client — the MQTT 3.1.1 connection builder auto-acks on callback return and exposes
    no ``puback``. Rather than ship a connection that would silently break redelivery,
    this raises until the MQTT5 manual-ack path is wired and verified against a live
    endpoint. The feed's behaviour and the :class:`_AwsCrtIoTConnection` delegation
    surface are fully unit-tested via an injected connection in the meantime.
    """
    raise NotImplementedError(
        "production AWS IoT connection is not wired yet: it needs the awscrt MQTT5 "
        "manual-ack client (SigV4 default-chain, no device certs) so PUBACK fires only "
        "after a successful forward. Inject a connection to run the feed until then."
    )


class _AwsCrtIoTConnection:
    """Adapts an ``awscrt`` MQTT connection to the feed's connection seam.

    Translates the seam's ``connect``/``subscribe``/``disconnect``/``puback`` onto the
    awscrt connection's futures-based API and maps awscrt's on-message callback onto
    the seam callback ``(topic, payload, headers, packet_id)`` the feed expects. The
    forwarded Linear headers are sourced from the transport (MQTT user properties when
    present); see the module docstring's header-transport boundary. Kept thin and
    behind a lazy import so the unit suite drives a fake connection and never touches
    AWS — the byte-identity / at-least-once behaviour is unit-tested on the feed seam,
    while this adapter encodes the verifiable production wiring.
    """

    def __init__(self, mqtt_connection: Any) -> None:
        self._connection = mqtt_connection

    def connect(self) -> None:
        self._connection.connect().result()

    def subscribe(self, topic: str, qos: int, callback: Any) -> None:
        from awscrt import mqtt

        def _on_crt_message(
            topic: str, payload: bytes, dup: bool, qos: Any, retain: bool, **kwargs: Any
        ) -> None:
            user_properties = kwargs.get("user_properties") or []
            headers = {prop.name: prop.value for prop in user_properties}
            callback(
                topic=topic,
                payload=payload,
                headers=headers,
                packet_id=kwargs.get("packet_id", 0),
            )

        subscribe_future, _ = self._connection.subscribe(
            topic=topic, qos=mqtt.QoS(qos), callback=_on_crt_message
        )
        subscribe_future.result()

    def disconnect(self) -> None:
        self._connection.disconnect().result()

    def puback(self, packet_id: int) -> None:
        """Forward the QoS 1 PUBACK (manual ack) to the underlying connection.

        Like the other methods this only delegates; the connection built by
        :func:`build_default_iot_connection` must provide manual acknowledgement
        (PUBACK only after a clean forward — the awscrt **MQTT5** manual-ack client,
        since the MQTT 3.1.1 builder auto-acks on callback return). Wiring that real
        connection is the live-AWS integration step; the at-least-once behaviour
        itself is unit-tested on the feed via the injected connection.
        """
        self._connection.puback(packet_id)
