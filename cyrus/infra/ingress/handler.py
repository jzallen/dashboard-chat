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

import base64
import logging
import os
from typing import Any, Callable, Literal, Mapping, Optional

import boto3

import presence
from consumers import TOPIC_PREFIX, HTTPResponse, IoTLinearConsumer, SQSLinearConsumer
from linear_signature import verify

_log = logging.getLogger(__name__)

# Per-deploy delivery modes (mutually exclusive). ``dual-write`` is the safe
# default for any unknown/unset value so a misconfiguration never silently drops
# the SQS safety net.
_DELIVERY_MODES = ("dual-write", "iot-only")

_SIGNATURE_HEADER = "linear-signature"

_sqs_client_singleton: Any = None
_iot_data_client_singleton: Any = None
_dynamodb_client_singleton: Any = None
_secret_cache: Optional[str] = None


def _raw_body(event: Mapping[str, Any]) -> bytes:
    """Return the request body bytes, decoding base64 transport when present."""
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        return base64.b64decode(body)
    return body.encode("utf-8")


def process(
    event: Mapping[str, Any],
    *,
    queue_url: str,
    secret: str,
    sqs_client: Any,
    iot_data_client: Any = None,
    topic_prefix: str = TOPIC_PREFIX,
    delivery_mode: Literal["dual-write", "iot-only"] = "dual-write",
    is_offline: Optional[Callable[[str], bool]] = None,
) -> HTTPResponse:
    """Verify a Function URL event and delegate delivery to the consumer.

    Returns ``{"statusCode": 401}`` and writes nothing when the
    ``Linear-Signature`` is missing or does not validate against ``secret``. On a
    valid signature the per-deploy ``delivery_mode`` selects the consumer that
    owns delivery (and, in ``iot-only``, the offline decision):

    * ``dual-write`` (default) — :class:`~consumers.SQSLinearConsumer`: enqueue to
      SQS and, when ``iot_data_client`` is wired, also publish byte-identically.
    * ``iot-only`` — :class:`~consumers.IoTLinearConsumer`: publish over IoT, or
      return the honest 503 when the routed consumer ``is_offline``.
    """
    headers = {name.lower(): value for name, value in event.get("headers", {}).items()}
    signature = headers.get(_SIGNATURE_HEADER)
    if signature is None:
        return {"statusCode": 401, "body": "missing signature"}

    body = _raw_body(event)
    if not verify(body, secret, signature):
        return {"statusCode": 401, "body": "invalid signature"}

    if delivery_mode == "iot-only":
        consumer = IoTLinearConsumer(
            body,
            iot_data_client=iot_data_client,
            topic_prefix=topic_prefix,
            is_offline=is_offline,
        )
    else:
        consumer = SQSLinearConsumer(
            body,
            sqs_client=sqs_client,
            queue_url=queue_url,
            iot_data_client=iot_data_client,
            topic_prefix=topic_prefix,
        )
    return consumer.deliver(headers)


def _sqs_client() -> Any:
    """Return a process-wide SQS client (reused across warm Lambda invocations)."""
    global _sqs_client_singleton
    if _sqs_client_singleton is None:
        _sqs_client_singleton = boto3.client("sqs")
    return _sqs_client_singleton


def _iot_data_client() -> Any:
    """Return a process-wide IoT Data-plane client targeting ``IOT_ENDPOINT``.

    The Data-plane HTTPS Publish API is account/region specific, so the client is
    pinned to the ``IOT_ENDPOINT`` host (no MQTT client in the Lambda).
    """
    global _iot_data_client_singleton
    if _iot_data_client_singleton is None:
        _iot_data_client_singleton = boto3.client(
            "iot-data",
            endpoint_url=f"https://{os.environ['IOT_ENDPOINT']}",
        )
    return _iot_data_client_singleton


def _dynamodb_client() -> Any:
    """Return a process-wide DynamoDB client for the presence-cache read."""
    global _dynamodb_client_singleton
    if _dynamodb_client_singleton is None:
        _dynamodb_client_singleton = boto3.client("dynamodb")
    return _dynamodb_client_singleton


def _delivery_mode() -> str:
    """Read ``DELIVERY_MODE`` from env, falling back to ``dual-write`` if unknown."""
    mode = os.environ.get("DELIVERY_MODE", "dual-write")
    return mode if mode in _DELIVERY_MODES else "dual-write"


def _load_secret() -> str:
    """Fetch and cache the Linear webhook secret from Secrets Manager (by ARN)."""
    global _secret_cache
    if _secret_cache is None:
        secrets = boto3.client("secretsmanager")
        response = secrets.get_secret_value(SecretId=os.environ["SECRET_ARN"])
        _secret_cache = response["SecretString"]
    return _secret_cache


def handler(event: Mapping[str, Any], context: Any) -> HTTPResponse:
    """Lambda entry point: wire env/secret/clients, then delegate to ``process``.

    The IoT leg is enabled only when ``IOT_ENDPOINT`` is configured; without it the
    handler runs the legacy SQS-only path so the dual-write can roll out behind env.
    ``DELIVERY_MODE`` selects the per-deploy mode; in ``iot-only`` the offline
    boundary is backed by a real presence-cache read of the ``PRESENCE_TABLE``.
    """
    iot_data_client = _iot_data_client() if os.environ.get("IOT_ENDPOINT") else None
    delivery_mode = _delivery_mode()

    if delivery_mode == "iot-only" and iot_data_client is None:
        # iot-only has no SQS safety net, so every webhook is published over IoT.
        # Without IOT_ENDPOINT there is no Data-plane client and the publish would
        # AttributeError on every message — fail fast on the misconfiguration
        # instead of 500-ing each request.
        raise RuntimeError(
            "DELIVERY_MODE=iot-only requires IOT_ENDPOINT to be configured "
            "(no IoT Data-plane client could be built)"
        )

    is_offline = None
    if delivery_mode == "iot-only":
        table_name = os.environ.get("PRESENCE_TABLE")
        if table_name:
            is_offline = presence.make_offline_check(_dynamodb_client(), table_name)

    return process(
        event,
        queue_url=os.environ["QUEUE_URL"],
        secret=_load_secret(),
        sqs_client=_sqs_client(),
        iot_data_client=iot_data_client,
        delivery_mode=delivery_mode,
        is_offline=is_offline,
    )
