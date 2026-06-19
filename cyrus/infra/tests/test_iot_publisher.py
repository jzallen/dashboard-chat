"""Specification for the IoT Data-plane publisher.

The publisher pushes the byte-identical raw body to a per-identity topic over the
IoT Data-plane HTTPS Publish API (boto3 ``iot-data`` client) — no MQTT client in
the Lambda. The forwarded Linear headers travel with the message as MQTT5 **user
properties** so the consumer feed reconstructs the headers the body was signed with
and the forwarded body verifies end-to-end; the publish is at **QoS 1** so the
broker holds it for the consumer's manual acknowledgement.

``publish`` is a fire-and-forget side-effect whose return value is ignored, so the
call arguments are asserted directly with a ``MagicMock``. The real botocore
``iot-data`` request serialization is exercised through the Stubber-based handler
dual-write tests.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. ``publish`` calls the
``iot-data`` client's ``publish`` with the raw body, QoS 1, and the forwarded headers
as user properties. Do not weaken the payload byte-identity check.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from conftest import CREATOR_ID, TOPIC_PREFIX

import iot_publisher

_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Linear-Event": "AgentSessionEvent",
    "Linear-Delivery": "d-123",
    "Linear-Signature": "deadbeef",
    "User-Agent": "Linear-Webhook",
}


def test_publishes_byte_identical_payload_at_qos_1_to_the_topic():
    client = MagicMock()
    body = b'{"agentSession":{"creator":{"id":"user-xyz"}}}'
    topic = f"{TOPIC_PREFIX}{CREATOR_ID}"

    iot_publisher.publish(client, topic=topic, body=body, headers=_HEADERS)

    client.publish.assert_called_once_with(
        topic=topic,
        qos=1,
        payload=body,
        userProperties=json.dumps([{name: value} for name, value in _HEADERS.items()]),
    )


def test_forwarded_headers_travel_as_user_properties_for_end_to_end_verification():
    """The Linear-Signature header rides the IoT wire so the consumer can verify the body."""
    client = MagicMock()
    body = b'{"agentSession":{"creator":{"id":"user-xyz"}}}'

    iot_publisher.publish(
        client, topic="cyrus/v1/sessions/user-xyz", body=body, headers=_HEADERS
    )

    user_properties = json.loads(client.publish.call_args.kwargs["userProperties"])
    carried = {
        name: value for entry in user_properties for name, value in entry.items()
    }
    assert carried["Linear-Signature"] == "deadbeef"
    assert carried == dict(_HEADERS)
