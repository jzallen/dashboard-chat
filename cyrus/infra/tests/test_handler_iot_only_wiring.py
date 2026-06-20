"""Specification for handler() wiring the iot-only delivery mode end to end.

In ``iot-only`` the offline boundary is a real DynamoDB presence read, selected
by the ``DELIVERY_MODE`` env flag. These pin the env → process() wiring: an
``iot-only`` deploy with an offline presence row returns the honest 503 (no SQS);
an unknown ``DELIVERY_MODE`` falls back to dual-write so a misconfiguration never
drops the safety net.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. The "unknown mode →
dual-write" fallback and "iot-only offline → 503, no SQS" invariants are
load-bearing.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from conftest import (
    QUEUE_URL,
    SECRET,
    USERNAME,
    headers_for,
    make_function_url_event,
)

from handler import handler


def _wire(monkeypatch, *, iot, sqs, dynamodb=None):
    import handler as handler_mod

    monkeypatch.setenv("QUEUE_URL", QUEUE_URL)
    monkeypatch.setattr(handler_mod, "_load_secret", lambda: SECRET)
    monkeypatch.setattr(handler_mod, "_sqs_client", lambda: sqs)
    monkeypatch.setattr(handler_mod, "_iot_data_client", lambda: iot)
    monkeypatch.setattr(
        handler_mod, "_dynamodb_client", lambda: dynamodb or MagicMock()
    )


def test_handler__iot_only_with_offline_presence_row__returns_503_and_skips_sqs(
    monkeypatch, routable_body
):
    """DELIVERY_MODE=iot-only + an absent presence row → 503, no SQS write."""
    iot, sqs = MagicMock(), MagicMock()
    ddb = MagicMock()
    ddb.get_item.return_value = {}  # no Item ⇒ offline

    monkeypatch.setenv("IOT_ENDPOINT", "iot.example")
    monkeypatch.setenv("DELIVERY_MODE", "iot-only")
    monkeypatch.setenv("PRESENCE_TABLE", "ConsumerPresenceTable")
    _wire(monkeypatch, iot=iot, sqs=sqs, dynamodb=ddb)

    event = make_function_url_event(routable_body, headers_for(routable_body))
    result = handler(event, None)

    assert result["statusCode"] == 503
    ddb.get_item.assert_called_once_with(
        TableName="ConsumerPresenceTable", Key={"username": {"S": USERNAME}}
    )
    sqs.send_message.assert_not_called()
    iot.publish.assert_not_called()


def test_handler__iot_only_with_online_presence_row__publishes_and_returns_200(
    monkeypatch, routable_body
):
    """DELIVERY_MODE=iot-only + a connected, unexpired row → publish, 200, no SQS."""
    iot, sqs = MagicMock(), MagicMock()
    ddb = MagicMock()
    ddb.get_item.return_value = {
        "Item": {"connected": {"BOOL": True}, "ttl": {"N": "9999999999"}}
    }

    monkeypatch.setenv("IOT_ENDPOINT", "iot.example")
    monkeypatch.setenv("DELIVERY_MODE", "iot-only")
    monkeypatch.setenv("PRESENCE_TABLE", "ConsumerPresenceTable")
    _wire(monkeypatch, iot=iot, sqs=sqs, dynamodb=ddb)

    event = make_function_url_event(routable_body, headers_for(routable_body))
    result = handler(event, None)

    assert result["statusCode"] == 200
    iot.publish.assert_called_once()
    sqs.send_message.assert_not_called()


def test_handler__iot_only_without_iot_endpoint__fails_fast(monkeypatch, routable_body):
    """iot-only with no IOT_ENDPOINT has no Data-plane client to publish through;
    the handler must fail fast rather than 500 on every message."""
    iot, sqs = MagicMock(), MagicMock()

    monkeypatch.delenv("IOT_ENDPOINT", raising=False)
    monkeypatch.setenv("DELIVERY_MODE", "iot-only")
    monkeypatch.setenv("PRESENCE_TABLE", "ConsumerPresenceTable")
    _wire(monkeypatch, iot=iot, sqs=sqs)

    event = make_function_url_event(routable_body, headers_for(routable_body))
    with pytest.raises(RuntimeError):
        handler(event, None)

    sqs.send_message.assert_not_called()
    iot.publish.assert_not_called()


def test_handler__unknown_delivery_mode__falls_back_to_dual_write(monkeypatch, routable_body):
    """A bogus DELIVERY_MODE must not drop the SQS safety net — dual-write wins."""
    iot, sqs = MagicMock(), MagicMock()

    monkeypatch.setenv("IOT_ENDPOINT", "iot.example")
    monkeypatch.setenv("DELIVERY_MODE", "bogus-mode")
    _wire(monkeypatch, iot=iot, sqs=sqs)

    event = make_function_url_event(routable_body, headers_for(routable_body))
    result = handler(event, None)

    assert result == {"statusCode": 200, "body": "queued"}
    iot.publish.assert_called_once()
    sqs.send_message.assert_called_once()
