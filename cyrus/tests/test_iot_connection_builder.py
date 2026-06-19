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

The awscrt MQTT5 client has no ``botocore``-style Stubber, so it is faked with a
``MagicMock`` injected at the builder boundary: the adapter only delegates, so each test
verifies a side-effect at that boundary (``assert_called_once_with`` / recorded call
args) — the deliberate looseness of a bare mock is acceptable for these fire-and-forget
delegations.
"""

from __future__ import annotations

from functools import partial
from types import SimpleNamespace
from typing import Any
from unittest.mock import ANY, MagicMock

import pytest

pytest.importorskip("awscrt", reason="awscrt provides the MQTT5 SubscribePacket/QoS")

from awscrt import mqtt5  # noqa: E402

from webhook_feeds.iot_feed import (  # noqa: E402
    ConnectionState,
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


def get_factory_call_args_from(builder: MagicMock) -> dict[str, Any]:
    """The kwargs the adapter passed to ``websockets_with_default_aws_signing``."""
    return builder.websockets_with_default_aws_signing.call_args.kwargs


def test_build_default_iot_connection_returns_the_mqtt5_adapter() -> None:
    """The builder returns the MQTT5 connection adapter."""
    connection, _config, _builder = make_connection()

    assert isinstance(connection, _Mqtt5IoTConnection)


def test_build_default_iot_connection_does_not_build_the_client_until_connect() -> None:
    """The factory is lazy: no awscrt client is built (no AWS touched) before connect()."""
    _connection, _config, builder = make_connection()

    builder.websockets_with_default_aws_signing.assert_not_called()


def test_connect_signs_with_the_configs_endpoint_region_and_client_id() -> None:
    """connect() calls the signing factory with exactly the full client config."""
    # Arrange
    connection, config, builder = make_connection()
    client = builder.websockets_with_default_aws_signing.return_value
    # assuming successful connection; the aws client triggers this callback in
    # production, which releases connection._connected
    callback = partial(connection._handle_connection_success, _data=SimpleNamespace())
    client.start.side_effect = callback

    # Act
    connection.connect()

    # Assert
    # The callbacks are the adapter's own _handle_* methods, registered at build time —
    # they are never None. The seam callback they route to (connection._on_message) is
    # what stays None until connection.subscribe(), which this test never calls.
    # credentials_provider is the default-chain object, matched by ANY.
    kwargs = get_factory_call_args_from(builder)
    assert kwargs == {
        "endpoint": config.endpoint,
        "region": config.region,
        "credentials_provider": ANY,
        "client_id": config.client_id,
        "on_publish_callback_fn": connection._handle_publish,
        "on_lifecycle_event_connection_success_fn": connection._handle_connection_success,
        "on_lifecycle_event_connection_failure_fn": connection._handle_connection_failure,
    }


def test_connect__failed_connect_on_start__raises_iot_connection_error() -> None:
    """A client that errors on start() surfaces as IoTConnectionError, not the raw error."""
    # Arrange
    connection, _config, builder = make_connection()
    client = builder.websockets_with_default_aws_signing.return_value
    client.start.side_effect = RuntimeError("network unreachable")

    # Act / Assert
    with pytest.raises(IoTConnectionError):
        connection.connect()


def test_connect__handled_success_connect_on_start__frees_connected_lock_with_no_error() -> (
    None
):
    """The connection-success lifecycle handler frees the connected lock with no error."""
    # Arrange
    connection, _config, builder = make_connection()
    client = builder.websockets_with_default_aws_signing.return_value
    # assuming successful connection; the aws client triggers this callback in
    # production, which releases connection._connected
    callback = partial(connection._handle_connection_success, _data=SimpleNamespace())
    client.start.side_effect = callback

    # Act
    connection.connect()

    # Assert
    assert connection.state == ConnectionState.CONNECTED


def test_connect_stops_the_client_when_the_connection_fails() -> None:
    """A failed connect() stops the client so it does not keep trying to reconnect."""
    # Arrange
    connection, _config, builder = make_connection()
    client = builder.websockets_with_default_aws_signing.return_value
    # In production the aws client triggers this callback when the broker rejects the
    # handshake, which releases connection._connected with an error recorded.
    callback = partial(
        connection._handle_connection_failure,
        data=SimpleNamespace(exception=RuntimeError("not authorized")),
    )
    client.start.side_effect = callback

    # Act
    with pytest.raises(IoTConnectionError):
        connection.connect()

    # Assert
    client.stop.assert_called_once()


def test_subscribe_requests_exactly_the_keyed_topic_at_qos_1() -> None:
    """subscribe() sends a SubscribePacket for the consumer's key only, at QoS 1, no wildcard."""
    # Arrange
    connection, _config, builder = make_connection()
    client = builder.websockets_with_default_aws_signing.return_value
    # assuming successful connection; the aws client triggers this callback in
    # production, which releases connection._connected
    callback = partial(connection._handle_connection_success, _data=SimpleNamespace())
    client.start.side_effect = callback
    connection.connect()

    # Act
    connection.subscribe(TOPIC, 1, lambda **_: None)

    # Assert
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
    # Arrange
    connection, _config, _builder = make_connection()
    received: dict[str, Any] = {}
    # subscribe() wires this seam callback in production; set it directly, since
    # _handle_publish needs only the seam callback — not a live connection.
    connection._on_message = lambda **kwargs: received.update(kwargs)
    # The awscrt client hands _handle_publish a PublishReceivedData: the publish packet
    # plus a factory that takes manual-ack control and returns the handle.
    publish = SimpleNamespace(
        publish_packet=SimpleNamespace(
            topic=TOPIC,
            payload=WEBHOOK_BODY,
            user_properties=[
                SimpleNamespace(name="Linear-Event", value="AgentSessionEvent")
            ],
        ),
        acquire_publish_acknowledgement_control=lambda: object(),
    )

    # Act
    # In production the aws client triggers this callback when a PUBLISH arrives.
    connection._handle_publish(publish)

    # Assert
    assert received == {
        "topic": TOPIC,
        "payload": WEBHOOK_BODY,
        "headers": {"Linear-Event": "AgentSessionEvent"},
        "packet_id": 1,
    }


