"""cyrus webhook proxy core — message model, ports, and the execution loop.

Public surface:
- ``ProxyExecutionLoop`` — the pump that polls the feed, forwards each message, and
  acknowledges the successful forwards.
- ``CoreConfig`` / ``SqsConfig`` / ``CanaryConfig`` — operator settings as a GoF
  Decorator (the core component plus per-feed decorators), and ``config_from_env``
  to pick the feed config from the environment.
- ``LinearWebhookFeedProtocol`` / ``WebhookForwarderProtocol`` — the ports the loop
  consumes (the source and the replay), owned in ``execution_loop``.
- ``CyrusHTTPForwarder`` — the HTTP forwarder satisfying ``WebhookForwarderProtocol``.
- ``LinearWebhookMessage`` — value object carrying the raw body bytes and the Linear
  HTTP headers needed to reconstruct Linear's original request.
- ``WebhookFeedEnvelope`` / ``FeedError`` / ``FeedErrorEnum`` — the feed poll result
  shape and the handled-error types it can carry.
- ``ForwardError`` / ``ForwardErrorEnum`` — the handled-error types the forwarder
  returns instead of raising.
"""

import logging

from proxy.config import CanaryConfig, CoreConfig, SqsConfig, config_from_env
from proxy.execution_loop import (
    LinearWebhookFeedProtocol,
    ProxyExecutionLoop,
    WebhookForwarderProtocol,
)
from proxy.http_forwarder import CyrusHTTPForwarder

# Library code only emits; the app configures handlers. A NullHandler keeps the
# package silent (and free of "no handlers" noise) until an app opts in.
logging.getLogger(__name__).addHandler(logging.NullHandler())
from proxy.messages import (
    FeedError,
    FeedErrorEnum,
    ForwardError,
    ForwardErrorEnum,
    LinearWebhookMessage,
    WebhookFeedEnvelope,
)

__all__ = [
    "CoreConfig",
    "SqsConfig",
    "CanaryConfig",
    "config_from_env",
    "ProxyExecutionLoop",
    "LinearWebhookFeedProtocol",
    "WebhookForwarderProtocol",
    "CyrusHTTPForwarder",
    "LinearWebhookMessage",
    "WebhookFeedEnvelope",
    "FeedError",
    "FeedErrorEnum",
    "ForwardError",
    "ForwardErrorEnum",
]
