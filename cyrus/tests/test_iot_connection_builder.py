"""Contract test for the awscrt IoT connection adapter (DC-22 AC3).

``_AwsCrtIoTConnection`` is the thin translation layer between the feed's connection
seam (``connect`` / ``subscribe`` / ``disconnect`` / ``puback``) and an ``awscrt`` MQTT
connection: it maps the seam's QoS-1 keyed subscription onto awscrt's futures-based
API and turns awscrt's on-message callback into the ``(topic, payload, headers,
packet_id)`` shape the feed buffers. That translation is what these tests pin, by
driving the adapter against a *fake* awscrt connection — no live AWS, no patching of
module globals.

``build_default_iot_connection`` itself is deliberately NOT tested here: it is pure
composition-root assembly of awscrt objects (the same category as
``ProxyExecutionLoop.run``, which the codebase leaves untested as glue), and its
SigV4 / no-X.509 property is structural — it calls
``mqtt_connection_builder.websockets_with_default_aws_signing``, which has no
certificate parameter. The no-cert / keyed-subscription intent is pinned at the feed
seam by ``test_iot_linear_webhook_feed.test_subscribes_only_to_own_topic_over_sigv4_websocket_without_certs``.

IF YOU'RE AN AGENT, READ THIS:
- Drive the adapter through an injected fake; never patch awscrt/awsiot module globals
  to make assertions — that re-states the implementation instead of testing behaviour.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

pytest.importorskip(
    "awscrt", reason="awscrt provides the MQTT QoS enum the adapter maps"
)

from webhook_feeds.iot_feed import _AwsCrtIoTConnection  # noqa: E402

ROUTING_KEY = "creator-9f2c-iot-consumer"
TOPIC = f"cyrus/v1/sessions/{ROUTING_KEY}"
WEBHOOK_BODY = b'{"type":"AgentSessionEvent","action":"created"}'


class _DoneFuture:
    """An awscrt operation future that has already resolved (``.result()`` no-ops)."""

    def result(self) -> None:
        return None


class FakeCrtConnection:
    """In-memory stand-in for an ``awscrt`` MQTT connection (no AWS).

    Records lifecycle calls and captures the awscrt on-message callback the adapter
    registers, so a test can fire a publish at it and observe the translated seam
    callback.
    """

    def __init__(self) -> None:
        self.connected = False
        self.disconnected = False
        self.subscribed: list[tuple[str, int]] = []
        self.crt_callback: Any = None

    def connect(self) -> _DoneFuture:
        self.connected = True
        return _DoneFuture()

    def subscribe(
        self, *, topic: str, qos: Any, callback: Any
    ) -> tuple[_DoneFuture, int]:
        self.subscribed.append((topic, int(qos)))
        self.crt_callback = callback
        return _DoneFuture(), 1

    def disconnect(self) -> _DoneFuture:
        self.disconnected = True
        return _DoneFuture()


def test_adapter_connects_and_subscribes_to_the_keyed_topic_at_qos_1() -> None:
    """connect()/subscribe() drive the awscrt connection for the consumer's own key only."""
    crt = FakeCrtConnection()
    adapter = _AwsCrtIoTConnection(crt)

    adapter.connect()
    adapter.subscribe(TOPIC, 1, lambda **_: None)

    assert crt.connected is True
    assert crt.subscribed == [(TOPIC, 1)]


def test_adapter_translates_an_arriving_publish_into_the_seam_callback() -> None:
    """awscrt's on-message callback is mapped to (topic, payload, headers, packet_id).

    The forwarded Linear headers are sourced from MQTT user properties on the publish,
    and the raw payload bytes are passed through unchanged.
    """
    crt = FakeCrtConnection()
    adapter = _AwsCrtIoTConnection(crt)
    received: dict[str, Any] = {}
    adapter.subscribe(TOPIC, 1, lambda **kwargs: received.update(kwargs))

    crt.crt_callback(
        topic=TOPIC,
        payload=WEBHOOK_BODY,
        dup=False,
        qos=1,
        retain=False,
        user_properties=[
            SimpleNamespace(name="Linear-Event", value="AgentSessionEvent")
        ],
        packet_id=7,
    )

    assert received["topic"] == TOPIC
    assert received["payload"] == WEBHOOK_BODY
    assert received["headers"] == {"Linear-Event": "AgentSessionEvent"}
    assert received["packet_id"] == 7


def test_adapter_disconnects_cleanly() -> None:
    """disconnect() tears the awscrt connection down (the feed's clean-stop path)."""
    crt = FakeCrtConnection()
    adapter = _AwsCrtIoTConnection(crt)

    adapter.disconnect()

    assert crt.disconnected is True


def test_puback_flags_the_manual_ack_integration_boundary() -> None:
    """Manual QoS-1 PUBACK needs the awscrt MQTT5 client; the adapter refuses to fake it.

    The at-least-once behaviour is unit-tested on the feed via the injected connection;
    here we pin that the awscrt seam does NOT silently ack on the wrong protocol.
    """
    adapter = _AwsCrtIoTConnection(FakeCrtConnection())

    with pytest.raises(NotImplementedError):
        adapter.puback(7)
