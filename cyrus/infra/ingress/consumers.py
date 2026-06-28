"""Delivery domain for the ingress: how a verified webhook reaches its consumer.

A consumer is addressed by its **natural key** — the Linear username parsed from
the signed body, or the ``_unrouted`` catch-all sentinel. Two delivery strategies
own the per-deploy contract; the controller (``handler.process``) selects one,
calls it, and hands the domain result to the presenter:

* :func:`relay_webhook_event_to_consumer` (``iot-only``) — IoT is the only
  channel, with no SQS safety net. A *routed* consumer the presence boundary
  reports offline yields :class:`ConsumerOffline` (the presenter shapes the honest
  retryable response); an online or ``_unrouted`` consumer is published to its
  identity topic, and a publish failure propagates so Linear retries.
* :func:`enqueue_webhook_event` (``dual-write``) — the SQS enqueue is the system
  of record and durable safety net; the IoT relay is an optimistic best-effort
  probe whose failure is logged and swallowed so it can never take down the
  enqueue.

OPAQUENESS CONTRACT: the ``body`` delivered here is the original raw request
bytes, byte-identical to what was HMAC-verified. Identity is derived from a COPY
of the body (see :mod:`routing`) and never carries the signed bytes; nothing here
mutates them.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import (
    Any,
    Callable,
    Mapping,
    Optional,
    Protocol,
    TypedDict,
    Union,
    runtime_checkable,
)

import iot_publisher
import routing

_log = logging.getLogger(__name__)


# --- Controller boundary types -------------------------------------------------


class HTTPResponse(TypedDict):
    """The Lambda Function URL result shape the controller returns."""

    statusCode: int
    body: str


# IoT Data-plane topic prefix for identity-routed publishes; the routing key (the
# Linear username or the ``_unrouted`` sentinel) is appended.
TOPIC_PREFIX = "cyrus/v1/sessions/"

# Machine-readable reason emitted on the offline path.
_OFFLINE_REASON = "consumer-offline"


# --- Consumer identity (pure value object) -------------------------------------


@dataclass(frozen=True)
class ConsumerIdentity:
    """The natural key a verified webhook is addressed to.

    An immutable, no-I/O value object the use cases *use* (they are not it). It
    holds the routing key only — never the signed body bytes (opaqueness is
    load-bearing: the signed bytes must never round-trip through identity). The key
    is derived from a COPY of the body via :func:`routing.extract_routing_key`.
    Equality- and hash-based.
    """

    key: str

    @classmethod
    def from_body(cls, body: bytes) -> "ConsumerIdentity":
        """Derive identity from a COPY of the signed body (never stores the bytes)."""
        return cls(key=routing.extract_routing_key(body))

    @property
    def is_routed(self) -> bool:
        """Whether a natural key was derivable (vs the ``_unrouted`` catch-all)."""
        return self.key != routing.UNROUTED

    def topic(self, topic_prefix: str = TOPIC_PREFIX) -> str:
        """The per-identity IoT topic this key publishes to."""
        return f"{topic_prefix}{self.key}"


# --- Presence boundary ---------------------------------------------------------


@runtime_checkable
class ConsumerPresenceRepository(Protocol):
    """The boundary the addressed-consumer use case checks to decide offline.

    ``is_offline(username) -> bool``. The **adapter** owns the fail-closed policy:
    a read error (throttle, network, missing IAM grant) resolves to offline,
    because ``iot-only`` has no SQS safety net — a presence-cache blip must yield an
    honest retryable response Linear retries, not a crash. The DynamoDB-backed
    :func:`presence.make_offline_check` is the structural realisation of this
    boundary (a callable of the same shape); see its docstring for the fail-closed
    rationale.
    """

    def is_offline(self, username: str) -> bool: ...


# --- Domain results ------------------------------------------------------------


@dataclass(frozen=True)
class Delivered:
    """The webhook reached its consumer over IoT (online, or ``_unrouted``)."""


@dataclass(frozen=True)
class Enqueued:
    """The webhook was buffered to the durable SQS queue."""


@dataclass(frozen=True)
class ConsumerOffline:
    """A routed consumer the presence boundary reported offline.

    Carries the operator-facing ``consumer_id`` (username), the stable
    ``creator_id`` correlation key for observability, and the operator ``action``
    that names how to bring the consumer back.
    """

    consumer_id: str
    creator_id: Optional[str]
    action: str


DeliveryResult = Union[Delivered, Enqueued, ConsumerOffline]


# --- Delivery strategies (use cases) -------------------------------------------


def relay_webhook_event_to_consumer(
    identity: ConsumerIdentity,
    body: bytes,
    headers: Mapping[str, str],
    *,
    iot_data_client: Any,
    topic_prefix: str = TOPIC_PREFIX,
    is_offline: Optional[Callable[[str], bool]] = None,
) -> Union[Delivered, ConsumerOffline]:
    """Relay a verified webhook to its addressed consumer over IoT.

    There is no SQS safety net on this path. A routed consumer the presence
    boundary reports offline yields :class:`ConsumerOffline` (the presenter turns
    it into the honest retryable response); ``_unrouted`` has no consumer to be
    offline and skips the presence check entirely. An online or ``_unrouted``
    consumer is published to its identity topic, and a publish failure propagates
    so Linear retries rather than falling back to SQS.
    """
    if identity.is_routed and is_offline is not None and is_offline(identity.key):
        offline = ConsumerOffline(
            consumer_id=identity.key,
            creator_id=routing.extract_creator_id(body),
            action=f"start local cyrus consumer with consumer id {identity.key}",
        )
        _log_offline(offline)
        return offline

    iot_publisher.publish(
        iot_data_client,
        topic=identity.topic(topic_prefix),
        body=body,
        headers=_forwarded_headers(headers),
    )
    return Delivered()


def enqueue_webhook_event(
    identity: ConsumerIdentity,
    body: bytes,
    headers: Mapping[str, str],
    *,
    sqs_client: Any,
    queue_url: str,
    iot_data_client: Any = None,
    topic_prefix: str = TOPIC_PREFIX,
) -> Enqueued:
    """Buffer a verified webhook to SQS, with an optimistic IoT relay probe.

    SQS is the system of record and durable safety net. When an IoT client is
    wired, the body is ALSO published byte-identically to the identity topic as a
    best-effort probe — any probe failure is caught and logged so it can never take
    down the enqueue.
    """
    if iot_data_client is not None:
        try:
            iot_publisher.publish(
                iot_data_client,
                topic=identity.topic(topic_prefix),
                body=body,
                headers=_forwarded_headers(headers),
            )
        except Exception:
            _log.exception(
                "IoT dual-write publish to %s failed; SQS enqueue is the safety net",
                identity.topic(topic_prefix),
            )

    sqs_client.send_message(
        QueueUrl=queue_url,
        MessageBody=body.decode("utf-8"),
        MessageAttributes=_message_attributes(headers),
    )
    return Enqueued()


# --- Presenter -----------------------------------------------------------------


def _shape_response(result: DeliveryResult) -> HTTPResponse:
    """Map a delivery domain result to the Function URL ``HTTPResponse``.

    The sole producer of delivery HTTP status: ``Delivered`` -> 200 ``published``,
    ``Enqueued`` -> 200 ``queued``, ``ConsumerOffline`` -> 503 with a
    machine-readable body that names the offline consumer and the operator action.
    No domain type leaks into the body.
    """
    if isinstance(result, ConsumerOffline):
        body = json.dumps(
            {
                "reason": _OFFLINE_REASON,
                "consumer_id": result.consumer_id,
                "action": result.action,
            }
        )
        return {"statusCode": 503, "body": body}
    if isinstance(result, Enqueued):
        return {"statusCode": 200, "body": "queued"}
    return {"statusCode": 200, "body": "published"}


# --- Helpers -------------------------------------------------------------------


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


def _log_offline(offline: ConsumerOffline) -> None:
    """Emit the offline fact to logs so it is queryable in CloudWatch.

    Structured fields (not a parsed message) carry the operator-facing
    ``consumer_id`` (username) plus the stable ``creator_id`` correlation key. The
    ``reason`` field distinguishes this from the ``_unrouted`` and
    transient-publish-failure logs.
    """
    _log.warning(
        "consumer offline: %s",
        offline.consumer_id,
        extra={
            "reason": "consumer_offline",
            "consumer_id": offline.consumer_id,
            "creator_id": offline.creator_id,
            "delivery_mode": "iot-only",
        },
    )
