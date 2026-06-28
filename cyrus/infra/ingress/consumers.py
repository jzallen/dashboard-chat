"""Delivery domain for the ingress: how a verified webhook reaches its consumer.

The inbound request is modelled as a :class:`LinearWebhookEvent` — it owns the
request boundary (decode the raw body, read the headers, verify the
``Linear-Signature``) and stores the signed bytes once so they are never
reconstructed. A consumer is addressed by its **natural key** — the Linear
username parsed from the body, or the ``_unrouted`` catch-all sentinel. Two
delivery strategies own the per-deploy contract; the controller
(``handler.process``) selects one, calls it, and returns the result's own
``message`` (an :class:`HTTPResponse`):

* :func:`relay_webhook_event_to_consumer` (``iot-only``) — IoT is the only
  channel, with no SQS safety net. A *routed* consumer the presence boundary
  reports offline yields :class:`ConsumerOffline` (whose ``message`` is the honest
  retryable response); an online or ``_unrouted`` consumer is published to its
  identity topic, and a publish failure propagates so Linear retries.
* :func:`enqueue_webhook_event` (``dual-write``) — the SQS enqueue is the system
  of record and durable safety net; the IoT relay is an optimistic best-effort
  probe whose failure is logged and swallowed so it can never take down the
  enqueue.

OPAQUENESS CONTRACT: the body published/enqueued is the original raw request
bytes, byte-identical to what was HMAC-verified — the event stores them once and
hands the same object out. Identity is derived from a COPY of those bytes (see
:mod:`routing`) and never carries them; nothing here mutates them.
"""

from __future__ import annotations

import base64
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
from linear_signature import verify

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

_SIGNATURE_HEADER = "linear-signature"

# Lowercased names of the Linear headers Cyrus needs to verify and route the
# webhook — a case-insensitive allow-list. A Function URL carries many headers the
# consumer does not need; only those whose lowercased name is in this set are
# forwarded, and they pass through with their original name and value. Cyrus reads
# webhook headers case-insensitively, so the ingress never rewrites their casing.
_FORWARDED_HEADERS: frozenset[str] = frozenset(
    {
        "content-type",
        "linear-event",
        "linear-delivery",
        "linear-signature",
        "user-agent",
    }
)


# --- Inbound webhook event -----------------------------------------------------


class SignatureError:
    """Why a webhook failed signature validation; carries the 401 body ``message``."""

    message: str


class MissingSignatureError(SignatureError):
    """The request carried no ``Linear-Signature`` header."""

    message = "missing signature"


class InvalidSignatureError(SignatureError):
    """The ``Linear-Signature`` did not verify against the shared secret."""

    message = "invalid signature"


class LinearWebhookEvent:
    """A Linear webhook as delivered to the Lambda Function URL.

    Owns the request boundary: it decodes the raw body bytes (base64 transport
    when present), reads the headers, and verifies the ``Linear-Signature`` HMAC
    against the shared secret on construction. The raw body is stored once,
    byte-identical to what was signed, and handed out unchanged — it is never
    re-serialised, which is the opaqueness invariant the downstream
    publish/enqueue depend on.
    """

    def __init__(self, event: Mapping[str, Any], secret: str) -> None:
        self._headers = dict(event.get("headers", {}))
        self._body = self._decode_body(event)
        self._secret = secret
        self._signature = self._header(_SIGNATURE_HEADER)
        self._error = self._validate()

    @staticmethod
    def _decode_body(event: Mapping[str, Any]) -> bytes:
        """Return the request body bytes, decoding base64 transport when present."""
        body = event.get("body") or ""
        if event.get("isBase64Encoded"):
            return base64.b64decode(body)
        return body.encode("utf-8")

    def _header(self, name: str) -> Optional[str]:
        """Case-insensitively read a single inbound header value, or ``None``."""
        target = name.lower()
        return next(
            (value for key, value in self._headers.items() if key.lower() == target),
            None,
        )

    def _validate(self) -> Optional[SignatureError]:
        """Why the signature check failed, or ``None`` when the request is valid."""
        if self._signature is None:
            return MissingSignatureError()
        if not verify(self._body, self._secret, self._signature):
            return InvalidSignatureError()
        return None

    @property
    def body(self) -> bytes:
        """The raw request bytes, byte-identical to what was signature-verified."""
        return self._body

    def is_valid(self) -> bool:
        """Whether the request carries a ``Linear-Signature`` that verifies the body."""
        return self._error is None

    @property
    def error_message(self) -> HTTPResponse:
        """The 401 for an unsigned or tampered request (read only when invalid)."""
        return {"statusCode": 401, "body": self._error.message}

    def forwarded_headers(self) -> dict[str, str]:
        """The allow-listed Linear headers, passed through unmodified.

        A header is forwarded with its original name and value when its lowercased
        name is in the allow-list. Cyrus reads these case-insensitively, so the
        ingress never rewrites their casing.
        """
        return {
            name: value
            for name, value in self._headers.items()
            if name.lower() in _FORWARDED_HEADERS
        }


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
    def from_webhook_event(cls, event: LinearWebhookEvent) -> "ConsumerIdentity":
        """Derive identity from a COPY of the event's body (never stores the bytes)."""
        return cls(key=routing.extract_routing_key(event.body))

    @property
    def is_routed(self) -> bool:
        """Whether a natural key was derivable (vs the ``_unrouted`` catch-all)."""
        return self.key != routing.UNROUTED

    @property
    def topic(self) -> str:
        """The per-identity IoT topic this key publishes to."""
        return f"{TOPIC_PREFIX}{self.key}"


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

    @property
    def message(self) -> HTTPResponse:
        """The Function URL response for a successful IoT delivery."""
        return {"statusCode": 200, "body": "published"}


