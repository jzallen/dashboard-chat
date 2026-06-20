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

import time
from typing import Any, Callable, Mapping, Optional


def row_is_offline(item: Optional[Mapping[str, Any]], now: float) -> bool:
    """Return whether a presence row means the consumer is offline.

    ``item`` is a DynamoDB low-level item (``{"connected": {"BOOL": ...}, "ttl":
    {"N": "..."}}``) or ``None`` when no row exists. Offline when the row is
    absent, ``connected`` is not ``True``, or the ``ttl`` epoch-seconds value is
    at or before ``now`` (expired). Online only for a present, connected,
    unexpired row.
    """
    if not item:
        return True

    if item.get("connected", {}).get("BOOL") is not True:
        return True

    ttl_raw = item.get("ttl", {}).get("N")
    if ttl_raw is not None:
        try:
            if float(ttl_raw) <= now:
                return True
        except (TypeError, ValueError):
            return True

    return False


def make_offline_check(
    dynamodb_client: Any,
    table_name: str,
    *,
    now: Callable[[], float] = time.time,
) -> Callable[[str], bool]:
    """Build the ``is_offline(username) -> bool`` boundary backed by DynamoDB.

    Returns a callable that does a single ``GetItem`` on ``table_name`` keyed by
    ``username`` and applies :func:`row_is_offline` against the current ``now()``.
    Injectable ``now`` keeps the TTL-expiry branch unit-testable.
    """

    def is_offline(username: str) -> bool:
        response = dynamodb_client.get_item(
            TableName=table_name,
            Key={"username": {"S": username}},
        )
        return row_is_offline(response.get("Item"), now())

    return is_offline
