"""IoT Data-plane publisher for the dual-write ingress.

The ingress Lambda publishes every verified webhook to a per-identity AWS IoT
topic (``cyrus/v1/sessions/{key}``) over the IoT **Data-plane HTTPS Publish API**
— ``boto3.client("iot-data").publish(topic=..., payload=...)`` — so there is NO
MQTT client in the Lambda. This sits beside the existing SQS enqueue: the IoT
publish proves identity routing while SQS keeps the live single-consumer path
intact, so a failed publish must never take down the SQS enqueue.

OPAQUENESS CONTRACT: the ``body`` published here is the original raw request
bytes, byte-identical to what was HMAC-verified and enqueued to SQS. This module
never re-serializes or mutates the body. Forwarded Linear headers ride on the SQS
leg as MessageAttributes; the IoT Data-plane payload is the raw body only, so
``headers`` is accepted for caller symmetry but not sent on the publish.
"""

from __future__ import annotations

from typing import Any, Mapping


def publish(
    iot_data_client: Any,
    *,
    topic: str,
    body: bytes,
    headers: Mapping[str, str],
) -> None:
    """Publish the byte-identical raw ``body`` to ``topic`` via the IoT Data-plane.

    Sends the raw request bytes unchanged as the IoT Data-plane payload. Returns
    ``None`` on success; transient client errors propagate so the caller can keep
    the SQS enqueue as the safety net. The forwarded Linear headers
    ride on the SQS leg as MessageAttributes, so ``headers`` is accepted but not
    sent on this Data-plane publish.
    """
    iot_data_client.publish(topic=topic, payload=body)
