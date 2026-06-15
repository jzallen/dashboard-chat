"""IoT Data-plane publisher for the dual-write ingress (RED scaffold).

The ingress Lambda publishes every verified webhook to a per-identity AWS IoT
topic (``cyrus/v1/sessions/{key}``) over the IoT **Data-plane HTTPS Publish API**
— ``boto3.client("iot-data").publish(topic=..., payload=...)`` — so there is NO
MQTT client in the Lambda. This sits beside the existing SQS enqueue as the
dual-write migration safety net (see DC-21): the IoT publish proves identity
routing while SQS keeps the live single-consumer path intact.

OPAQUENESS CONTRACT: the ``body`` published here is the original raw request
bytes, byte-identical to what was HMAC-verified and enqueued to SQS. This module
never re-serializes or mutates the body.

IF YOU'RE AN AGENT, READ THIS: this is a scaffold. ``publish`` deliberately
raises ``AssertionError`` so the DC-30 RED tests fail on the scaffold marker (RED,
not BROKEN). DC-32 turns it green by calling the IoT Data-plane client; do not
weaken the tests to match the stub.
"""

from __future__ import annotations

from typing import Any, Mapping

__SCAFFOLD__ = True

_NOT_IMPLEMENTED = "Not yet implemented — RED scaffold"


def publish(
    iot_data_client: Any,
    *,
    topic: str,
    body: bytes,
    headers: Mapping[str, str],
) -> None:
    """Publish the raw ``body`` (+ forwarded ``headers``) to ``topic`` via IoT Data-plane.

    Carries the same forwarded Linear headers the SQS path carries (Content-Type,
    Linear-Event, Linear-Delivery, Linear-Signature, User-Agent) and the
    byte-identical raw ``body`` as the MQTT payload. Returns ``None`` on success;
    propagates the client error on transient failure so the caller can keep the
    SQS enqueue as the safety net (DC-21 AC5).
    """
    raise AssertionError(_NOT_IMPLEMENTED)
