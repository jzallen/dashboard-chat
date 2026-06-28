"""Structured JSON logging wired to the cross-service envelope.

The backend joins the same trace as the Node services by emitting every log
record as the shared ``LogRecord`` envelope (``@timestamp`` / ``log.level`` /
``event.module`` / ``event.action`` / ``attributes``) and injecting the bound
``correlation_id`` under ``attributes`` on EVERY record — read from the
``ContextVar`` at format time, so a line emitted deep inside a use case carries
the request's id with no signature threading.

The startup image-identity line is a direct ``print`` (see ``app.version``), not
a logging record, so it is unaffected by this configuration.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from logging.config import dictConfig
from typing import Any

from .context import get_correlation_id

_RESERVED = frozenset(logging.makeLogRecord({}).__dict__.keys()) | {"message", "asctime", "taskName"}

CORRELATION_ATTRIBUTE = "correlation_id"


class CorrelationJsonFormatter(logging.Formatter):
    """Render a ``logging.LogRecord`` as the shared JSON envelope.

    ``event.module`` is the logger name, ``event.action`` the rendered message,
    and ``attributes`` carries the bound ``correlation_id`` plus any structured
    fields passed via ``extra=...``. An attached exception is rendered into
    ``attributes['error.stack']``.
    """

    def format(self, record: logging.LogRecord) -> str:
        attributes: dict[str, Any] = {
            key: value for key, value in record.__dict__.items() if key not in _RESERVED and not key.startswith("_")
        }

        correlation_id = get_correlation_id()
        if correlation_id:
            attributes[CORRELATION_ATTRIBUTE] = correlation_id

        if record.exc_info:
            attributes["error.stack"] = self.formatException(record.exc_info)

        envelope: dict[str, Any] = {
            "@timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat().replace("+00:00", "Z"),
            "log.level": record.levelname.lower(),
            "event.module": record.name,
            "event.action": record.getMessage(),
        }
        if attributes:
            envelope["attributes"] = attributes

        return json.dumps(envelope, default=str)


def configure_logging() -> None:
    """Install the JSON formatter on the root handler via ``dictConfig``.

    Idempotent and additive: existing loggers keep emitting; only their wire
    format changes to the shared envelope. ``LOG_LEVEL`` (default ``INFO``)
    controls verbosity, matching the Node services.
    """
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "correlation_json": {
                    "()": f"{__name__}.CorrelationJsonFormatter",
                }
            },
            "handlers": {
                "stdout": {
                    "class": "logging.StreamHandler",
                    "stream": "ext://sys.stdout",
                    "formatter": "correlation_json",
                }
            },
            "root": {
                "handlers": ["stdout"],
                "level": level,
            },
        }
    )