@dataclass(frozen=True)
class Enqueued:
    """The webhook was buffered to the durable SQS queue."""

    @property
    def message(self) -> HTTPResponse:
        """The Function URL response for a successful SQS enqueue."""
        return {"statusCode": 200, "body": "queued"}


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

    @property
    def message(self) -> HTTPResponse:
        """The honest, machine-readable response naming the offline consumer."""
        body = json.dumps(
            {
                "reason": _OFFLINE_REASON,
                "consumer_id": self.consumer_id,
                "action": self.action,
            }
        )
        return {"statusCode": 503, "body": body}


# --- Delivery strategies (use cases) -------------------------------------------


def relay_webhook_event_to_consumer(
    identity: ConsumerIdentity,
    event: LinearWebhookEvent,
    *,
    iot_data_client: Any,
    is_offline: Optional[Callable[[str], bool]] = None,
) -> Union[Delivered, ConsumerOffline]:
    """Relay a verified webhook to its addressed consumer over IoT.

    There is no SQS safety net on this path. A routed consumer the presence
    boundary reports offline yields :class:`ConsumerOffline` (whose ``message`` is
    the honest retryable response); ``_unrouted`` has no consumer to be offline and
    skips the presence check entirely. An online or ``_unrouted`` consumer is
    published to its identity topic, and a publish failure propagates so Linear
    retries rather than falling back to SQS.
    """
    if identity.is_routed and is_offline is not None and is_offline(identity.key):
        offline = ConsumerOffline(
            consumer_id=identity.key,
            creator_id=routing.extract_creator_id(event.body),
            action=f"start local cyrus consumer with consumer id {identity.key}",
        )
        _log_offline(offline)
        return offline

    iot_publisher.publish(
        iot_data_client,
        topic=identity.topic,
        body=event.body,
        headers=event.forwarded_headers(),
    )
    return Delivered()


def enqueue_webhook_event(
    identity: ConsumerIdentity,
    event: LinearWebhookEvent,
    *,
    sqs_client: Any,
    queue_url: str,
    iot_data_client: Any = None,
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
                topic=identity.topic,
                body=event.body,
                headers=event.forwarded_headers(),
            )
        except Exception:
            _log.exception(
                "IoT dual-write publish to %s failed; SQS enqueue is the safety net",
                identity.topic,
            )

    sqs_client.send_message(
        QueueUrl=queue_url,
        MessageBody=event.body.decode("utf-8"),
        MessageAttributes=_build_message_attributes(event.forwarded_headers()),
    )
    return Enqueued()


# --- Helpers -------------------------------------------------------------------


def _build_message_attributes(forwarded: Mapping[str, str]) -> dict[str, Any]:
    """Render the forwarded Linear headers as SQS String MessageAttributes."""
    return {
        name: {"DataType": "String", "StringValue": value}
        for name, value in forwarded.items()
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
