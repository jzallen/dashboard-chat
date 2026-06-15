"""Lambda ingress for Linear webhooks: verify the signature, enqueue to SQS.

This handler sits behind a public Lambda Function URL (the URL registered with
Linear). It is the edge of the pull-based pipe: Linear POSTs a webhook here, the
handler HMAC-verifies it against the shared secret, and on success drops the raw
body plus the headers Cyrus needs onto an SQS queue. The local pump
(``webhook_feeds.SQSLinearWebhookFeed``) later long-polls that queue and replays
the request to a local Cyrus daemon.

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

from linear_signature import verify

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


def process(
    event: Mapping[str, Any],
    *,
    queue_url: str,
    secret: str,
    sqs_client: Any,
) -> dict[str, Any]:
    """Verify a Function URL event and enqueue the webhook; return an HTTP result.

    Returns ``{"statusCode": 200}`` after a successful ``SendMessage``; returns
    ``{"statusCode": 401}`` and enqueues nothing when the ``Linear-Signature`` is
    missing or does not validate against ``secret``.
    """
    headers = {name.lower(): value for name, value in event.get("headers", {}).items()}
    signature = headers.get(_SIGNATURE_HEADER)
    if signature is None:
        return {"statusCode": 401, "body": "missing signature"}

    body = _raw_body(event)
    if not verify(body, secret, signature):
        return {"statusCode": 401, "body": "invalid signature"}

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


def _load_secret() -> str:
    """Fetch and cache the Linear webhook secret from Secrets Manager (by ARN)."""
    global _secret_cache
    if _secret_cache is None:
        secrets = boto3.client("secretsmanager")
        response = secrets.get_secret_value(SecretId=os.environ["SECRET_ARN"])
        _secret_cache = response["SecretString"]
    return _secret_cache


def handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Lambda entry point: wire env/secret/client, then delegate to ``process``."""
    return process(
        event,
        queue_url=os.environ["QUEUE_URL"],
        secret=_load_secret(),
        sqs_client=_sqs_client(),
    )
