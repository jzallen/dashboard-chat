"""Contract test for the awscrt **MQTT5** IoT connection adapter.

``build_default_iot_connection`` is the public seam: it resolves the SigV4 signing
region and a keyed client id, then returns a :class:`_Mqtt5IoTConnection` that lazily
builds an awscrt MQTT5 client (via ``websockets_with_default_aws_signing``) on the
first ``connect()``. These tests drive that public builder, injecting a mock
``mqtt5_client_builder`` so no client is built until ``connect()`` and no AWS is
touched.

The adapter is the thin translation layer between the feed's connection seam
(``connect`` / ``subscribe`` / ``disconnect`` / ``puback``) and the MQTT5 client. It
forwards each seam call onto the client, blocks ``connect()`` on the first lifecycle
outcome, maps an inbound publish onto the feed's ``(topic, payload, headers,
packet_id)`` callback, and — the reason MQTT5 is required — takes **manual control** of
each QoS 1 acknowledgement so the PUBACK fires only when the feed acknowledges after a
clean forward.

The adapter only delegates, so verify it at the boundary: assert the underlying mock
client method fired (start/subscribe/invoke_publish_acknowledgement/stop) with the
intended arguments and that an inbound publish reaches the seam callback. The private
region/client-id derivation is pinned through the builder's signing call, not by
importing the helpers.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Optional
from unittest.mock import MagicMock

import pytest

pytest.importorskip("awscrt", reason="awscrt provides the MQTT5 SubscribePacket/QoS")

from awscrt import mqtt5  # noqa: E402

from webhook_feeds.iot_feed import (  # noqa: E402
    IoTConnectionError,
    _Mqtt5IoTConnection,
    build_default_iot_connection,
)

ROUTING_KEY = "creator-9f2c-iot-consumer"
ENDPOINT = "a3k7example-ats.iot.us-east-1.amazonaws.com"
TOPIC = f"cyrus/v1/sessions/{ROUTING_KEY}"
WEBHOOK_BODY = b'{"type":"AgentSessionEvent","action":"created"}'


def make_connection(
    *,
    region: Optional[str] = "us-east-1",
    fail_with: Optional[Exception] = None,
) -> tuple[_Mqtt5IoTConnection, MagicMock]:
    """Build the connection through the public builder with a mock MQTT5 client builder.

    Returns ``(connection, builder)`` where ``builder`` is the injected
    ``mqtt5_client_builder`` stand-in. Its ``websockets_with_default_aws_signing``
    return value is the mock client the adapter drives; ``client.start()`` synchronously
    fires the configured lifecycle event (success by default) using the callbacks the
    builder was called with, which is how ``connect()`` unblocks without real threads.
    """
    builder = MagicMock()
    client = builder.websockets_with_default_aws_signing.return_value

    def start() -> None:
        callbacks = builder.websockets_with_default_aws_signing.call_args.kwargs
        if fail_with is not None:
            callbacks["on_lifecycle_event_connection_failure_fn"](
                SimpleNamespace(exception=fail_with)
            )
        else:
            callbacks["on_lifecycle_event_connection_success_fn"](SimpleNamespace())

    client.start.side_effect = start

    connection = build_default_iot_connection(
        endpoint=ENDPOINT,
        routing_key=ROUTING_KEY,
        region=region,
        mqtt5_client_builder=builder,
    )
    return connection, builder


def signing_kwargs(builder: MagicMock) -> dict[str, Any]:
    """The kwargs the adapter passed to ``websockets_with_default_aws_signing``."""
    return builder.websockets_with_default_aws_signing.call_args.kwargs


def deliver(
    builder: MagicMock,
    *,
    topic: str,
    payload: Any,
    user_properties: list,
    handle: Any,
) -> None:
    """Push an inbound publish through the on-publish callback the builder was given."""
    on_publish = signing_kwargs(builder)["on_publish_callback_fn"]
    packet = SimpleNamespace(
        topic=topic, payload=payload, user_properties=user_properties
    )
    data = SimpleNamespace(
        publish_packet=packet,
        acquire_publish_acknowledgement_control=lambda: handle,
    )
    on_publish(data)


def test_build_default_iot_connection_returns_the_adapter_without_touching_aws() -> None:
    """The builder wraps a lazy factory in the adapter; no client is built until connect()."""
    connection, builder = make_connection()

    assert isinstance(connection, _Mqtt5IoTConnection)
    builder.websockets_with_default_aws_signing.assert_not_called()


def test_connect_signs_with_the_resolved_region_and_keyed_client_id() -> None:
    """connect() builds the client by SigV4-signing for the endpoint/region/keyed id."""
    connection, builder = make_connection(region="us-east-1")

    connection.connect()

    kwargs = signing_kwargs(builder)
    assert kwargs["endpoint"] == ENDPOINT
    assert kwargs["region"] == "us-east-1"
    assert kwargs["client_id"].startswith(f"cyrus-{ROUTING_KEY}-")
    assert len(kwargs["client_id"]) <= 128
    builder.websockets_with_default_aws_signing.return_value.start.assert_called_once()


def test_connect_falls_back_to_the_region_embedded_in_the_ats_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no explicit region or env, SigV4 signs for the region in the ATS endpoint host."""
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)
    connection, builder = make_connection(region=None)

    connection.connect()

    assert signing_kwargs(builder)["region"] == "us-east-1"


