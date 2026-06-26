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


# Third-party loggers that are unbearably verbose at DEBUG and would bury the proxy's
# own webhook diagnostics (botocore dumps every signed SQS request, including temporary
# AWS credentials). They are floored at WARNING so turning the process to DEBUG reveals
# the ``proxy.*`` payload logging without the boto/urllib3 firehose.
_NOISY_LOGGERS = ("botocore", "boto3", "urllib3", "s3transfer")


def configure_logging(level: str = "INFO") -> None:
    """Attach a stderr handler and set the root level for the running process.

    Idempotent in the usual sense of ``logging.basicConfig`` — it only installs a
    handler if the root logger has none. ``level`` is a standard level name
    (``DEBUG``/``INFO``/``WARNING``/...), case-insensitive.

    Chatty AWS SDK loggers are pinned to WARNING regardless of ``level`` so a DEBUG run
    surfaces the proxy's own logging (e.g. the decoded webhook payload) instead of the
    botocore/urllib3 request firehose. Raise an individual one back yourself if you ever
    need to debug the SQS transport itself.
    """
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    for noisy in _NOISY_LOGGERS:
        logging.getLogger(noisy).setLevel(logging.WARNING)
