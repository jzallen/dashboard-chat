"""Lambda ingress for Linear webhooks: verify the signature, then dual-write.

This handler sits behind a public Lambda Function URL (the URL registered with
Linear). It is the edge of the pull-based pipe: Linear POSTs a webhook here, the
handler HMAC-verifies it against the shared secret, and on success drops the raw
body plus the headers Cyrus needs onto an SQS queue. The local pump
(``webhook_feeds.SQSLinearWebhookFeed``) later long-polls that queue and replays
the request to a local Cyrus daemon.

When an IoT Data-plane client is wired (``IOT_ENDPOINT`` set), the handler also
publishes the byte-identical raw body to a per-identity topic
``cyrus/v1/sessions/{key}`` — identity-routed addressing proven alongside the
live SQS path, which stays the durable safety net if the publish fails. The
routing key is derived from a COPY of the body so the signed bytes are never
mutated.

The handler is deliberately dependency-free at runtime: ``boto3`` ships in the
Lambda runtime and everything else is stdlib, so the CDK asset zips this folder
with no bundling. ``linear_signature`` is the same module the pump signs with
(symlinked into this asset) so verification and signing cannot drift.

IF YOU'RE AN AGENT, READ THIS: the signature MUST be checked against the raw
request body bytes exactly as Linear transmitted them — never re-serialize the
JSON before verifying, or the digest will not match. Verification failures must
NOT enqueue anything.
"""

from __future__ import annotations

import functools
import logging
import os
from dataclasses import dataclass
from typing import Any, Callable, Literal, Mapping, Optional, Protocol

import boto3

from consumers import (
    ConsumerIdentity,
    ConsumerPresenceRepository,
    HTTPResponse,
    LinearWebhookEvent,
    enqueue_webhook_event,
    probe_consumer_over_iot,
    relay_webhook_event_to_consumer,
)
from presence import AlwaysOnlinePresence, DynamoDBConsumerPresence

_log = logging.getLogger(__name__)


class DeliveryResult(Protocol):
    """A delivery outcome that carries its own Function URL ``message``.

    The two delivery strategies return concrete results (``Delivered``,
    ``Enqueued``, ``ConsumerOffline``); each knows how to render itself as the
    wire response, so the controller stays free of any response-shaping branch.
    """

    @property
    def message(self) -> HTTPResponse: ...


# Per-deploy delivery modes (mutually exclusive). ``dual-write`` is the safe
# default for any unknown/unset value so a misconfiguration never silently drops
# the SQS safety net.
_DELIVERY_MODES = ("dual-write", "iot-only")

_sqs_client_singleton: Any = None
_iot_data_client_singleton: Any = None
_dynamodb_client_singleton: Any = None
_secret_cache: Optional[str] = None


@dataclass(frozen=True)
class Env:
    """The validated environment a Lambda invocation runs under.

    Read once and validated on construction so a misconfiguration fails fast at the
    edge rather than per-request: ``iot-only`` requires ``IOT_ENDPOINT`` (it has no
    SQS safety net, so every webhook must have a Data-plane client to publish
    through). An unknown/unset ``DELIVERY_MODE`` falls back to ``dual-write`` so a
    typo never silently drops the SQS safety net.
    """

    delivery_mode: Literal["dual-write", "iot-only"]
    linear_secret: str
    queue_url: str
    presence_table: Optional[str]
    iot_endpoint: Optional[str]

    @classmethod
    def from_environ(cls) -> "Env":
        """Read and validate the ingress configuration from ``os.environ``."""
        delivery_mode = os.environ.get("DELIVERY_MODE", "dual-write")
        if delivery_mode not in _DELIVERY_MODES:
            delivery_mode = "dual-write"
        iot_endpoint = os.environ.get("IOT_ENDPOINT")
        if delivery_mode == "iot-only" and not iot_endpoint:
            raise RuntimeError(
                "DELIVERY_MODE=iot-only requires IOT_ENDPOINT to be configured "
                "(no IoT Data-plane client could be built)"
            )
        return cls(
            delivery_mode=delivery_mode,
            linear_secret=_load_secret(),
            queue_url=os.environ["QUEUE_URL"],
            presence_table=os.environ.get("PRESENCE_TABLE"),
            iot_endpoint=iot_endpoint,
        )


