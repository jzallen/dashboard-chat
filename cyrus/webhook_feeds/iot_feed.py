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
body through the connection's on-message callback — the seam this adapter is written
against. End-to-end over IoT they ride as **MQTT5 user properties**: the publish side
attaches the forwarded headers as user properties on the IoT Data-plane publish, and
:class:`_Mqtt5IoTConnection` reads them off each inbound publish packet and hands them
to the callback. The body therefore reaches ``receive()`` with the same
``Linear-Signature`` it was signed with, so it verifies at Cyrus unchanged. The feed
stays agnostic to how they travel — it surfaces whatever the connection delivers
byte-for-byte.
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import uuid
from typing import TYPE_CHECKING, Any, Callable, Optional

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
        try:
            packet_id = message["raw"]["packet_id"]
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
            self._disconnect_quietly()
            self._started = False

    def _disconnect_quietly(self) -> None:
        """Best-effort disconnect, dropping a lazily-built connection so it can rebuild."""
        try:
            self._connection.disconnect()
        except Exception as exc:
            logger.warning("IoT disconnect failed: %s", exc, exc_info=True)
        if self._owns_connection:
            self._connection = None

    def _ensure_started(self) -> None:
        """Connect and subscribe to the consumer's own topic exactly once."""
        if self._started:
            return
        if self._connection is None:
            self._connection = build_default_iot_connection(
                IoTConfig(
                    endpoint=self._endpoint,
                    routing_key=self._routing_key,
                    region=self._region,
                )
            )
        self._connection.connect()
        try:
            self._connection.subscribe(
                self._topic_filter, _QOS_AT_LEAST_ONCE, self._on_message
            )
        except Exception:
            # connect() left a live connection but the subscribe failed, so the feed is
            # not started — stop() would skip it and leak the connection. Tear it down
            # here so a later receive() rebuilds from scratch.
            self._disconnect_quietly()
            raise
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


class IoTConnectionError(Exception):
    """Raised when the live IoT connection cannot connect within the timeout.

    Surfaced out of :meth:`_Mqtt5IoTConnection.connect`; the feed catches it on the
    first ``receive()`` and reports a handled ``FAILED_FEED_RECEIVE`` so the loop backs
    off instead of crashing.
    """


class IoTConfig:
    """Validated configuration for the IoT MQTT5 connection.

    Resolves everything the SigV4 connection needs up front, so the builder is a thin
    consumer that just reads ready-made values:

    * :attr:`region` — the SigV4 signing region. Prefer the explicit ``region``, then
      the standard ``AWS_REGION`` / ``AWS_DEFAULT_REGION`` env vars; with none set this
      raises rather than guessing, so the signing region is always an explicit choice.
    * :attr:`client_id` — the MQTT client id, derived from ``routing_key`` for log/debug
      legibility with a short random suffix so two processes on the same key don't clash
      (a second connection sharing an id kicks the first off the broker), capped at the
      128-char MQTT limit.

    ``region`` resolution runs at construction, so an unconfigured region fails fast
    here rather than deep inside ``connect()``.
    """

    def __init__(
        self,
        *,
        endpoint: str,
        routing_key: str,
        region: Optional[str] = None,
    ) -> None:
        self.endpoint = endpoint
        self.routing_key = routing_key
        self.region = self._resolve_region(region)
        self.client_id = f"cyrus-{routing_key}-{uuid.uuid4().hex[:8]}"[:128]

    @staticmethod
    def _resolve_region(region: Optional[str]) -> str:
        resolved = (
            region
            or os.environ.get("AWS_REGION")
            or os.environ.get("AWS_DEFAULT_REGION")
        )
        if resolved:
            return resolved
        raise IoTConnectionError(
            "could not resolve an AWS region for SigV4 signing; "
            "set CYRUS_PROXY_IOT_REGION or AWS_REGION"
        )


