"""Consumer-presence read for offline detection.

The ingress Lambda decides "is ``<username>`` connected right now?" with an O(1)
read of the DynamoDB presence table (provisioned by the CDK stack), kept fresh
out of band by IoT lifecycle events. There is no live round-trip to the consumer:
the Lambda→IoT publish is fire-and-forget over HTTPS and succeeds even with zero
subscribers, so it cannot itself reveal "offline".

A consumer is treated as **offline** when its row is absent, reports
``connected = false``, or has a TTL at/before now. TTL deletion is best-effort and
eventually consistent, so an expired-but-not-yet-reaped row must still read as
offline — hence the explicit ``ttl`` comparison here rather than trusting DynamoDB
to have removed it.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Mapping, Optional

_log = logging.getLogger(__name__)


def row_is_offline(item: Optional[Mapping[str, Any]], now: float) -> bool:
    """Return whether a presence row means the consumer is offline.

    ``item`` is a DynamoDB low-level item (``{"connected": {"BOOL": ...}, "ttl":
    {"N": "..."}}``) or ``None`` when no row exists. Offline when the row is
    absent, ``connected`` is not ``True``, or the ``ttl`` epoch-seconds value is
    at or before ``now`` (expired). Online only for a present, connected,
    unexpired row. A schema-drifted row (an attribute that is not the expected
    ``{type: value}`` shape) fails closed to offline rather than raising.
    """
    if not item:
        return True

    connected = item.get("connected")
    if not isinstance(connected, Mapping) or connected.get("BOOL") is not True:
        return True

    ttl_attr = item.get("ttl")
    ttl_raw = ttl_attr.get("N") if isinstance(ttl_attr, Mapping) else None
    if ttl_raw is not None:
        try:
            if float(ttl_raw) <= now:
                return True
        except (TypeError, ValueError):
            return True

    return False


class DynamoDBConsumerPresence:
    """``ConsumerPresenceRepository`` backed by the DynamoDB presence table.

    ``is_offline`` does a single ``GetItem`` on ``table_name`` keyed by ``username``
    and applies :func:`row_is_offline` against the current ``now()``. Injectable
    ``now`` keeps the TTL-expiry branch unit-testable.

    The read **fails closed**: any DynamoDB error (throttle, network, missing IAM
    grant) is treated as offline. In ``iot-only`` mode there is no SQS safety net,
    so a presence-cache blip must yield an honest 503 (which Linear retries) rather
    than crash the invocation and silently lose the webhook.
    """

    def __init__(
        self,
        dynamodb_client: Any,
        table_name: str,
        *,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._dynamodb_client = dynamodb_client
        self._table_name = table_name
        self._now = now

    def is_offline(self, username: str) -> bool:
        try:
            response = self._dynamodb_client.get_item(
                TableName=self._table_name,
                Key={"username": {"S": username}},
            )
        except Exception:
            _log.warning(
                "presence read failed for %s; failing closed to offline",
                username,
                exc_info=True,
            )
            return True
        return row_is_offline(response.get("Item"), self._now())


class AlwaysOnlinePresence:
    """Null ``ConsumerPresenceRepository``: no presence cache wired, never offline.

    Used in ``dual-write`` (which has no offline gate) and in ``iot-only`` without a
    ``PRESENCE_TABLE``, so the addressed-consumer use case can call ``is_offline``
    unconditionally instead of guarding a missing presence boundary.
    """

    def is_offline(self, username: str) -> bool:
        return False
