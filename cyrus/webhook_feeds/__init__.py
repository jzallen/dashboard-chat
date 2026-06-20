"""Feed adapters — concrete sources of pending Linear webhook events.

Public surface:
- ``SQSLinearWebhookFeed`` — concrete SQS-backed feed adapter (long-polls SQS).
- ``CanaryLinearWebhookFeed`` — synthetic feed for exercising the pump without AWS.
- ``IoTLinearWebhookFeed`` — AWS IoT (MQTT-over-WebSocket, SigV4) keyed-subscription
  feed adapter.
"""

import logging

from webhook_feeds.canary_feed import CanaryLinearWebhookFeed
from webhook_feeds.iot_feed import IoTLinearWebhookFeed
from webhook_feeds.sqs_feed import SQSLinearWebhookFeed

# Library code only emits; the app configures handlers. A NullHandler keeps the
# package silent until an app opts in.
logging.getLogger(__name__).addHandler(logging.NullHandler())

__all__ = [
    "SQSLinearWebhookFeed",
    "CanaryLinearWebhookFeed",
    "IoTLinearWebhookFeed",
]
