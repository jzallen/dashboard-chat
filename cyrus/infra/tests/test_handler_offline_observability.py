"""Specification for offline-path observability.

The honest 503 must also be *observable*: the same fact emitted in the HTTP body
is emitted to logs so an operator can correlate the failure in CloudWatch. The
log carries structured fields — ``reason="consumer_offline"``, the
``consumer_id`` (username), and the ``creator.id`` UUID correlation key — asserted
on the log record, not via a brittle substring match. The offline log is
distinguishable from the ``_unrouted`` and transient-publish-failure logs by its
``reason`` field.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. Assert on record
attributes (``record.reason`` etc.), not the formatted message text.
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock

from conftest import (
    CREATOR_ID,
    USERNAME,
    StubPresence,
    headers_for,
    make_env,
    make_function_url_event,
)

from handler import process


def _offline_record(caplog):
    return next(r for r in caplog.records if getattr(r, "reason", None))


def test_process__iot_only_offline__emits_structured_log_with_username_and_creator_id(
    caplog, routable_body
):
    """The 503 path logs reason + consumer_id (username) + creator.id correlation."""
    event = make_function_url_event(routable_body, headers_for(routable_body))

    with caplog.at_level(logging.WARNING):
        result = process(
            event,
            make_env(delivery_mode="iot-only"),
            sqs_client=lambda: MagicMock(),
            iot_client=lambda: MagicMock(),
            presence=lambda: StubPresence(lambda username: True),
        )

    assert result["statusCode"] == 503
    record = _offline_record(caplog)
    assert record.reason == "consumer_offline"
    assert record.consumer_id == USERNAME
    assert record.creator_id == CREATOR_ID


def test_process__iot_only_online__emits_no_offline_log(caplog, routable_body):
    """An online consumer must not emit the offline log."""
    event = make_function_url_event(routable_body, headers_for(routable_body))

    with caplog.at_level(logging.WARNING):
        process(
            event,
            make_env(delivery_mode="iot-only"),
            sqs_client=lambda: MagicMock(),
            iot_client=lambda: MagicMock(),
            presence=lambda: StubPresence(lambda username: False),
        )

    assert not [r for r in caplog.records if getattr(r, "reason", None)]
