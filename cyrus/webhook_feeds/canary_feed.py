"""Synthetic feed adapter for exercising the webhook pump without AWS.

Emits one synthetic Linear ``AgentSessionEvent`` (``created``) — the only webhook
shape Cyrus runs sessions off — then idles, so the execution loop can be driven
end-to-end without an SQS connection. Carries no runtime dependency on the proxy
core: it returns plain dicts conforming to the boundary TypedDicts, which are
imported under ``TYPE_CHECKING`` only (mirroring ``sqs_feed``).

The webhook is a pointer, not the work: Cyrus re-fetches the issue from the Linear
API by ``agentSession.issue.id`` and uses its description as the agent's task. So
the body is built from a :class:`CanaryIdentity` whose fields default to harmless
placeholders (safe to commit); point the canary at a real workspace/issue via the
``CYRUS_PROXY_CANARY_*`` env vars (see :meth:`CanaryIdentity.from_env`):

- ``CYRUS_PROXY_CANARY_ORG_ID``            — organizationId (must match a configured
  Cyrus workspace for routing to resolve)
- ``CYRUS_PROXY_CANARY_ISSUE_ID``          — the real issue UUID Cyrus will fetch
- ``CYRUS_PROXY_CANARY_ISSUE_IDENTIFIER``  — e.g. ``DC-1``
- ``CYRUS_PROXY_CANARY_TEAM_KEY``          — e.g. ``DC``
- ``CYRUS_PROXY_CANARY_SESSION_ID``        — agentSession id (synthetic is fine; a
  non-existent session just makes Cyrus's post-backs no-op)
- ``CYRUS_PROXY_CANARY_APP_USER_ID`` / ``_OAUTH_CLIENT_ID``
- ``CYRUS_PROXY_CANARY_CREATOR_ID`` / ``_CREATOR_NAME`` / ``_CREATOR_EMAIL``
- ``CYRUS_PROXY_CANARY_CREATED_AT``        — ISO8601 timestamp stamped on the event
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Mapping, Optional

from proxy.linear_signature import sign as _hmac_sign

if TYPE_CHECKING:
    from proxy.messages import FeedError, LinearWebhookMessage, WebhookFeedEnvelope

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CanaryIdentity:
    """The workspace/issue identifiers stamped into the synthetic AgentSessionEvent.

    Defaults are deliberately fake placeholders so the canary is safe to commit and
    runs as a transport-only smoke test out of the box. Override via env
    (:meth:`from_env`) to drive a real Cyrus run: at minimum ``organization_id`` must
    match a configured workspace and ``issue_id`` must be a real issue Cyrus's token
    can fetch.
    """

    organization_id: str = "canary-org-id"
    app_user_id: str = "canary-app-user-id"
    oauth_client_id: str = "canary-oauth-client-id"
    session_id: str = "00000000-0000-4000-8000-000000000c01"
    issue_id: str = "canary-issue-id"
    issue_identifier: str = "CANARY-1"
    team_key: str = "CANARY"
    creator_id: str = "canary-creator-id"
    creator_name: str = "Canary"
    creator_email: str = "canary@example.com"
    created_at: str = "1970-01-01T00:00:00.000Z"

    # env var suffix (under the CYRUS_PROXY_CANARY_ prefix) -> field name
    _ENV_FIELDS = {
        "ORG_ID": "organization_id",
        "APP_USER_ID": "app_user_id",
        "OAUTH_CLIENT_ID": "oauth_client_id",
        "SESSION_ID": "session_id",
        "ISSUE_ID": "issue_id",
        "ISSUE_IDENTIFIER": "issue_identifier",
        "TEAM_KEY": "team_key",
        "CREATOR_ID": "creator_id",
        "CREATOR_NAME": "creator_name",
        "CREATOR_EMAIL": "creator_email",
        "CREATED_AT": "created_at",
    }

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "CanaryIdentity":
        """Build an identity from ``CYRUS_PROXY_CANARY_*`` env vars; unset ones default."""
        env = os.environ if env is None else env
        overrides = {
            field: env[f"CYRUS_PROXY_CANARY_{suffix}"]
            for suffix, field in cls._ENV_FIELDS.items()
            if f"CYRUS_PROXY_CANARY_{suffix}" in env
        }
        return cls(**overrides)


def _sign(body: bytes, secret: Optional[str]) -> str:
    """Sign the canary body, or emit a placeholder when no secret is configured.

    Delegates the real HMAC to :func:`proxy.linear_signature.sign` so the canary
    signs bodies exactly as the ingress Lambda verifies them. When no secret is
    set the canary is a transport-only smoke test, so a non-validating placeholder
    is returned.
    """
    if not secret:
        return "canary-unsigned"
    return _hmac_sign(body, secret)


def _build_canary_body(identity: CanaryIdentity) -> bytes:
    """Render the synthetic AgentSessionEvent ``created`` body as JSON bytes."""
    payload = {
        "type": "AgentSessionEvent",
        "action": "created",
        "organizationId": identity.organization_id,
        "appUserId": identity.app_user_id,
        "oauthClientId": identity.oauth_client_id,
        "createdAt": identity.created_at,
        "agentSession": {
            "id": identity.session_id,
            "status": "pending",
            "type": "commentThread",
            "createdAt": identity.created_at,
            "updatedAt": identity.created_at,
            "organizationId": identity.organization_id,
            "appUserId": identity.app_user_id,
            "creator": {
                "id": identity.creator_id,
                "name": identity.creator_name,
                "email": identity.creator_email,
            },
            "issue": {
                "id": identity.issue_id,
                "identifier": identity.issue_identifier,
                "team": {"key": identity.team_key},
            },
        },
    }
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def _build_canary_message(
    signing_secret: Optional[str], identity: CanaryIdentity
) -> "LinearWebhookMessage":
    body = _build_canary_body(identity)
    return {
        "body": body,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Linear-Event": "AgentSessionEvent",
            "Linear-Delivery": "canary-delivery",
            "User-Agent": "Linear-Webhook",
            "Linear-Signature": _sign(body, signing_secret),
        },
        "raw": {"source": "canary"},
    }


class CanaryLinearWebhookFeed:
    """Synthetic feed for exercising the pump without an SQS connection.

    Emits its synthetic message(s) ONCE, then idles by sleeping (mirroring SQS
    long-poll so the run loop does not busy-spin). ``acknowledge`` is a no-op —
    there is no queue to delete from. The body is built from ``identity`` (see
    :class:`CanaryIdentity`). If a signing secret is given, the body carries a valid
    Linear-Signature so a Cyrus that verifies it will accept the request; without one
    the signature is a placeholder (transport-only check).
    """

    def __init__(
        self,
        *,
        signing_secret: Optional[str] = None,
        identity: Optional[CanaryIdentity] = None,
        idle_seconds: int = 20,
        sleep: Callable[[float], None] = time.sleep,
        messages: Optional[list] = None,
    ) -> None:
        self._pending = (
            list(messages)
            if messages is not None
            else [_build_canary_message(signing_secret, identity or CanaryIdentity())]
        )
        self._idle_seconds = idle_seconds
        self._sleep = sleep

    def receive(self) -> "WebhookFeedEnvelope":
        if self._pending:
            batch = self._pending
            self._pending = []
            logger.info("canary emitting %d synthetic webhook(s)", len(batch))
            return {"messages": batch, "error": None}
        self._sleep(self._idle_seconds)
        return {"messages": [], "error": None}

    def acknowledge(self, message: "LinearWebhookMessage") -> "Optional[FeedError]":
        logger.info("canary acknowledged (no-op)")
        return None
