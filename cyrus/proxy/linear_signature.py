"""HMAC-SHA256 signing and verification for Linear webhooks.

Linear authenticates each webhook by signing the raw request body with a shared
secret and sending the hex digest in the ``Linear-Signature`` header
(HMAC-SHA256). This module is the single implementation of that scheme, shared by
the two sides that need it so they cannot drift:

- the SQS-ingress Lambda (``infra/ingress/handler.py``) **verifies** inbound
  webhooks at the edge before enqueuing them, and
- the canary feed (``webhook_feeds/canary_feed.py``) **signs** synthetic bodies
  so a real Cyrus accepts them.

The signature is computed over the body *bytes* exactly as transmitted; callers
must pass the raw body, never a re-serialized copy, or the digest will not match.
"""

from __future__ import annotations

import hashlib
import hmac


def sign(body: bytes, secret: str) -> str:
    """Return the hex HMAC-SHA256 of ``body`` keyed by ``secret`` (Linear's scheme)."""
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def verify(body: bytes, secret: str, signature: str) -> bool:
    """Constant-time check that ``signature`` matches the Linear signature for ``body``.

    Uses :func:`hmac.compare_digest` so the comparison does not leak timing
    information about how much of the digest matched.
    """
    return hmac.compare_digest(sign(body, secret), signature)
