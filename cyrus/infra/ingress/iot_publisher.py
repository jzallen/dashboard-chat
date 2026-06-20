"""IoT Data-plane publisher for the dual-write ingress.

The ingress Lambda publishes every verified webhook to a per-identity AWS IoT
topic (``cyrus/v1/sessions/{key}``) over the IoT **Data-plane HTTPS Publish API**
— ``boto3.client("iot-data").publish(...)`` — so there is NO MQTT client in the
Lambda. This sits beside the existing SQS enqueue: the IoT publish proves identity
routing while SQS keeps the live single-consumer path intact, so a failed publish
must never take down the SQS enqueue.

OPAQUENESS CONTRACT: the ``body`` published here is the original raw request
bytes, byte-identical to what was HMAC-verified and enqueued to SQS. This module
never re-serializes or mutates the body.

HEADER TRANSPORT: the forwarded Linear headers (including ``Linear-Signature``)
travel with the message as **MQTT5 user properties**, so the IoT consumer feed
reconstructs the exact headers the body was signed with and the forwarded body
verifies at Cyrus end-to-end — no longer only on the SQS leg. The publish is at
**QoS 1** so the broker holds it for the consumer's manual acknowledgement (the
at-least-once contract the consumer feed relies on).
"""

from __future__ import annotations

import json
from typing import Any, Mapping

# MQTT QoS 1 (at-least-once): the broker holds the message until the subscriber's
# PUBACK, matching the consumer feed's manual-ack at-least-once contract.
_QOS_AT_LEAST_ONCE = 1


def _user_properties(headers: Mapping[str, str]) -> str:
    """Encode the forwarded headers as the IoT Data-plane ``userProperties`` value.

    The ``iot-data`` ``publish`` API takes ``userProperties`` as a JSON string holding
    an array of single-entry ``{name: value}`` objects; the broker delivers each as an
    MQTT5 user property the consumer reads back as a header.
    """
    return json.dumps([{name: value} for name, value in headers.items()])


def publish(
    iot_data_client: Any,
    *,
    topic: str,
    body: bytes,
    headers: Mapping[str, str],
) -> None:
    """Publish the byte-identical raw ``body`` to ``topic`` via the IoT Data-plane.

    Sends the raw request bytes unchanged as the QoS 1 payload and the forwarded Linear
    headers as MQTT5 user properties, so the consumer feed surfaces the body with the
    same ``Linear-Signature`` it was signed with. Returns ``None`` on success;
    transient client errors propagate so the caller can keep the SQS enqueue as the
    safety net.
    """
    iot_data_client.publish(
        topic=topic,
        qos=_QOS_AT_LEAST_ONCE,
        payload=body,
        userProperties=_user_properties(headers),
    )
