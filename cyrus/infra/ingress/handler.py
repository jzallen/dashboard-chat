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
live SQS path (DC-21 dual-write migration safety net). The routing key is derived
from a COPY of the body so the signed bytes are never mutated.

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
import os
from typing import Any, Mapping, Optional

import boto3

import iot_publisher
import routing
from linear_signature import verify

# IoT Data-plane topic prefix for identity-routed publishes; the routing key
# (``agentSession.creator.id`` or the ``_unrouted`` sentinel) is appended.
_TOPIC_PREFIX = "cyrus/v1/sessions/"

# Inbound (lowercased, per Lambda Function URL) header name -> canonical name
# forwarded as an SQS MessageAttribute. The pump turns these attributes back into
# the HTTP headers it replays to Cyrus, so only the headers Cyrus needs to verify
# and route the webhook are carried.
_FORWARDED_HEADERS: dict[str, str] = {
    "content-type": "Content-Type",
    "linear-event": "Linear-Event",
    "linear-delivery": "Linear-Delivery",
    "linear-signature": "Linear-Signature",
    "user-agent": "User-Agent",
}

_SIGNATURE_HEADER = "linear-signature"

_sqs_client_singleton: Any = None
_iot_data_client_singleton: Any = None
_secret_cache: Optional[str] = None


def _raw_body(event: Mapping[str, Any]) -> bytes:
    """Return the request body bytes, decoding base64 transport when present."""
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        return base64.b64decode(body)
    return body.encode("utf-8")


def _message_attributes(headers: Mapping[str, str]) -> dict[str, Any]:
    """Render the forwarded Linear headers as SQS String MessageAttributes."""
    return {
        canonical: {"DataType": "String", "StringValue": headers[lowercased]}
        for lowercased, canonical in _FORWARDED_HEADERS.items()
        if lowercased in headers
    }


def _forwarded_headers(headers: Mapping[str, str]) -> dict[str, str]:
    """Return the forwarded Linear headers under their canonical names.

    Same header set the SQS path carries, shaped as a plain ``{name: value}`` map
    for the IoT publish so both legs of the dual-write forward identical headers.
    """
    return {
        canonical: headers[lowercased]
        for lowercased, canonical in _FORWARDED_HEADERS.items()
        if lowercased in headers
    }


def process(
    event: Mapping[str, Any],
    *,
    queue_url: str,
    secret: str,
    sqs_client: Any,
    iot_data_client: Any = None,
    topic_prefix: str = _TOPIC_PREFIX,
) -> dict[str, Any]:
    """Verify a Function URL event and dual-write the webhook; return an HTTP result.

    Returns ``{"statusCode": 401}`` and writes nothing when the
    ``Linear-Signature`` is missing or does not validate against ``secret``.

    On a valid signature the raw body is enqueued to SQS. When ``iot_data_client``
    is supplied, the handler additionally publishes the **byte-identical** raw body
    to ``{topic_prefix}{key}`` via the IoT Data-plane API, where ``key`` is the
    routing key extracted from a COPY of the body (DC-21 dual-write). When
    ``iot_data_client`` is ``None`` the IoT leg is skipped and behavior is the
    legacy SQS-only path. Returns ``{"statusCode": 200}`` on success.
    """
    headers = {name.lower(): value for name, value in event.get("headers", {}).items()}
    signature = headers.get(_SIGNATURE_HEADER)
    if signature is None:
        return {"statusCode": 401, "body": "missing signature"}

    body = _raw_body(event)
    if not verify(body, secret, signature):
        return {"statusCode": 401, "body": "invalid signature"}

    if iot_data_client is not None:
        # Dual-write IoT leg (RED scaffold). Routing-key extraction reads a COPY
        # of the body; the byte-identical raw ``body`` is what gets published.
        # The IoT publish must NOT take down the SQS safety net (AC5) — that
        # orchestration lands in DC-34; for now both calls are scaffolded RED.
        key = routing.extract_routing_key(body)
        iot_publisher.publish(
            iot_data_client,
            topic=f"{topic_prefix}{key}",
            body=body,
            headers=_forwarded_headers(headers),
        )

    sqs_client.send_message(
        QueueUrl=queue_url,
        MessageBody=body.decode("utf-8"),
        MessageAttributes=_message_attributes(headers),
    )
    return {"statusCode": 200, "body": "queued"}


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


def _load_secret() -> str:
    """Fetch and cache the Linear webhook secret from Secrets Manager (by ARN)."""
    global _secret_cache
    if _secret_cache is None:
        secrets = boto3.client("secretsmanager")
        response = secrets.get_secret_value(SecretId=os.environ["SECRET_ARN"])
        _secret_cache = response["SecretString"]
    return _secret_cache


def handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Lambda entry point: wire env/secret/clients, then delegate to ``process``.

    The IoT leg is enabled only when ``IOT_ENDPOINT`` is configured; without it the
    handler runs the legacy SQS-only path so the dual-write can roll out behind env.
    """
    iot_data_client = _iot_data_client() if os.environ.get("IOT_ENDPOINT") else None
    return process(
        event,
        queue_url=os.environ["QUEUE_URL"],
        secret=_load_secret(),
        sqs_client=_sqs_client(),
        iot_data_client=iot_data_client,
    )
