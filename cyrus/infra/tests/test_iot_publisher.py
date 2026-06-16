"""Specification for the IoT Data-plane publisher.

The publisher pushes the byte-identical raw body to a per-identity topic over the
IoT Data-plane HTTPS Publish API (boto3 ``iot-data`` client) — no MQTT client in
the Lambda. The forwarded Linear headers ride along so the IoT leg carries the
same metadata as the SQS leg.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. ``publish`` calls the
``iot-data`` client's ``publish`` with the raw body. Do not weaken the payload
byte-identity check.
"""

from __future__ import annotations

from conftest import CREATOR_ID, TOPIC_PREFIX, stubbed_iot  # noqa: F401 — fixture

import iot_publisher

_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Linear-Event": "AgentSessionEvent",
    "Linear-Delivery": "d-123",
    "Linear-Signature": "deadbeef",
    "User-Agent": "Linear-Webhook",
}


def test_publishes_byte_identical_payload_to_the_topic(stubbed_iot):
    client, stubber = stubbed_iot
    body = b'{"agentSession":{"creator":{"id":"user-xyz"}}}'
    topic = f"{TOPIC_PREFIX}{CREATOR_ID}"

    stubber.add_response("publish", {}, {"topic": topic, "payload": body})
    stubber.activate()

    iot_publisher.publish(client, topic=topic, body=body, headers=_HEADERS)

    stubber.assert_no_pending_responses()
