"""Specification for ProxyExecutionLoop — the receive -> forward -> acknowledge pump.

ProxyExecutionLoop.run_once processes one poll cycle: it asks the feed for pending
Linear webhooks, replays each to Cyrus via the forwarder, and acknowledges the ones
that forwarded successfully (leaving failures on the feed for redelivery). Behavior
covered:

- run_once() forwards each received message
- run_once() acknowledges a message that forwarded successfully
- run_once() does NOT acknowledge a message that failed to forward
- run_once() returns the feed-level error so the driver can back off

run_forever drives run_once until a caller-supplied stop predicate is true, backing
off (sleeping) after any cycle that fails — whether run_once raised or merely
reported a handled feed error — and not sleeping after a clean cycle. Behavior
covered:

- run_forever() drives run_once until stop() is true
- run_forever() keeps going after a cycle raises, backing off once
- run_forever() backs off when the feed reports a handled error
- run_forever() does not back off after a clean cycle

The feed and forwarder are injected as MagicMocks standing in for their ports, so no
SQS or HTTP happens. The run_forever tests drive iterations with a stop predicate
whose successive return values bound the loop, mock run_once on the instance, and
inject a MagicMock sleep so no real waiting occurs.

IF YOU'RE AN AGENT, READ THIS:
- These tests are the specification. Implement the loop to satisfy them; never weaken
  or rewrite an assertion to fit the implementation.
- The loop orchestrates ports it does not own the internals of: assert on the calls
  it makes to the feed and forwarder, not on internal state.
"""

from __future__ import annotations

from unittest.mock import MagicMock, call

from proxy.execution_loop import ProxyExecutionLoop
from proxy.messages import FeedErrorEnum, ForwardErrorEnum, LinearWebhookMessage


def a_linear_webhook_message(signature: str = "a1b2c3") -> LinearWebhookMessage:
    """A minimal message the feed might yield; contents are opaque to the loop.

    ``signature`` lets a test mint distinct messages so multi-message behavior is
    actually exercised rather than asserted against identical copies.
    """
    return {
        "body": b'{"action": "create"}',
        "headers": {"Linear-Signature": signature},
        "raw": {"ReceiptHandle": f"rh-{signature}"},
    }


def test_run_once_forwards_each_received_message() -> None:
    first = a_linear_webhook_message("sig-1")
    second = a_linear_webhook_message("sig-2")
    feed = MagicMock()
    feed.receive.return_value = {"messages": [first, second], "error": None}
    forwarder = MagicMock()
    forwarder.forward.return_value = None
    loop = ProxyExecutionLoop(feed=feed, forwarder=forwarder)

    loop.run_once()

    assert forwarder.forward.call_args_list == [call(first), call(second)]


def test_run_once_acknowledges_a_successfully_forwarded_message() -> None:
    message = a_linear_webhook_message()
    feed = MagicMock()
    feed.receive.return_value = {"messages": [message], "error": None}
    forwarder = MagicMock()
    forwarder.forward.return_value = None
    loop = ProxyExecutionLoop(feed=feed, forwarder=forwarder)

    loop.run_once()

    feed.acknowledge.assert_called_once_with(message)


def test_run_once_does_not_acknowledge_a_message_that_failed_to_forward() -> None:
    message = a_linear_webhook_message()
    feed = MagicMock()
    feed.receive.return_value = {"messages": [message], "error": None}
    forwarder = MagicMock()
    forwarder.forward.return_value = {
        "type": ForwardErrorEnum.FAILED_FORWARD_REQUEST,
        "reason": "502 Bad Gateway",
    }
    loop = ProxyExecutionLoop(feed=feed, forwarder=forwarder)

    loop.run_once()

    forwarder.forward.assert_called_once_with(message)
    feed.acknowledge.assert_not_called()


def test_run_once_returns_the_feed_error() -> None:
    error = {"type": FeedErrorEnum.FAILED_FEED_RECEIVE, "reason": "throttled"}
    feed = MagicMock()
    feed.receive.return_value = {"messages": [], "error": error}
    forwarder = MagicMock()
    loop = ProxyExecutionLoop(feed=feed, forwarder=forwarder)

    result = loop.run_once()

    assert result == error


def test_run_forever_runs_until_stopped() -> None:
    loop = ProxyExecutionLoop(feed=MagicMock(), forwarder=MagicMock())
    loop.run_once = MagicMock(return_value=None)
    stop = MagicMock(side_effect=[False, True])

    loop.run_forever(stop=stop, sleep=MagicMock())

    loop.run_once.assert_called_once_with()


def test_run_forever_continues_after_a_cycle_raises() -> None:
    loop = ProxyExecutionLoop(feed=MagicMock(), forwarder=MagicMock())
    loop.run_once = MagicMock(side_effect=[RuntimeError("boom"), None])
    stop = MagicMock(side_effect=[False, False, True])
    sleep = MagicMock()

    loop.run_forever(stop=stop, sleep=sleep)

    assert loop.run_once.call_count == 2
    sleep.assert_called_once_with(5.0)


def test_run_forever_backs_off_when_the_feed_reports_an_error() -> None:
    error = {"type": FeedErrorEnum.FAILED_FEED_RECEIVE, "reason": "throttled"}
    loop = ProxyExecutionLoop(feed=MagicMock(), forwarder=MagicMock())
    loop.run_once = MagicMock(return_value=error)
    stop = MagicMock(side_effect=[False, True])
    sleep = MagicMock()

    loop.run_forever(stop=stop, sleep=sleep, error_backoff_seconds=5.0)

    sleep.assert_called_once_with(5.0)


def test_run_forever_does_not_back_off_on_a_clean_cycle() -> None:
    loop = ProxyExecutionLoop(feed=MagicMock(), forwarder=MagicMock())
    loop.run_once = MagicMock(return_value=None)
    stop = MagicMock(side_effect=[False, True])
    sleep = MagicMock()

    loop.run_forever(stop=stop, sleep=sleep)

    sleep.assert_not_called()
