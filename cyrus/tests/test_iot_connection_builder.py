"""Contract test for the awscrt **MQTT5** IoT connection adapter (DC-74).

``_Mqtt5IoTConnection`` is the thin translation layer between the feed's connection
seam (``connect`` / ``subscribe`` / ``disconnect`` / ``puback``) and an awscrt MQTT5
client. It forwards each seam call onto the client, blocks ``connect()`` on the first
lifecycle outcome, maps an inbound publish onto the feed's ``(topic, payload, headers,
packet_id)`` callback, and — the reason MQTT5 is required — takes **manual control** of
each QoS 1 acknowledgement so the PUBACK fires only when the feed acknowledges after a
clean forward. These tests pin that forwarding by driving the adapter against a fake
MQTT5 client and asserting at the boundary; no live AWS.

``build_default_iot_connection`` is not connected here (calling ``connect()`` would
build a real SigV4 client), but its pure region/client-id derivation is pinned, and it
is asserted to return the MQTT5 adapter without touching AWS — the lazy factory is only
invoked on ``connect()``.

IF YOU'RE AN AGENT, READ THIS:
- The adapter only delegates, so verify it at the boundary: assert the underlying
  client method fired (start/subscribe/invoke_publish_acknowledgement/stop) and that an
  inbound publish reaches the seam callback. Never assert on a hand-rolled fake's own
  state as if it were the adapter's behaviour.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Callable, Optional

import pytest

pytest.importorskip("awscrt", reason="awscrt provides the MQTT5 SubscribePacket/QoS")

from awscrt import mqtt5  # noqa: E402

from webhook_feeds.iot_feed import (  # noqa: E402
    IoTConnectionError,
    _client_id_for,
    _Mqtt5IoTConnection,
    _region_for,
    build_default_iot_connection,
)

ROUTING_KEY = "creator-9f2c-iot-consumer"
ENDPOINT = "a3k7example-ats.iot.us-east-1.amazonaws.com"
TOPIC = f"cyrus/v1/sessions/{ROUTING_KEY}"
WEBHOOK_BODY = b'{"type":"AgentSessionEvent","action":"created"}'


class FakeFuture:
    """A resolved future whose ``result(timeout)`` returns immediately."""

    def result(self, timeout: Optional[float] = None) -> None:
        return None


class FakeMqtt5Client:
    """In-memory stand-in for an awscrt MQTT5 client.

    Captures the callbacks the adapter registers at build time and records the calls
    the adapter makes. ``start()`` synchronously fires the configured lifecycle event
    (success by default), which is how ``connect()`` unblocks without real threads.
    ``deliver()`` lets a test push an inbound publish through the adapter's on-publish
    callback exactly as the real client would.
    """

    def __init__(
        self,
        *,
        on_publish_received: Callable[[Any], None],
        on_connection_success: Callable[[Any], None],
        on_connection_failure: Callable[[Any], None],
        fail_with: Optional[Exception] = None,
    ) -> None:
        self._on_publish = on_publish_received
        self._on_success = on_connection_success
        self._on_failure = on_connection_failure
        self._fail_with = fail_with
        self.started = False
        self.stopped = False
        self.subscribe_packets: list[mqtt5.SubscribePacket] = []
        self.acknowledged_handles: list[Any] = []

    def start(self) -> None:
        self.started = True
        if self._fail_with is not None:
            self._on_failure(SimpleNamespace(exception=self._fail_with))
        else:
            self._on_success(SimpleNamespace())

    def subscribe(self, *, subscribe_packet: mqtt5.SubscribePacket) -> FakeFuture:
        self.subscribe_packets.append(subscribe_packet)
        return FakeFuture()

    def stop(self, disconnect_packet: Any = None) -> None:
        self.stopped = True

    def invoke_publish_acknowledgement(self, handle: Any) -> None:
        self.acknowledged_handles.append(handle)

    def deliver(
        self, *, topic: str, payload: Any, user_properties: list, handle: Any
    ) -> None:
        """Push an inbound publish through the adapter's on-publish callback."""
        packet = SimpleNamespace(
            topic=topic, payload=payload, user_properties=user_properties
        )
        data = SimpleNamespace(
            publish_packet=packet,
            acquire_publish_acknowledgement_control=lambda: handle,
        )
        self._on_publish(data)


def make_adapter(**client_kwargs: Any) -> tuple[_Mqtt5IoTConnection, dict]:
    """Build the adapter with a factory that records the built fake client.

    Returns ``(adapter, holder)`` where ``holder['client']`` is populated when the
    adapter builds the client inside ``connect()``.
    """
    holder: dict = {}

    def factory(**callbacks: Any) -> FakeMqtt5Client:
        client = FakeMqtt5Client(**callbacks, **client_kwargs)
        holder["client"] = client
        return client

    return _Mqtt5IoTConnection(factory, connect_timeout_seconds=1.0), holder


