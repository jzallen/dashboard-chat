"""The proxy execution loop — the pump that ties the feed to the forwarder.

``ProxyExecutionLoop`` is the top-level use case: it polls a feed for pending Linear
webhooks, replays each to Cyrus via a forwarder, and acknowledges the ones that
forward successfully (leaving failures on the feed for redelivery).

Per "use cases own their ports," this module owns the two interfaces the loop
consumes — ``LinearWebhookFeedProtocol`` (the source of pending webhooks) and
``WebhookForwarderProtocol`` (the replay to Cyrus) — and stays ignorant of how
either is implemented; any adapter honoring a contract satisfies it structurally.
"""

from __future__ import annotations

import logging
import signal
import threading
import time
from typing import Callable, Optional, Protocol

from proxy.config import CanaryConfig, IoTConfig, SqsConfig, config_from_env
from proxy.logging_config import configure_logging
from proxy.messages import (
    FeedError,
    ForwardError,
    LinearWebhookMessage,
    WebhookFeedEnvelope,
)

logger = logging.getLogger(__name__)


class LinearWebhookFeedProtocol(Protocol):
    """Port for a source of pending Linear webhook events.

    The loop depends on this contract, not on any particular backing service, so the
    source can be swapped without changing the loop.
    """

    def receive(self) -> WebhookFeedEnvelope:
        """Return a poll result: the pending messages and/or a handled error.

        The caller takes whatever the feed yields and does not size the batch: how
        many messages a batch holds, and how the feed polls, are implementation
        configuration fixed when the concrete feed is constructed. Callers stay
        consistent by simply invoking ``receive()``.

        The result is a :class:`WebhookFeedEnvelope`. A clean poll carries the
        pending messages with ``error`` set to ``None`` (empty messages meaning
        nothing was pending). A failure the loop knows how to handle carries empty
        messages and a populated :class:`FeedError`, so the feed reports it rather
        than raising.
        """
        ...

    def acknowledge(self, message: LinearWebhookMessage) -> Optional[FeedError]:
        """Signal that a message has been fully processed.

        For sources that require explicit removal (e.g. at-least-once delivery) the
        implementation removes the message so it is not redelivered. For sources
        where receiving already consumes the message (it is simply popped), this is
        a no-op hook — a place to log, or to emit a "processed" event to another
        service. Call it once per successfully processed message.

        Returns ``None`` on success (including the no-op case). If the acknowledge
        fails in a way the loop knows how to handle, returns a :class:`FeedError`
        (``FAILED_MESSAGE_ACKNOWLEDGE``) rather than raising; unexpected failures
        propagate.
        """
        ...


class WebhookForwarderProtocol(Protocol):
    """Port for replaying a single webhook to Cyrus.

    The loop depends on this contract, not on a particular HTTP client or Cyrus
    route, so the forwarder can be swapped without changing the loop.
    """

    def forward(self, message: LinearWebhookMessage) -> Optional[ForwardError]:
        """Replay one message to Cyrus; returns ``None`` on success or a handled
        :class:`ForwardError` on a failure the loop can react to."""
        ...


