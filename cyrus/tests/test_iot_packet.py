"""Unit tests for :class:`IoTPacket` — the inbound-publish → seam translation.

``IoTPacket.from_publish_packet`` lifts an awscrt MQTT5 publish packet (duck-typed) into
the feed's seam shape: raw payload **bytes** (text coerced so the body still HMAC-
verifies) and the Linear headers from the MQTT5 user properties. ``to_on_message`` then
renders the seam callback kwargs, grafting on the synthetic ack id that belongs to the
registry, not the packet. These tests pin that translation with no mocks.
"""

from __future__ import annotations

from types import SimpleNamespace

from webhook_feeds.iot_feed import IoTPacket

TOPIC = "cyrus/v1/sessions/creator-9f2c-iot-consumer"
WEBHOOK_BODY = b'{"type":"AgentSessionEvent","action":"created"}'


def make_publish_packet(
    *, topic: str = TOPIC, payload: object = WEBHOOK_BODY, user_properties: object = None
) -> SimpleNamespace:
    """An awscrt-shaped MQTT5 PublishPacket with representative defaults."""
    return SimpleNamespace(
        topic=topic, payload=payload, user_properties=user_properties
    )


def test_from_publish_packet_maps_topic_bytes_payload_and_headers() -> None:
    """A bytes payload and user properties translate to topic/payload/headers verbatim."""
    packet = make_publish_packet(
        user_properties=[SimpleNamespace(name="Linear-Event", value="AgentSessionEvent")]
    )

    assert IoTPacket.from_publish_packet(packet) == IoTPacket(
        topic=TOPIC,
        payload=WEBHOOK_BODY,
        headers={"Linear-Event": "AgentSessionEvent"},
    )


def test_from_publish_packet_coerces_a_text_payload_to_bytes() -> None:
    """A text payload is surfaced as bytes so the body still HMAC-verifies."""
    packet = make_publish_packet(payload=WEBHOOK_BODY.decode("utf-8"))

    assert IoTPacket.from_publish_packet(packet).payload == WEBHOOK_BODY


def test_from_publish_packet_treats_absent_user_properties_as_no_headers() -> None:
    """A publish with no user properties yields an empty headers map."""
    packet = make_publish_packet(user_properties=None)

    assert IoTPacket.from_publish_packet(packet).headers == {}


def test_to_on_message_renders_the_seam_kwargs_with_the_given_packet_id() -> None:
    """to_on_message grafts the registry's packet id onto the seam callback kwargs."""
    packet = IoTPacket(topic=TOPIC, payload=WEBHOOK_BODY, headers={"H": "v"})

    assert packet.to_on_message(7) == {
        "topic": TOPIC,
        "payload": WEBHOOK_BODY,
        "headers": {"H": "v"},
        "packet_id": 7,
    }
