"""Contract/smoke test for the production IoT connection wiring (DC-22 AC3).

The acceptance suite (``test_iot_linear_webhook_feed.py``) drives the feed through an
injected fake, so this file pins the *real builder* instead: that
``build_default_iot_connection`` authenticates with **IAM/SigV4 over WebSocket** using
the **default AWS credentials provider chain** (the devpod instance role) with **no
X.509 device certificate**, and that the awscrt adapter subscribes to exactly the
keyed topic at QoS 1. It documents the wiring without any live-AWS calls by patching
the lazily-imported ``awscrt`` / ``awsiot`` seams.

IF YOU'RE AN AGENT, READ THIS:
- This proves the auth/subscription wiring, not message delivery. Never relax the
  no-certificate / default-credentials assertions to fit an implementation.
"""

from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("awsiot", reason="awsiotsdk provides the real IoT connection")

from awscrt import auth, io  # noqa: E402
from awsiot import mqtt_connection_builder  # noqa: E402

from webhook_feeds.iot_feed import (
    _AwsCrtIoTConnection,
    build_default_iot_connection,
)  # noqa: E402

ROUTING_KEY = "creator-9f2c-iot-consumer"
ENDPOINT = "a3k7example-ats.iot.us-east-1.amazonaws.com"
REGION = "us-east-1"


def test_default_connection_uses_sigv4_default_chain_without_certificates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The builder signs with the default credential chain and never uses a device cert."""
    monkeypatch.setattr(io, "EventLoopGroup", lambda count: "elg")
    monkeypatch.setattr(io, "DefaultHostResolver", lambda elg: "resolver")
    monkeypatch.setattr(io, "ClientBootstrap", lambda elg, resolver: "bootstrap")
    monkeypatch.setattr(
        auth.AwsCredentialsProvider,
        "new_default_chain",
        staticmethod(lambda bootstrap: "default-chain-provider"),
    )
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        mqtt_connection_builder,
        "websockets_with_default_aws_signing",
        lambda **kwargs: captured.update(kwargs) or "mqtt-connection",
    )

    connection = build_default_iot_connection(
        endpoint=ENDPOINT, routing_key=ROUTING_KEY, region=REGION
    )

    assert isinstance(connection, _AwsCrtIoTConnection)
    assert captured["endpoint"] == ENDPOINT
    assert captured["region"] == REGION
    assert captured["credentials_provider"] == "default-chain-provider"
    assert ROUTING_KEY in captured["client_id"]
    # No X.509 device-certificate material anywhere in the connection params.
    assert not any("cert" in key or "key" in key for key in captured)


def test_adapter_subscribes_to_the_exact_topic_at_qos_1() -> None:
    """The awscrt adapter subscribes to the keyed topic only, at QoS 1 (at-least-once)."""

    class FakeCrtConnection:
        def __init__(self) -> None:
            self.subscribed: list[tuple[str, int]] = []

        def subscribe(self, *, topic: str, qos: Any, callback: Any) -> tuple[Any, int]:
            self.subscribed.append((topic, int(qos)))

            class _Future:
                def result(self_inner) -> None:
                    return None

            return _Future(), 1

    crt = FakeCrtConnection()
    adapter = _AwsCrtIoTConnection(crt)
    topic = f"cyrus/v1/sessions/{ROUTING_KEY}"

    adapter.subscribe(topic, 1, lambda **_: None)

    assert crt.subscribed == [(topic, 1)]
