"""Delivery-target domain objects for the ingress: how a verified webhook reaches
its Linear consumer.

A consumer is identified by its **natural key** (the Linear username parsed from
the signed body, or the ``_unrouted`` sentinel) and the per-identity IoT topic
``cyrus/v1/sessions/{key}`` that key publishes to. The two concrete consumers
encapsulate the per-deploy delivery contract so the handler stays orchestration:

* :class:`IoTLinearConsumer` (``iot-only`` mode) — IoT is the only channel, with
  no SQS safety net. A *routed* consumer the presence boundary reports offline
  yields an honest 503 naming it; an online or ``_unrouted`` consumer is published
  to the topic. A publish failure propagates (Linear retries) rather than falling
  back to SQS.
* :class:`SQSLinearConsumer` (``dual-write`` mode) — the SQS enqueue is the system
  of record and the durable safety net; the IoT publish is a best-effort probe
  whose failure is logged and swallowed so it can never take down the enqueue.

OPAQUENESS CONTRACT: the ``body`` delivered here is the original raw request
bytes, byte-identical to what was HMAC-verified. Routing reads a COPY of the body
(see :mod:`routing`); nothing here mutates the signed bytes.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Mapping, Optional

import iot_publisher
import routing

_log = logging.getLogger(__name__)

# IoT Data-plane topic prefix for identity-routed publishes; the routing key (the
# Linear username or the ``_unrouted`` sentinel) is appended.
TOPIC_PREFIX = "cyrus/v1/sessions/"

# Machine-readable reason emitted on the offline 503 path.
_OFFLINE_REASON = "consumer-offline"

# Inbound (lowercased, per Lambda Function URL) header name -> canonical name
# forwarded to the consumer. The SQS pump turns these back into the HTTP headers
# it replays to Cyrus, so only the headers Cyrus needs to verify and route the
# webhook are carried.
_FORWARDED_HEADERS: dict[str, str] = {
    "content-type": "Content-Type",
    "linear-event": "Linear-Event",
    "linear-delivery": "Linear-Delivery",
    "linear-signature": "Linear-Signature",
    "user-agent": "User-Agent",
}


def _forwarded_headers(headers: Mapping[str, str]) -> dict[str, str]:
    """Return the forwarded Linear headers under their canonical names."""
    return {
        canonical: headers[lowercased]
        for lowercased, canonical in _FORWARDED_HEADERS.items()
        if lowercased in headers
    }


def _message_attributes(headers: Mapping[str, str]) -> dict[str, Any]:
    """Render the forwarded Linear headers as SQS String MessageAttributes."""
    return {
        canonical: {"DataType": "String", "StringValue": headers[lowercased]}
        for lowercased, canonical in _FORWARDED_HEADERS.items()
        if lowercased in headers
    }


def _offline_response(username: str) -> dict[str, Any]:
    """Build the honest 503 for an offline consumer: reason + id + operator action.

    The body is machine-readable so Linear (and an operator reading logs) gets a
    truthful signal that names the offline consumer by its natural key and tells
    the operator exactly how to fix it.
    """
    body = json.dumps(
        {
            "reason": _OFFLINE_REASON,
            "consumer_id": username,
            "action": f"start local cyrus consumer with consumer id {username}",
        }
    )
    return {"statusCode": 503, "body": body}


class _LinearConsumer:
    """A delivery target's identity: its natural key and per-identity IoT topic.

    The routing key is parsed from a COPY of the signed body (the Linear username,
    or the ``_unrouted`` catch-all sentinel); the topic is the address that key
    publishes to. Subclasses add the per-mode delivery behavior.
    """

    def __init__(self, body: bytes, *, topic_prefix: str = TOPIC_PREFIX) -> None:
        self._body = body
        self.key = routing.extract_routing_key(body)
        self.topic = f"{topic_prefix}{self.key}"

    @property
    def is_routed(self) -> bool:
        """Whether a natural key was derivable (vs the ``_unrouted`` catch-all)."""
        return self.key != routing.UNROUTED


class IoTLinearConsumer(_LinearConsumer):
    """A consumer reachable only over IoT (``iot-only`` delivery mode).

    Owns the offline decision and the publish. There is no SQS fallback: an
    offline routed consumer gets an honest 503; everyone else is published to the
    identity topic and a publish failure propagates so Linear retries.
    """

    def __init__(
        self,
        body: bytes,
        *,
        iot_data_client: Any,
        topic_prefix: str = TOPIC_PREFIX,
        is_offline: Optional[Callable[[str], bool]] = None,
    ) -> None:
        super().__init__(body, topic_prefix=topic_prefix)
        self._iot_data_client = iot_data_client
        self._presence_offline = is_offline

    def is_offline(self) -> bool:
        """Whether this consumer is a routed consumer the presence read calls offline.

        ``_unrouted`` has no consumer to be offline, and with no presence boundary
        wired we cannot assert offline — only a routed consumer with a presence
        check that reports offline is "mapped but offline".
        """
        return (
            self.is_routed
            and self._presence_offline is not None
            and self._presence_offline(self.key)
        )

    def deliver(self, headers: Mapping[str, str]) -> dict[str, Any]:
        """Deliver over IoT, or return the honest 503 when offline."""
        if self.is_offline():
            self._log_offline()
            return _offline_response(self.key)
        iot_publisher.publish(
            self._iot_data_client,
            topic=self.topic,
            body=self._body,
            headers=_forwarded_headers(headers),
        )
        return {"statusCode": 200, "body": "published"}

    def _log_offline(self) -> None:
        """Emit the offline fact to logs so it is queryable in CloudWatch.

        Structured fields (not a parsed message) carry the operator-facing
        ``consumer_id`` (username) plus the stable ``creator.id`` correlation key.
        The ``reason`` field distinguishes this from the ``_unrouted`` and
        transient-publish-failure logs.
        """
        _log.warning(
            "consumer offline: %s",
            self.key,
            extra={
                "reason": "consumer_offline",
                "consumer_id": self.key,
                "creator_id": routing.extract_creator_id(self._body),
                "delivery_mode": "iot-only",
            },
        )


class SQSLinearConsumer(_LinearConsumer):
    """A dual-write consumer: SQS is the system of record, IoT a best-effort probe.

    The raw body is enqueued to SQS (the durable safety net) and, when an IoT
    client is wired, also published byte-identically to the identity topic. The
    publish is a probe: any failure is caught and logged so it can never take down
    the SQS enqueue.
    """

    def __init__(
        self,
        body: bytes,
        *,
        sqs_client: Any,
        queue_url: str,
        iot_data_client: Any = None,
        topic_prefix: str = TOPIC_PREFIX,
    ) -> None:
        super().__init__(body, topic_prefix=topic_prefix)
        self._sqs_client = sqs_client
        self._queue_url = queue_url
        self._iot_data_client = iot_data_client

    def deliver(self, headers: Mapping[str, str]) -> dict[str, Any]:
        """Publish best-effort to IoT (when wired), then enqueue to SQS."""
        if self._iot_data_client is not None:
            try:
                iot_publisher.publish(
                    self._iot_data_client,
                    topic=self.topic,
                    body=self._body,
                    headers=_forwarded_headers(headers),
                )
            except Exception:
                _log.exception(
                    "IoT dual-write publish to %s failed; SQS enqueue is the safety net",
                    self.topic,
                )

        self._sqs_client.send_message(
            QueueUrl=self._queue_url,
            MessageBody=self._body.decode("utf-8"),
            MessageAttributes=_message_attributes(headers),
        )
        return {"statusCode": 200, "body": "queued"}