def test_connect_builds_and_starts_the_client_then_returns_on_success() -> None:
    """connect() builds the client, starts it, and unblocks on the success lifecycle event."""
    adapter, holder = make_adapter()

    adapter.connect()

    assert holder["client"].started is True


def test_connect_raises_a_feed_connection_error_when_the_client_reports_failure() -> (
    None
):
    """A connection-failure lifecycle event surfaces as IoTConnectionError (and stops the client)."""
    adapter, holder = make_adapter(fail_with=RuntimeError("not authorized"))

    with pytest.raises(IoTConnectionError):
        adapter.connect()

    assert holder["client"].stopped is True


def test_subscribe_requests_exactly_the_keyed_topic_at_qos_1() -> None:
    """subscribe() sends a SubscribePacket for the consumer's key only, at QoS 1, no wildcard."""
    adapter, holder = make_adapter()
    adapter.connect()

    adapter.subscribe(TOPIC, 1, lambda **_: None)

    (packet,) = holder["client"].subscribe_packets
    (subscription,) = packet.subscriptions
    assert (subscription.topic_filter, subscription.qos) == (
        TOPIC,
        mqtt5.QoS.AT_LEAST_ONCE,
    )


def test_inbound_publish_is_translated_into_the_seam_callback() -> None:
    """An arriving publish maps to (topic, payload, headers-from-user-properties, packet_id)."""
    adapter, holder = make_adapter()
    adapter.connect()
    received: dict[str, Any] = {}
    adapter.subscribe(TOPIC, 1, lambda **kwargs: received.update(kwargs))

    holder["client"].deliver(
        topic=TOPIC,
        payload=WEBHOOK_BODY,
        user_properties=[
            SimpleNamespace(name="Linear-Event", value="AgentSessionEvent")
        ],
        handle=object(),
    )

    assert received["topic"] == TOPIC
    assert received["payload"] == WEBHOOK_BODY
    assert received["headers"] == {"Linear-Event": "AgentSessionEvent"}
    assert isinstance(received["packet_id"], int)


def test_puback_invokes_the_manual_ack_handle_acquired_for_that_publish() -> None:
    """puback() sends the manual acknowledgement for the handle taken when the publish arrived."""
    adapter, holder = make_adapter()
    adapter.connect()
    captured: dict[str, Any] = {}
    adapter.subscribe(TOPIC, 1, lambda **kwargs: captured.update(kwargs))
    handle = object()
    holder["client"].deliver(
        topic=TOPIC, payload=WEBHOOK_BODY, user_properties=[], handle=handle
    )

    adapter.puback(captured["packet_id"])

    assert holder["client"].acknowledged_handles == [handle]


def test_string_payload_is_coerced_to_bytes_for_signature_verification() -> None:
    """A text payload is surfaced as bytes so the body still HMAC-verifies."""
    adapter, holder = make_adapter()
    adapter.connect()
    received: dict[str, Any] = {}
    adapter.subscribe(TOPIC, 1, lambda **kwargs: received.update(kwargs))

    holder["client"].deliver(
        topic=TOPIC,
        payload=WEBHOOK_BODY.decode("utf-8"),
        user_properties=[],
        handle=object(),
    )

    assert received["payload"] == WEBHOOK_BODY


def test_disconnect_stops_the_client() -> None:
    """disconnect() stops the MQTT5 client (clean-stop / halt reconnects)."""
    adapter, holder = make_adapter()
    adapter.connect()

    adapter.disconnect()

    assert holder["client"].stopped is True


def test_region_is_parsed_from_an_ats_endpoint_when_not_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SigV4 region falls back to the region embedded in the ATS endpoint host."""
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)

    assert _region_for(ENDPOINT, None) == "us-east-1"
    assert _region_for(ENDPOINT, "eu-west-1") == "eu-west-1"


def test_client_id_is_derived_from_the_routing_key() -> None:
    """The MQTT client id is keyed off the routing key (with a uniqueness suffix)."""
    client_id = _client_id_for(ROUTING_KEY)

    assert client_id.startswith(f"cyrus-{ROUTING_KEY}-")
    assert len(client_id) <= 128


def test_build_default_iot_connection_returns_the_mqtt5_adapter_without_touching_aws() -> (
    None
):
    """The builder wraps a lazy factory in the adapter; no client is built until connect()."""
    connection = build_default_iot_connection(
        endpoint=ENDPOINT, routing_key=ROUTING_KEY, region="us-east-1"
    )

    assert isinstance(connection, _Mqtt5IoTConnection)