def process(
    event: Mapping[str, Any],
    env: Env,
    *,
    sqs_client: Callable[[], Any],
    iot_client: Callable[[], Any],
    presence: Callable[[], ConsumerPresenceRepository],
) -> HTTPResponse:
    """Verify a Function URL event, then run the chosen delivery strategy.

    The composition root: it rejects an unsigned/invalid request via the webhook
    event's own error message, derives the consumer identity, and — reading
    ``env.delivery_mode`` once — selects the strategy, constructing only the clients
    that strategy needs from the supplied factories:

    * ``iot-only`` — :func:`~consumers.relay_webhook_event_to_consumer`: publish over
      IoT (the sole channel), or surface the offline consumer; SQS is never touched.
    * ``dual-write`` (default) — a best-effort
      :func:`~consumers.probe_consumer_over_iot` beside the durable
      :func:`~consumers.enqueue_webhook_event` to SQS (the system of record).
    """
    webhook_event = LinearWebhookEvent(event, env.linear_secret)
    if not webhook_event.is_valid():
        return webhook_event.error_message

    identity = ConsumerIdentity.from_webhook_event(webhook_event)

    if env.delivery_mode == "iot-only":
        relayed: DeliveryResult = relay_webhook_event_to_consumer(
            identity, webhook_event, iot_client=iot_client(), presence=presence()
        )
        return relayed.message

    probe_consumer_over_iot(identity, webhook_event, iot_client=iot_client())
    enqueued = enqueue_webhook_event(
        webhook_event, sqs_client=sqs_client(), queue_url=env.queue_url
    )
    return enqueued.message


def _sqs_client(env: Env) -> Any:
    """Return a process-wide SQS client (reused across warm Lambda invocations)."""
    global _sqs_client_singleton
    if _sqs_client_singleton is None:
        _sqs_client_singleton = boto3.client("sqs")
    return _sqs_client_singleton


def _iot_data_client(env: Env) -> Any:
    """Return a process-wide IoT Data-plane client, or ``None`` when unconfigured.

    The Data-plane HTTPS Publish API is account/region specific, so the client is
    pinned to ``env.iot_endpoint`` (no MQTT client in the Lambda). Without an
    endpoint there is no IoT leg, so this returns ``None`` and the dual-write probe
    is skipped (``iot-only`` validates the endpoint up front in
    :meth:`Env.from_environ`).
    """
    if env.iot_endpoint is None:
        return None
    global _iot_data_client_singleton
    if _iot_data_client_singleton is None:
        _iot_data_client_singleton = boto3.client(
            "iot-data",
            endpoint_url=f"https://{env.iot_endpoint}",
        )
    return _iot_data_client_singleton


def _dynamodb_client() -> Any:
    """Return a process-wide DynamoDB client for the presence-cache read."""
    global _dynamodb_client_singleton
    if _dynamodb_client_singleton is None:
        _dynamodb_client_singleton = boto3.client("dynamodb")
    return _dynamodb_client_singleton


def _presence(env: Env) -> ConsumerPresenceRepository:
    """Build the presence boundary: the DynamoDB cache, or the always-online null.

    With a ``PRESENCE_TABLE`` the offline decision reads the DynamoDB presence
    cache; without one there is no cache wired, so the addressed-consumer use case
    treats every consumer as online.
    """
    if env.presence_table is None:
        return AlwaysOnlinePresence()
    return DynamoDBConsumerPresence(_dynamodb_client(), env.presence_table)


def _load_secret() -> str:
    """Fetch and cache the Linear webhook secret from Secrets Manager (by ARN)."""
    global _secret_cache
    if _secret_cache is None:
        secrets = boto3.client("secretsmanager")
        response = secrets.get_secret_value(SecretId=os.environ["SECRET_ARN"])
        _secret_cache = response["SecretString"]
    return _secret_cache


def handler(event: Mapping[str, Any], context: Any) -> HTTPResponse:
    """Lambda entry point: read+validate env, then run ``process`` with client factories.

    :meth:`Env.from_environ` reads and validates the configuration (failing fast on
    a misconfigured ``iot-only`` without ``IOT_ENDPOINT``). The clients are passed
    as factories so ``process`` constructs only the ones the selected delivery mode
    needs.
    """
    env = Env.from_environ()
    return process(
        event,
        env,
        sqs_client=functools.partial(_sqs_client, env),
        iot_client=functools.partial(_iot_data_client, env),
        presence=functools.partial(_presence, env),
    )