def test_connect_raises_a_feed_connection_error_when_the_client_reports_failure() -> (
    None
):
    """A connection-failure lifecycle event surfaces as IoTConnectionError (and stops the client)."""
    connection, builder = make_connection(fail_with=RuntimeError("not authorized"))

    with pytest.raises(IoTConnectionError):
        connection.connect()

    builder.websockets_with_default_aws_signing.return_value.stop.assert_called_once()


def test_subscribe_requests_exactly_the_keyed_topic_at_qos_1() -> None:
    """subscribe() sends a SubscribePacket for the consumer's key only, at QoS 1, no wildcard."""
    connection, builder = make_connection()
    connection.connect()

    connection.subscribe(TOPIC, 1, lambda **_: None)

    client = builder.websockets_with_default_aws_signing.return_value
    packet = client.subscribe.call_args.kwargs["subscribe_packet"]
    (subscription,) = packet.subscriptions
    assert (subscription.topic_filter, subscription.qos) == (
        TOPIC,
        mqtt5.QoS.AT_LEAST_ONCE,
    )


def test_inbound_publish_is_translated_into_the_seam_callback() -> None:
    """An arriving publish maps to (topic, payload, headers-from-user-properties, packet_id)."""
    connection, builder = make_connection()
    connection.connect()
    received: dict[str, Any] = {}
    connection.subscribe(TOPIC, 1, lambda **kwargs: received.update(kwargs))

    deliver(
        builder,
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
    connection, builder = make_connection()
    connection.connect()
    captured: dict[str, Any] = {}
    connection.subscribe(TOPIC, 1, lambda **kwargs: captured.update(kwargs))
    handle = object()
    deliver(
        builder, topic=TOPIC, payload=WEBHOOK_BODY, user_properties=[], handle=handle
    )

    connection.puback(captured["packet_id"])

    client = builder.websockets_with_default_aws_signing.return_value
    client.invoke_publish_acknowledgement.assert_called_once_with(handle)


def test_string_payload_is_coerced_to_bytes_for_signature_verification() -> None:
    """A text payload is surfaced as bytes so the body still HMAC-verifies."""
    connection, builder = make_connection()
    connection.connect()
    received: dict[str, Any] = {}
    connection.subscribe(TOPIC, 1, lambda **kwargs: received.update(kwargs))

    deliver(
        builder,
        topic=TOPIC,
        payload=WEBHOOK_BODY.decode("utf-8"),
        user_properties=[],
        handle=object(),
    )

    assert received["payload"] == WEBHOOK_BODY


def test_disconnect_stops_the_client() -> None:
    """disconnect() stops the MQTT5 client (clean-stop / halt reconnects)."""
    connection, builder = make_connection()
    connection.connect()

    connection.disconnect()

    builder.websockets_with_default_aws_signing.return_value.stop.assert_called_once()
