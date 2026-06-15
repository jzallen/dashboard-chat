"""User-adjustable settings for the proxy execution loop.

Settings are modeled as a Gang-of-Four Decorator: ``CoreConfig`` is the component
holding the knobs every run needs, and each feed wraps it with a decorator
(``SqsConfig``, ``CanaryConfig``) that adds feed-specific settings while forwarding
the core's interface via delegation properties. ``config_from_env`` selects the
right decorator from the environment. Construct any of them directly (e.g. in a
custom entrypoint) or use ``from_env`` to read the process environment; defaults are
applied where a sensible value is known.

Environment variables (read by ``from_env`` / ``config_from_env``):

- ``CYRUS_PROXY_BASE_URL``                — base URL where the local Cyrus daemon
  listens, e.g. ``http://localhost:3456`` (required)
- ``CYRUS_PROXY_FEED``                    — which feed to run, ``sqs`` or ``canary``
  (default ``sqs``)
- ``CYRUS_PROXY_QUEUE_URL``               — SQS queue to poll (required for ``sqs``)
- ``CYRUS_PROXY_MAX_MESSAGES``            — messages per poll (default 10, the SQS cap)
- ``CYRUS_PROXY_WAIT_SECONDS``            — SQS long-poll wait per receive in seconds
  (default 20, the SQS cap)
- ``CYRUS_PROXY_ERROR_BACKOFF_SECONDS``   — sleep after a failed cycle, in seconds
  (default 5.0); applied only when a cycle errors, not between clean polls
- ``CYRUS_PROXY_FORWARD_TIMEOUT_SECONDS``  — per-request timeout when replaying a
  webhook to Cyrus, in seconds (default 30.0); bounds a slow/processing Cyrus so it
  cannot hang the pump
- ``CYRUS_PROXY_LOG_LEVEL``               — process log level (default ``INFO``)
- ``CYRUS_PROXY_CANARY_SIGNING_SECRET``   — signing secret for the canary body's
  ``Linear-Signature`` (optional; placeholder signature when unset)
- ``CYRUS_PROXY_CANARY_IDLE_SECONDS``     — canary idle sleep after draining, in
  seconds (default 20)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Union


@dataclass(frozen=True)
class CoreConfig:
    """Settings every run needs, regardless of feed (the GoF component)."""

    cyrus_base_url: str
    log_level: str = "INFO"
    error_backoff_seconds: float = 5.0
    forward_timeout_seconds: float = 30.0

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "CoreConfig":
        env = os.environ if env is None else env
        settings: dict[str, Any] = {"cyrus_base_url": env["CYRUS_PROXY_BASE_URL"]}
        if "CYRUS_PROXY_LOG_LEVEL" in env:
            settings["log_level"] = env["CYRUS_PROXY_LOG_LEVEL"]
        if "CYRUS_PROXY_ERROR_BACKOFF_SECONDS" in env:
            settings["error_backoff_seconds"] = float(
                env["CYRUS_PROXY_ERROR_BACKOFF_SECONDS"]
            )
        if "CYRUS_PROXY_FORWARD_TIMEOUT_SECONDS" in env:
            settings["forward_timeout_seconds"] = float(
                env["CYRUS_PROXY_FORWARD_TIMEOUT_SECONDS"]
            )
        return cls(**settings)


@dataclass(frozen=True)
class _ConfigDecorator:
    """Base decorator: wraps a CoreConfig and forwards its interface."""

    core: CoreConfig

    @property
    def cyrus_base_url(self) -> str:
        return self.core.cyrus_base_url

    @property
    def log_level(self) -> str:
        return self.core.log_level

    @property
    def error_backoff_seconds(self) -> float:
        return self.core.error_backoff_seconds

    @property
    def forward_timeout_seconds(self) -> float:
        return self.core.forward_timeout_seconds


@dataclass(frozen=True)
class SqsConfig(_ConfigDecorator):
    """Core config extended with SQS feed settings."""

    sqs_queue_url: str
    sqs_max_messages: int = 10
    sqs_wait_seconds: int = 20

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "SqsConfig":
        env = os.environ if env is None else env
        settings: dict[str, Any] = {
            "core": CoreConfig.from_env(env),
            "sqs_queue_url": env["CYRUS_PROXY_QUEUE_URL"],
        }
        if "CYRUS_PROXY_MAX_MESSAGES" in env:
            settings["sqs_max_messages"] = int(env["CYRUS_PROXY_MAX_MESSAGES"])
        if "CYRUS_PROXY_WAIT_SECONDS" in env:
            settings["sqs_wait_seconds"] = int(env["CYRUS_PROXY_WAIT_SECONDS"])
        return cls(**settings)


@dataclass(frozen=True)
class CanaryConfig(_ConfigDecorator):
    """Core config extended with canary feed settings."""

    signing_secret: Optional[str] = None
    idle_seconds: int = 20

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "CanaryConfig":
        env = os.environ if env is None else env
        settings: dict[str, Any] = {"core": CoreConfig.from_env(env)}
        if "CYRUS_PROXY_CANARY_SIGNING_SECRET" in env:
            settings["signing_secret"] = env["CYRUS_PROXY_CANARY_SIGNING_SECRET"]
        if "CYRUS_PROXY_CANARY_IDLE_SECONDS" in env:
            settings["idle_seconds"] = int(env["CYRUS_PROXY_CANARY_IDLE_SECONDS"])
        return cls(**settings)


FeedConfig = Union[SqsConfig, CanaryConfig]


def config_from_env(env: Optional[Mapping[str, str]] = None) -> FeedConfig:
    """Pick the feed config from ``CYRUS_PROXY_FEED`` (``sqs`` default, or ``canary``)."""
    env = os.environ if env is None else env
    if env.get("CYRUS_PROXY_FEED", "sqs") == "canary":
        return CanaryConfig.from_env(env)
    return SqsConfig.from_env(env)
