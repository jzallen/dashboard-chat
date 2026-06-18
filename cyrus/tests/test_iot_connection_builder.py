"""Contract test for the awscrt **MQTT5** IoT connection adapter.

``build_default_iot_connection`` is the public seam: given a validated
:class:`IoTConfig` it returns a :class:`_Mqtt5IoTConnection` that lazily builds an
awscrt MQTT5 client (via ``websockets_with_default_aws_signing``) on the first
``connect()``. These tests drive that public builder, injecting a mock
``mqtt5_client_builder`` so no client is built until ``connect()`` and no AWS is
touched. How the config itself resolves region/client-id is pinned separately in
``test_iot_config.py``; here we assert the builder forwards the config's values into
the signing call.

The adapter is the thin translation layer between the feed's connection seam
(``connect`` / ``subscribe`` / ``disconnect`` / ``puback``) and the MQTT5 client. The
client invokes the adapter's handlers — the inbound-publish callback and the
connection-success / connection-failure lifecycle callbacks — that ``connect()``
registers at build time. We first pin that those handlers are the functions registered
with the client, then test each handler's effect by calling it directly (the awscrt
client is what calls it in production), so the tests exercise the real handler rather
than a fake's recorded callback.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

pytest.importorskip("awscrt", reason="awscrt provides the MQTT5 SubscribePacket/QoS")

from awscrt import mqtt5  # noqa: E402

from webhook_feeds.iot_feed import (  # noqa: E402
    IoTConfig,
    IoTConnectionError,
    _Mqtt5IoTConnection,
    build_default_iot_connection,
)

ROUTING_KEY = "creator-9f2c-iot-consumer"
ENDPOINT = "a3k7example-ats.iot.us-east-1.amazonaws.com"
REGION = "us-east-1"
TOPIC = f"cyrus/v1/sessions/{ROUTING_KEY}"
WEBHOOK_BODY = b'{"type":"AgentSessionEvent","action":"created"}'


def make_connection() -> tuple[_Mqtt5IoTConnection, IoTConfig, MagicMock]:
    """Build the connection through the public builder with a mock MQTT5 client builder.

    Returns ``(connection, config, builder)`` where ``builder`` is the injected
    ``mqtt5_client_builder`` stand-in and ``builder.websockets_with_default_aws_signing``
    returns the mock client the adapter drives. The client does nothing on its own; a
    test wires ``client.start`` to a lifecycle handler when it wants ``connect()`` to
    unblock.
    """
    builder = MagicMock()
    config = IoTConfig(endpoint=ENDPOINT, routing_key=ROUTING_KEY, region=REGION)
    connection = build_default_iot_connection(config, mqtt5_client_builder=builder)
    return connection, config, builder


def connect_succeeding(
    connection: _Mqtt5IoTConnection, builder: MagicMock
) -> MagicMock:
    """Call ``connect()`` and let it succeed, returning the mock client.

    In production awscrt fires the connection-success lifecycle event once the broker
    accepts the handshake; that event is what unblocks ``connect()``. We model it by
    having the mock client's ``start()`` invoke the adapter's success handler.
    """
    client = builder.websockets_with_default_aws_signing.return_value
    client.start.side_effect = lambda: connection._handle_connection_success(
        SimpleNamespace()
    )
    connection.connect()
    return client


def get_factory_call_args_from(builder: MagicMock) -> dict[str, Any]:
    """The kwargs the adapter passed to ``websockets_with_default_aws_signing``."""
    return builder.websockets_with_default_aws_signing.call_args.kwargs


def publish_received_data(
    *, topic: str, payload: Any, user_properties: list, handle: Any
) -> SimpleNamespace:
    """An awscrt-shaped ``PublishReceivedData`` for the adapter's publish handler."""
    return SimpleNamespace(
        publish_packet=SimpleNamespace(
            topic=topic, payload=payload, user_properties=user_properties
        ),
        acquire_publish_acknowledgement_control=lambda: handle,
    )


def test_build_default_iot_connection_returns_the_adapter_without_touching_aws() -> None:
    """The builder wraps a lazy factory in the adapter; no client is built until connect()."""
    connection, _config, builder = make_connection()

    assert isinstance(connection, _Mqtt5IoTConnection)
    builder.websockets_with_default_aws_signing.assert_not_called()


def test_connect_registers_the_adapters_handlers_as_the_clients_callbacks() -> None:
    """connect() builds the client with the adapter's publish/lifecycle handlers as callbacks."""
    connection, _config, builder = make_connection()

    connect_succeeding(connection, builder)

    kwargs = get_factory_call_args_from(builder)
    assert kwargs["on_publish_callback_fn"] == connection._handle_publish
    assert (
        kwargs["on_lifecycle_event_connection_success_fn"]
        == connection._handle_connection_success
    )
    assert (
        kwargs["on_lifecycle_event_connection_failure_fn"]
        == connection._handle_connection_failure
    )


