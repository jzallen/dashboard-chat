"""Specification for the IoT Data-plane publisher.

The publisher pushes the byte-identical raw body to a per-identity topic over the
IoT Data-plane HTTPS Publish API (boto3 ``iot-data`` client) — no MQTT client in
the Lambda. The forwarded Linear headers are accepted for caller symmetry but are
NOT sent on the Data-plane publish; the SQS leg carries them as MessageAttributes.

``publish`` is a fire-and-forget side-effect whose return value is ignored, so the
call arguments are asserted directly with a ``MagicMock``. The real botocore
``iot-data`` request serialization is exercised through the Stubber-based handler
dual-write tests.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. ``publish`` calls the
``iot-data`` client's ``publish`` with the raw body. Do not weaken the payload
byte-identity check.
"""

from __future__ import annotations

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


def test_publishes_byte_identical_payload_to_the_topic():
    client = MagicMock()
    body = b'{"agentSession":{"creator":{"id":"user-xyz"}}}'
    topic = f"{TOPIC_PREFIX}{CREATOR_ID}"

    iot_publisher.publish(client, topic=topic, body=body, headers=_HEADERS)

    # Raw bytes forwarded unchanged as payload; headers are NOT sent on this leg.
    client.publish.assert_called_once_with(topic=topic, payload=body)