class ProxyExecutionLoop:
    """Polls the feed, forwards each message, acknowledges the successful forwards.

    The feed and forwarder are injected (depended on as ports) for testability and
    so either side can be swapped without touching the orchestration.
    """

    def __init__(
        self,
        feed: LinearWebhookFeedProtocol,
        forwarder: WebhookForwarderProtocol,
    ) -> None:
        self._feed = feed
        self._forwarder = forwarder

    def run_once(self) -> Optional[FeedError]:
        """Process one poll cycle: receive, forward each message, acknowledge wins.

        Forwards every pending message; a message that forwards cleanly (no
        :class:`ForwardError`) is acknowledged so it is not redelivered, while one
        that fails is left on the feed for a later retry. Per-message forward and
        acknowledge failures stay swallowed here (left on the feed for redelivery).

        Returns the feed-level :class:`FeedError` from the poll envelope (or
        ``None`` on a clean poll) so the driver can decide whether to back off.
        """
        envelope = self._feed.receive()
        messages = envelope["messages"]
        if messages:
            logger.info("received %d webhook(s) to forward", len(messages))
        for message in messages:
            if self._forwarder.forward(message) is None:
                self._feed.acknowledge(message)
        return envelope["error"]

    def run_forever(
        self,
        stop: Callable[[], bool],
        sleep: Callable[[float], None] = time.sleep,
        error_backoff_seconds: float = 5.0,
    ) -> None:
        """Drive run_once until stop() is true; back off after a failed cycle.

        A "failed cycle" is either run_once raising (logged with a traceback) or
        run_once reporting a handled feed error (logged at warning). Either way the
        driver sleeps ``error_backoff_seconds`` before the next iteration; a clean
        cycle loops immediately, letting the feed's own long-poll pace the pump.
        """
        while not stop():
            try:
                error = self.run_once()
            except Exception:
                logger.exception("run_once cycle failed; backing off")
                sleep(error_backoff_seconds)
                continue
            if error is not None:
                logger.warning("feed reported %s; backing off", error["type"])
                sleep(error_backoff_seconds)

    @classmethod
    def run(cls, config: Optional[SqsConfig | CanaryConfig | IoTConfig] = None) -> None:
        """Composition root: build deps + stop signal, then drive the loop.

        Selects the concrete feed by ``config`` type — an ``SqsConfig`` builds the
        SQS feed, a ``CanaryConfig`` builds the synthetic canary feed, an
        ``IoTConfig`` builds the AWS IoT keyed-subscription feed — defaulting to
        ``config_from_env()``, wires a SIGINT/SIGTERM-tripped stop event, and hands
        both to :meth:`run_forever`. This is untested assembly/glue — the testable
        behavior lives in ``run_once`` and ``run_forever``. The feed's long-poll (or
        the canary's idle sleep) paces the pump; backing off only happens after a
        failed cycle.

        The concrete adapters are imported locally so importing this module (and the
        ``proxy`` package) stays free of the adapters' transitive deps (boto3, etc.).
        """
        from proxy.http_forwarder import CyrusHTTPForwarder

        config = config or config_from_env()
        configure_logging(config.log_level)
        if isinstance(config, CanaryConfig):
            from webhook_feeds.canary_feed import CanaryIdentity, CanaryLinearWebhookFeed

            feed = CanaryLinearWebhookFeed(
                signing_secret=config.signing_secret,
                identity=CanaryIdentity.from_env(),
                idle_seconds=config.idle_seconds,
            )
            logger.warning(
                "using CANARY feed — emitting a synthetic webhook instead of reading SQS"
            )
        elif isinstance(config, IoTConfig):
            from webhook_feeds.iot_feed import IoTLinearWebhookFeed

            feed = IoTLinearWebhookFeed(
                routing_key=config.iot_routing_key,
                endpoint=config.iot_endpoint,
                region=config.iot_region,
            )
            logger.info(
                "using IoT feed — subscribing to cyrus/v1/sessions/%s",
                config.iot_routing_key,
            )
        else:
            from webhook_feeds.sqs_feed import SQSLinearWebhookFeed

            feed = SQSLinearWebhookFeed(
                queue_url=config.sqs_queue_url,
                max_messages=config.sqs_max_messages,
                wait_seconds=config.sqs_wait_seconds,
            )
        forwarder = CyrusHTTPForwarder(
            base_url=config.cyrus_base_url,
            timeout=config.forward_timeout_seconds,
        )
        loop = cls(feed=feed, forwarder=forwarder)

        stop = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stop.set())

        logger.info("ProxyExecutionLoop starting (cyrus=%s)", config.cyrus_base_url)
        loop.run_forever(
            stop=stop.is_set,
            error_backoff_seconds=config.error_backoff_seconds,
        )
