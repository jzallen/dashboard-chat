"""The JSON formatter injects ``attributes.correlation_id`` on every record."""

import io
import json
import logging

from app.correlation.context import clear_correlation_id, set_correlation_id
from app.correlation.logging_config import CorrelationJsonFormatter


def _capture(logger_name: str):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(CorrelationJsonFormatter())
    logger = logging.getLogger(logger_name)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger, handler, stream


def test_record_emits_shared_envelope_with_correlation_id():
    logger, handler, stream = _capture("app.test.envelope")
    try:
        set_correlation_id("corr-on-the-line")
        logger.info("did.work", extra={"project_id": "p-1"})
    finally:
        logger.removeHandler(handler)
        clear_correlation_id()

    record = json.loads(stream.getvalue())
    assert record["event.module"] == "app.test.envelope"
    assert record["event.action"] == "did.work"
    assert record["log.level"] == "info"
    assert record["attributes"]["correlation_id"] == "corr-on-the-line"
    assert record["attributes"]["project_id"] == "p-1"


def test_record_without_bound_id_omits_correlation_id():
    logger, handler, stream = _capture("app.test.noid")
    try:
        clear_correlation_id()
        logger.info("startup.line")
    finally:
        logger.removeHandler(handler)

    record = json.loads(stream.getvalue())
    assert "correlation_id" not in record.get("attributes", {})