def test_inbound_string_payload_reaches_the_seam_callback_as_bytes() -> None:
    """A text payload is surfaced as bytes so the body still HMAC-verifies."""
    # Arrange
    connection, _config, _builder = make_connection()
    received: dict[str, Any] = {}
    # subscribe() wires this seam callback in production; set it directly, since
    # _handle_publish needs only the seam callback — not a live connection.
    connection._on_message = lambda **kwargs: received.update(kwargs)
    publish = SimpleNamespace(
        publish_packet=SimpleNamespace(
            topic=TOPIC,
            payload=WEBHOOK_BODY.decode("utf-8"),
            user_properties=[],
        ),
        acquire_publish_acknowledgement_control=lambda: object(),
    )

    # Act
    # In production the aws client triggers this callback when a PUBLISH arrives.
    connection._handle_publish(publish)

    # Assert
    assert received["payload"] == WEBHOOK_BODY


def test_puback_sends_the_manual_ack_for_the_handle_taken_when_the_publish_arrived() -> (
    None
):
    """puback() invokes the acknowledgement-control handle acquired for that publish."""
    # Arrange
    connection, _config, builder = make_connection()
    client = builder.websockets_with_default_aws_signing.return_value
    # puback() calls invoke_publish_acknowledgement on the client; wire it directly,
    # since neither it nor _handle_publish needs the connect lifecycle.
    connection._client = client
    captured: dict[str, Any] = {}
    connection._on_message = lambda **kwargs: captured.update(kwargs)
    handle = object()
    publish = SimpleNamespace(
        publish_packet=SimpleNamespace(
            topic=TOPIC, payload=WEBHOOK_BODY, user_properties=[]
        ),
        acquire_publish_acknowledgement_control=lambda: handle,
    )
    # _handle_publish registers the handle and exposes its synthetic packet id.
    connection._handle_publish(publish)

    # Act
    connection.puback(captured["packet_id"])

    # Assert
    client.invoke_publish_acknowledgement.assert_called_once_with(handle)


def test_disconnect_stops_the_client() -> None:
    """disconnect() stops the MQTT5 client (clean-stop / halt reconnects)."""
    # Arrange
    connection, _config, builder = make_connection()
    client = builder.websockets_with_default_aws_signing.return_value
    # assuming successful connection; the aws client triggers this callback in
    # production, which releases connection._connected
    callback = partial(connection._handle_connection_success, _data=SimpleNamespace())
    client.start.side_effect = callback
    connection.connect()

    # Act
    connection.disconnect()

    # Assert
    client.stop.assert_called_once()