def build_default_iot_connection(
    config: IoTConfig,
    *,
    mqtt5_client_builder: Any | None = None,
) -> "_Mqtt5IoTConnection":
    """Build the production MQTT5-over-WebSocket (SigV4) connection for the feed.

    Builds an awscrt **MQTT5** client via
    ``awsiot.mqtt5_client_builder.websockets_with_default_aws_signing`` over the
    **default AWS credentials provider chain** — so the devpod **instance role** signs
    the WebSocket handshake and **no X.509 device certificate** is involved — targeting
    the :class:`IoTConfig`'s endpoint/region with its derived client id, and wraps it in
    a :class:`_Mqtt5IoTConnection`. All endpoint/region/client-id resolution lives on the
    config; this function just reads it off.

    The MQTT5 client is what makes the feed's at-least-once contract honest: it takes
    *manual* acknowledgement control of each inbound QoS 1 publish so the PUBACK fires
    only when the feed calls ``acknowledge()`` after a clean forward (the MQTT 3.1.1
    builder auto-acks on callback return and exposes no ``puback``). The awscrt client
    also reconnects with exponential backoff and jitter on its own, so a dropped
    connection self-heals without the feed restarting.

    The client is built lazily on ``connect()`` so this returns without touching AWS.
    ``mqtt5_client_builder`` defaults to the real ``awsiot`` builder; tests inject a
    stand-in to spy on the SigV4 signing call (endpoint/region/client-id) and supply a
    fake client without reaching AWS.
    """

    def factory(
        *,
        on_publish_received: Callable[[Any], None],
        on_connection_success: Callable[[Any], None],
        on_connection_failure: Callable[[Any], None],
    ) -> Any:
        from awscrt.auth import AwsCredentialsProvider

        builder = mqtt5_client_builder
        if builder is None:
            from awsiot import mqtt5_client_builder as builder

        return builder.websockets_with_default_aws_signing(
            endpoint=config.endpoint,
            region=config.region,
            credentials_provider=AwsCredentialsProvider.new_default_chain(),
            client_id=config.client_id,
            on_publish_callback_fn=on_publish_received,
            on_lifecycle_event_connection_success_fn=on_connection_success,
            on_lifecycle_event_connection_failure_fn=on_connection_failure,
        )

    return _Mqtt5IoTConnection(factory)