def test_connect_signs_with_the_configs_region_and_client_id() -> None:
    """connect() builds the client by SigV4-signing for the config's endpoint/region/client-id."""
    connection, config, builder = make_connection()

    connect_succeeding(connection, builder)

    kwargs = get_factory_call_args_from(builder)
    assert kwargs["endpoint"] == config.endpoint
    assert kwargs["region"] == config.region
    assert kwargs["client_id"] == config.client_id


def test_connect_returns_once_the_client_reports_connection_success() -> None:
    """The connection-success lifecycle handler unblocks connect(), which returns cleanly."""
    connection, _config, builder = make_connection()

    client = connect_succeeding(connection, builder)

    client.start.assert_called_once()


def test_connect_raises_a_feed_connection_error_when_the_client_reports_failure() -> (
    None
):
    """The connection-failure lifecycle handler makes connect() raise and stop the client."""
    connection, _config, builder = make_connection()
    client = builder.websockets_with_default_aws_signing.return_value
    # In production awscrt fires the connection-failure lifecycle event when the broker
    # rejects the handshake; that is what makes connect() give up.
    client.start.side_effect = lambda: connection._handle_connection_failure(
        SimpleNamespace(exception=RuntimeError("not authorized"))
    )

    with pytest.raises(IoTConnectionError):
        connection.connect()

    client.stop.assert_called_once()


def test_subscribe_requests_exactly_the_keyed_topic_at_qos_1() -> None:
    """subscribe() sends a SubscribePacket for the consumer's key only, at QoS 1, no wildcard."""
    connection, _config, builder = make_connection()
    client = connect_succeeding(connection, builder)

    connection.subscribe(TOPIC, 1, lambda **_: None)

    packet = client.subscribe.call_args.kwargs["subscribe_packet"]
    (subscription,) = packet.subscriptions
    assert (subscription.topic_filter, subscription.qos) == (
        TOPIC,
        mqtt5.QoS.AT_LEAST_ONCE,
    )


def test_inbound_publish_reaches_the_seam_callback_as_topic_payload_headers_packet_id() -> (
    None
):
    """A handled publish forwards (topic, payload, headers-from-user-properties, packet_id)."""
    connection, _config, builder = make_connection()
    connect_succeeding(connection, builder)
    received: dict[str, Any] = {}
    connection.subscribe(TOPIC, 1, lambda **kwargs: received.update(kwargs))

    # In production the awscrt client invokes this when a PUBLISH arrives on the topic.
    connection._handle_publish(
        publish_received_data(
            topic=TOPIC,
            payload=WEBHOOK_BODY,
            user_properties=[
                SimpleNamespace(name="Linear-Event", value="AgentSessionEvent")
            ],
            handle=object(),
        )
    )

    assert received["topic"] == TOPIC
    assert received["payload"] == WEBHOOK_BODY
    assert received["headers"] == {"Linear-Event": "AgentSessionEvent"}
    assert isinstance(received["packet_id"], int)


def test_inbound_string_payload_reaches_the_seam_callback_as_bytes() -> None:
    """A text payload is surfaced as bytes so the body still HMAC-verifies."""
    connection, _config, builder = make_connection()
    connect_succeeding(connection, builder)
    received: dict[str, Any] = {}
    connection.subscribe(TOPIC, 1, lambda **kwargs: received.update(kwargs))

    # In production the awscrt client invokes this when a PUBLISH arrives on the topic.
    connection._handle_publish(
        publish_received_data(
            topic=TOPIC,
            payload=WEBHOOK_BODY.decode("utf-8"),
            user_properties=[],
            handle=object(),
        )
    )

    assert received["payload"] == WEBHOOK_BODY


def test_puback_sends_the_manual_ack_for_the_handle_taken_when_the_publish_arrived() -> (
    None
):
    """puback() invokes the acknowledgement-control handle acquired for that publish."""
    connection, _config, builder = make_connection()
    client = connect_succeeding(connection, builder)
    captured: dict[str, Any] = {}
    connection.subscribe(TOPIC, 1, lambda **kwargs: captured.update(kwargs))
    handle = object()
    # In production the awscrt client invokes this when a PUBLISH arrives on the topic.
    connection._handle_publish(
        publish_received_data(
            topic=TOPIC, payload=WEBHOOK_BODY, user_properties=[], handle=handle
        )
    )

    connection.puback(captured["packet_id"])

    client.invoke_publish_acknowledgement.assert_called_once_with(handle)


def test_disconnect_stops_the_client() -> None:
    """disconnect() stops the MQTT5 client (clean-stop / halt reconnects)."""
    connection, _config, builder = make_connection()
    client = connect_succeeding(connection, builder)

    connection.disconnect()

    client.stop.assert_called_once()
