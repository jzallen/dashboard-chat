"""Specification for the delivery-mode seam and the offline→503 policy branch.

``process`` carries a per-deploy ``delivery_mode``:

* ``dual-write`` (default) — today's behavior: optimistic IoT publish beside the
  SQS enqueue, log-on-error, always 200. Covered by ``test_handler_iot_dual_write``.
* ``iot-only`` (future operative mode) — no SQS fallback. A routed consumer that
  the injected ``is_offline`` boundary reports offline yields an honest **HTTP
  503** with a machine-readable ``consumer-offline`` body; an online consumer is
  published to and gets 200; neither touches SQS.

``_unrouted`` (no derivable username) is distinct from "mapped but offline": it
is NEVER the 503 path — it publishes to the catch-all topic and returns 200.

The offline signal is injected at the ``process`` boundary as a plain
``is_offline(username) -> bool`` callable, so this skeleton needs no real
AWS/IoT presence mechanism (that lands in the blocked sub-issues).

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. The 503 body shape and
the "SQS never called in iot-only" invariant are load-bearing — do not weaken
them.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from conftest import (
    QUEUE_URL,
    SECRET,
    TOPIC_PREFIX,
    USERNAME,
    headers_for,
    make_function_url_event,
)

from handler import process


def test_iot_only_offline_returns_503_naming_the_consumer_and_action(routable_body):
    """iot-only + routed + offline → an honest 503 whose body names the offline
    consumer by username and tells the operator how to bring it back."""
    event = make_function_url_event(routable_body, headers_for(routable_body))

    result = process(
        event,
        queue_url=QUEUE_URL,
        secret=SECRET,
        sqs_client=MagicMock(),
        iot_data_client=MagicMock(),
        delivery_mode="iot-only",
        is_offline=lambda username: True,
    )

    assert {"statusCode": result["statusCode"], "body": json.loads(result["body"])} == {
        "statusCode": 503,
        "body": {
            "reason": "consumer-offline",
            "consumer_id": USERNAME,
            "action": f"start local cyrus consumer with consumer id {USERNAME}",
        },
    }


def test_iot_only_offline_neither_publishes_nor_enqueues(routable_body):
    """The offline path is terminal: nothing reaches IoT or SQS."""
    iot = MagicMock()
    sqs = MagicMock()

    event = make_function_url_event(routable_body, headers_for(routable_body))
    process(
        event,
        queue_url=QUEUE_URL,
        secret=SECRET,
        sqs_client=sqs,
        iot_data_client=iot,
        delivery_mode="iot-only",
        is_offline=lambda username: True,
    )

    assert (iot.publish.called, sqs.send_message.called) == (False, False)


def test_iot_only_keys_the_offline_check_by_the_username_natural_key(routable_body):
    """The presence boundary is keyed by the natural key (username), proven through
    the response: a check that only recognizes the username drives the offline 503,
    so a 503 confirms the username was the key passed (no boundary-call spying)."""
    event = make_function_url_event(routable_body, headers_for(routable_body))

    result = process(
        event,
        queue_url=QUEUE_URL,
        secret=SECRET,
        sqs_client=MagicMock(),
        iot_data_client=MagicMock(),
        delivery_mode="iot-only",
        is_offline=lambda key: key == USERNAME,
    )

    assert result["statusCode"] == 503


def test_iot_only_online_publishes_and_returns_200_without_sqs(routable_body):
    """iot-only + routed + online → publish to the username topic, 200, no SQS."""
    iot = MagicMock()
    sqs = MagicMock()
    headers = headers_for(routable_body)

    event = make_function_url_event(routable_body, headers)
    result = process(
        event,
        queue_url=QUEUE_URL,
        secret=SECRET,
        sqs_client=sqs,
        iot_data_client=iot,
        delivery_mode="iot-only",
        is_offline=lambda username: False,
    )

    iot.publish.assert_called_once_with(
        topic=f"{TOPIC_PREFIX}{USERNAME}",
        payload=routable_body.encode("utf-8"),
    )
    sqs.send_message.assert_not_called()
    assert result["statusCode"] == 200


def test_iot_only_unrouted_publishes_to_catch_all_and_is_never_the_503_path(
    webhook_body,
):
    """_unrouted in iot-only is distinct from offline: catch-all publish, not 503.

    ``webhook_body`` has no ``agentSession.creator.url``, so the routing key is the
    ``_unrouted`` sentinel. Even with a boundary that would report offline, the
    handler must NOT take the 503 path for an unrouted event.
    """
    iot = MagicMock()
    sqs = MagicMock()
    headers = headers_for(webhook_body)

    event = make_function_url_event(webhook_body, headers)
    result = process(
        event,
        queue_url=QUEUE_URL,
        secret=SECRET,
        sqs_client=sqs,
        iot_data_client=iot,
        delivery_mode="iot-only",
        is_offline=lambda username: True,
    )

    iot.publish.assert_called_once_with(
        topic=f"{TOPIC_PREFIX}_unrouted",
        payload=webhook_body.encode("utf-8"),
    )
    sqs.send_message.assert_not_called()
    assert result["statusCode"] == 200


def test_iot_only_publish_failure_propagates_and_never_falls_back_to_sqs(routable_body):
    """iot-only has no safety net: a publish failure propagates (→ 5xx, Linear
    retries) and must never silently enqueue to SQS instead."""
    iot = MagicMock()
    iot.publish.side_effect = RuntimeError("iot data-plane unreachable")
    sqs = MagicMock()
    headers = headers_for(routable_body)

    event = make_function_url_event(routable_body, headers)
    with pytest.raises(RuntimeError):
        process(
            event,
            queue_url=QUEUE_URL,
            secret=SECRET,
            sqs_client=sqs,
            iot_data_client=iot,
            delivery_mode="iot-only",
            is_offline=lambda username: False,
        )

    sqs.send_message.assert_not_called()


def test_default_delivery_mode_is_dual_write(routable_body):
    """Omitting delivery_mode keeps the dual-write path: publish + SQS + 200."""
    iot = MagicMock()
    sqs = MagicMock()
    headers = headers_for(routable_body)

    event = make_function_url_event(routable_body, headers)
    result = process(
        event,
        queue_url=QUEUE_URL,
        secret=SECRET,
        sqs_client=sqs,
        iot_data_client=iot,
    )

    iot.publish.assert_called_once()
    sqs.send_message.assert_called_once()
    assert result == {"statusCode": 200, "body": "queued"}
