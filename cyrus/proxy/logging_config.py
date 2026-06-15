"""Application logging configuration for the proxy entrypoint.

Library modules only *emit* through their module loggers; nothing in the library
configures handlers (each top-level package installs a ``NullHandler`` so importing
it stays silent until an app opts in). The executable entrypoint
(``ProxyExecutionLoop.run``) calls :func:`configure_logging` once to attach a
handler and set the level, so logs appear when the pump actually runs but never
during tests or library use.
"""

from __future__ import annotations

import logging


def configure_logging(level: str = "INFO") -> None:
    """Attach a stderr handler and set the root level for the running process.

    Idempotent in the usual sense of ``logging.basicConfig`` — it only installs a
    handler if the root logger has none. ``level`` is a standard level name
    (``DEBUG``/``INFO``/``WARNING``/...), case-insensitive.
    """
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
