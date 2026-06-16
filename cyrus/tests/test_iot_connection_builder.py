"""Contract test for the awscrt IoT connection adapter (DC-22 AC3).

``_AwsCrtIoTConnection`` is the thin translation layer between the feed's connection
seam (``connect`` / ``subscribe`` / ``disconnect`` / ``puback``) and an ``awscrt`` MQTT
connection: it forwards each seam call onto the awscrt connection (waiting on the
returned future) and turns awscrt's on-message callback into the ``(topic, payload,
headers, packet_id)`` shape the feed buffers. These tests pin that forwarding by
driving the adapter against a ``MagicMock`` connection and asserting the underlying
method fired — no live AWS, no patching of module globals.

``build_default_iot_connection`` itself is deliberately NOT tested here: it is pure
composition-root assembly of awscrt objects (the same category as
``ProxyExecutionLoop.run``, which the codebase leaves untested as glue), and its
SigV4 / no-X.509 property is structural — it calls
``mqtt_connection_builder.websockets_with_default_aws_signing``, which has no
certificate parameter. The no-cert / keyed-subscription intent is pinned at the feed
seam by ``test_iot_linear_webhook_feed.test_subscribes_only_to_own_topic_over_sigv4_websocket_without_certs``.

IF YOU'RE AN AGENT, READ THIS:
- The adapter only delegates, so verify it at the boundary: assert the underlying
  connection method was called. Never assert on a hand-rolled fake's own state — that
  tests the double, not the adapter.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import ANY, MagicMock

import pytest

pytest.importorskip(
    "awscrt", reason="awscrt provides the MQTT QoS enum the adapter maps"
)

from awscrt import mqtt  # noqa: E402

from webhook_feeds.iot_feed import _AwsCrtIoTConnection  # noqa: E402

ROUTING_KEY = "creator-9f2c-iot-consumer"
TOPIC = f"cyrus/v1/sessions/{ROUTING_KEY}"
WEBHOOK_BODY = b'{"type":"AgentSessionEvent","action":"created"}'


def make_connection() -> MagicMock:
    """A mock awscrt connection whose subscribe() returns the (future, packet_id) tuple."""
    connection = MagicMock()
    connection.subscribe.return_value = (MagicMock(), 1)
    return connection


def test_adapter_connect_opens_the_underlying_connection() -> None:
    """connect() forwards to the awscrt connection's connect()."""
    connection = make_connection()

    _AwsCrtIoTConnection(connection).connect()

    connection.connect.assert_called_once_with()


def test_adapter_subscribes_to_the_keyed_topic_at_qos_1() -> None:
    """subscribe() forwards to the connection for exactly the consumer's key at QoS 1."""
    connection = make_connection()

    _AwsCrtIoTConnection(connection).subscribe(TOPIC, 1, lambda **_: None)

    connection.subscribe.assert_called_once_with(
        topic=TOPIC, qos=mqtt.QoS(1), callback=ANY
    )


def test_adapter_translates_an_arriving_publish_into_the_seam_callback() -> None:
    """awscrt's on-message callback is mapped to (topic, payload, headers, packet_id).

    The forwarded Linear headers are sourced from MQTT user properties on the publish,
    and the raw payload bytes are passed through unchanged.
    """
    connection = make_connection()
    received: dict[str, Any] = {}
    _AwsCrtIoTConnection(connection).subscribe(
        TOPIC, 1, lambda **kwargs: received.update(kwargs)
    )
    on_crt_message = connection.subscribe.call_args.kwargs["callback"]

    on_crt_message(
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

    assert received == {
        "topic": TOPIC,
        "payload": WEBHOOK_BODY,
        "headers": {"Linear-Event": "AgentSessionEvent"},
        "packet_id": 7,
    }


def test_adapter_disconnect_closes_the_underlying_connection() -> None:
    """disconnect() forwards to the awscrt connection's disconnect() (clean-stop path)."""
    connection = make_connection()

    _AwsCrtIoTConnection(connection).disconnect()

    connection.disconnect.assert_called_once_with()


def test_puback_flags_the_manual_ack_integration_boundary() -> None:
    """Manual QoS-1 PUBACK needs the awscrt MQTT5 client; the adapter refuses to fake it.

    The at-least-once behaviour is unit-tested on the feed via the injected connection;
    here we pin that the awscrt seam does NOT silently ack on the wrong protocol.
    """
    with pytest.raises(NotImplementedError):
        _AwsCrtIoTConnection(make_connection()).puback(7)