class _Mqtt5IoTConnection:
    """Adapts an ``awscrt`` **MQTT5** client to the feed's connection seam.

    Translates the seam's ``connect`` / ``subscribe`` / ``disconnect`` / ``puback``
    onto the MQTT5 client's API and maps inbound publishes onto the seam callback
    ``(topic, payload, headers, packet_id)`` the feed expects.

    Two MQTT5 specifics shape this adapter:

    * The client delivers **every** inbound publish to a single ``on_publish`` callback
      registered at *build* time, not per ``subscribe``. So the adapter owns that
      callback and routes each publish to the callback handed to :meth:`subscribe`.
    * QoS 1 acknowledgement is **manual**: inside the publish callback the adapter calls
      ``acquire_publish_acknowledgement_control()`` to stop the client auto-acking, and
      stashes the opaque handle under a synthetic packet id. :meth:`puback` later calls
      ``invoke_publish_acknowledgement(handle)`` — so the PUBACK fires only when
      ``IoTLinearWebhookFeed.acknowledge()`` runs after a clean forward. The synthetic
      id is just the seam's opaque ack token; MQTT5 surfaces no inbound packet id.

    Headers travel as MQTT5 **user properties** on each publish (see the module
    docstring's header-transport boundary) and are surfaced byte-for-byte. The client
    is built lazily via an injected factory so the unit suite drives a fake and never
    touches AWS.
    """

    def __init__(
        self,
        client_factory: Callable[..., Any],
        *,
        connect_timeout_seconds: float = 30.0,
        operation_timeout_seconds: float = 30.0,
    ) -> None:
        self._client_factory = client_factory
        self._connect_timeout = connect_timeout_seconds
        self._operation_timeout = operation_timeout_seconds
        self._client: Any = None
        self._on_message: Optional[Callable[..., None]] = None
        # Manual-ack bookkeeping shared between the client's callback thread (writes on
        # each publish) and the loop thread (pops on puback), so it is lock-guarded.
        self._lock = threading.Lock()
        self._next_packet_id = 1
        self._ack_handles: dict[int, Any] = {}
        # connect() blocks until the client reports the first lifecycle outcome.
        self._connected = threading.Event()
        self._connect_error: Any = None

    def connect(self) -> None:
        """Build the client, start it, and block until connected (or raise on failure)."""
        self._connected.clear()
        self._connect_error = None
        self._client = self._client_factory(
            on_publish_received=self._handle_publish,
            on_connection_success=self._handle_connection_success,
            on_connection_failure=self._handle_connection_failure,
        )
        self._client.start()
        if not self._connected.wait(self._connect_timeout):
            self._stop_quietly()
            raise IoTConnectionError(
                f"timed out after {self._connect_timeout}s waiting to connect"
            )
        if self._connect_error is not None:
            self._stop_quietly()
            raise IoTConnectionError(f"IoT connection failed: {self._connect_error}")

    def subscribe(self, topic: str, qos: int, callback: Callable[..., None]) -> None:
        """Subscribe to exactly ``topic`` at ``qos`` and route its publishes to ``callback``."""
        from awscrt import mqtt5

        self._on_message = callback
        subscribe_future = self._client.subscribe(
            subscribe_packet=mqtt5.SubscribePacket(
                subscriptions=[
                    mqtt5.Subscription(topic_filter=topic, qos=mqtt5.QoS(qos))
                ]
            )
        )
        subscribe_future.result(self._operation_timeout)

    def disconnect(self) -> None:
        """Stop the client, ending connectivity and halting reconnect attempts."""
        self._client.stop()

    def _stop_quietly(self) -> None:
        """Best-effort stop of a client that failed to connect, so it stops reconnecting."""
        try:
            self._client.stop()
        except Exception as exc:
            logger.warning("stopping a failed IoT client raised: %s", exc)

    def puback(self, packet_id: int) -> None:
        """Send the manual QoS 1 PUBACK for the publish behind ``packet_id``.

        Pops the acknowledgement-control handle acquired when the publish arrived and
        invokes it on the client. Called only by ``IoTLinearWebhookFeed.acknowledge()``
        after a clean forward, so an un-acked (failed-forward) message is redelivered.
        A double or late ack (retry path, or a redelivered-then-re-acked message) finds
        no handle and is a safe no-op, which also bounds ``_ack_handles`` growth.
        """
        with self._lock:
            handle = self._ack_handles.pop(packet_id, None)
        if handle is None:
            return
        self._client.invoke_publish_acknowledgement(handle)

    def _handle_publish(self, publish_received_data: Any) -> None:
        """Take manual ack control of an inbound publish and route it to the seam callback.

        Runs on the client's event-loop thread. We subscribe strictly at QoS 1, so every
        inbound publish carries an acknowledgement to defer; the handle is held until
        :meth:`puback`. Headers come from the publish's MQTT5 user properties.
        """
        handle = publish_received_data.acquire_publish_acknowledgement_control()
        packet = publish_received_data.publish_packet
        with self._lock:
            packet_id = self._next_packet_id
            self._next_packet_id += 1
            self._ack_handles[packet_id] = handle
        payload = packet.payload
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        headers = {prop.name: prop.value for prop in (packet.user_properties or [])}
        assert self._on_message is not None  # set by subscribe() before any publish
        self._on_message(
            topic=packet.topic,
            payload=payload,
            headers=headers,
            packet_id=packet_id,
        )

    def _handle_connection_success(self, _data: Any) -> None:
        """Unblock :meth:`connect` once the broker accepts the connection."""
        self._connected.set()

    def _handle_connection_failure(self, data: Any) -> None:
        """Record the failure and unblock :meth:`connect` so it raises."""
        self._connect_error = getattr(data, "exception", None) or data
        self._connected.set()
