"""Transport-agnostic message model and feed result types for the proxy core.

These are the data shapes the feed port (:mod:`proxy.http_forwarder`) speaks in,
shared across the proxy core and any feed adapter, independent of how messages
are sourced (SQS, in-memory, etc.):

- ``LinearWebhookMessage`` — a single webhook event, ready to replay.
- ``WebhookFeedEnvelope`` — the result of a poll: pending messages and/or a
  handled error.
- ``FeedError`` / ``FeedErrorEnum`` — a handled error the forwarder knows how to
  react to (rather than the feed raising).
- ``ForwardError`` / ``ForwardErrorEnum`` — a handled error the HTTP forwarder
  returns instead of raising.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Mapping, Optional, Sequence, TypedDict


class LinearWebhookMessage(TypedDict):
    """A Linear webhook event sourced from a feed, ready to replay to Cyrus.

    A structurally-typed boundary DTO (``TypedDict``, no behavior): any feed adapter
    produces a conforming dict without importing this type. It exposes only what is
    needed to reconstruct the *exact* HTTP request Linear originally sent — so a
    replay to Cyrus's ``/webhook`` is byte-for-byte indistinguishable from Linear
    calling directly — plus the opaque source payload the producing adapter owns.

    Keys:
        body: The raw webhook request body as bytes — exactly the bytes Linear
            POSTed. Kept as bytes because ``Linear-Signature`` is an HMAC over the
            raw body; any re-encoding would invalidate verification.
        headers: The Linear HTTP headers needed for replay — e.g. ``Content-Type``,
            ``Linear-Event``, ``Linear-Delivery``, ``Linear-Signature``,
            ``User-Agent``.
        raw: The service-specific source payload (e.g. the original SQS message),
            opaque to the proxy core. The adapter that produced the message reads
            whatever it needs from here (such as an SQS receipt handle) when the
            forwarder acknowledges it, so transport details never leak into the
            HTTP-facing keys above.
    """

    body: bytes
    headers: Mapping[str, str]
    raw: Any


class FeedErrorEnum(str, Enum):
    """Categories of feed error the forwarder knows how to handle.

    A feed surfaces one of these (in a receive envelope, or returned from
    acknowledge) rather than raising, when an operation fails in a way the
    forwarder can react to. The set is intentionally small and grows over time;
    unknown/unhandled failures are left to propagate and are dealt with in the
    forwarder.
    """

    FAILED_FEED_RECEIVE = "failed_feed_receive"  # receive() could not fetch messages
    FAILED_MESSAGE_ACKNOWLEDGE = "failed_message_acknowledge"  # acknowledge() failed
    THROTTLED = "throttled"  # source rate-limited the poll; back off and retry


class FeedError(TypedDict):
    """A handled feed error: its category plus a human-readable reason."""

    type: FeedErrorEnum
    reason: str


class WebhookFeedEnvelope(TypedDict):
    """The result of a single feed poll.

    On a clean poll, ``messages`` holds the pending messages and ``error`` is
    ``None``. On a handled failure, ``messages`` is empty and ``error`` describes
    what went wrong so the forwarder can react instead of crashing.
    """

    messages: Sequence[LinearWebhookMessage]
    error: Optional[FeedError]


class ForwardErrorEnum(str, Enum):
    """Categories of forward error the caller can handle.

    The HTTP forwarder returns one of these (rather than raising) when a replay to
    Cyrus fails. Intentionally small; grows as the caller gains handling for new
    conditions.
    """

    FAILED_FORWARD_REQUEST = "failed_forward_request"  # the replay to Cyrus failed


class ForwardError(TypedDict):
    """A handled forward error: its category plus a human-readable reason."""

    type: ForwardErrorEnum
    reason: str
