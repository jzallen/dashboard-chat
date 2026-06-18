"""Unit tests for :class:`IoTConfig` — the validated IoT connection configuration.

``IoTConfig`` resolves the SigV4 signing region and derives the keyed MQTT client id at
construction, so an unconfigured region fails fast here rather than deep inside
``connect()``, and the connection builder is a thin consumer that just reads the
ready-made values off the config. These tests pin that resolution directly; how the
builder forwards it into the signing call is covered in ``test_iot_connection_builder.py``.
"""

from __future__ import annotations

import pytest

from webhook_feeds.iot_feed import IoTConfig, IoTConnectionError

ROUTING_KEY = "creator-9f2c-iot-consumer"
ENDPOINT = "a3k7example-ats.iot.us-east-1.amazonaws.com"


def test_region_prefers_the_explicit_value_over_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An explicit region wins even when the AWS_REGION env var is set."""
    monkeypatch.setenv("AWS_REGION", "eu-west-1")

    config = IoTConfig(endpoint=ENDPOINT, routing_key=ROUTING_KEY, region="us-east-1")

    assert config.region == "us-east-1"


def test_region_falls_back_to_aws_region_then_aws_default_region(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no explicit region the standard AWS env vars supply it, AWS_REGION first."""
    monkeypatch.setenv("AWS_REGION", "eu-west-1")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-south-1")
    assert (
        IoTConfig(endpoint=ENDPOINT, routing_key=ROUTING_KEY, region=None).region
        == "eu-west-1"
    )

    monkeypatch.delenv("AWS_REGION", raising=False)
    assert (
        IoTConfig(endpoint=ENDPOINT, routing_key=ROUTING_KEY, region=None).region
        == "ap-south-1"
    )


def test_region_raises_when_neither_explicit_nor_in_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no region anywhere the config refuses to guess and raises at construction."""
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)

    with pytest.raises(IoTConnectionError):
        IoTConfig(endpoint=ENDPOINT, routing_key=ROUTING_KEY, region=None)


def test_client_id_is_derived_from_the_routing_key_with_a_uniqueness_suffix() -> None:
    """The MQTT client id is keyed off the routing key (with a random suffix), capped at 128."""
    config = IoTConfig(endpoint=ENDPOINT, routing_key=ROUTING_KEY, region="us-east-1")

    assert config.client_id.startswith(f"cyrus-{ROUTING_KEY}-")
    assert len(config.client_id) <= 128


def test_client_id_is_unique_per_instance_so_two_processes_do_not_clash() -> None:
    """Each config gets its own random suffix so two consumers on one key don't collide."""
    first = IoTConfig(endpoint=ENDPOINT, routing_key=ROUTING_KEY, region="us-east-1")
    second = IoTConfig(endpoint=ENDPOINT, routing_key=ROUTING_KEY, region="us-east-1")

    assert first.client_id != second.client_id


def test_endpoint_and_routing_key_are_carried_through_verbatim() -> None:
    """The config preserves the endpoint and routing key for the builder and topic."""
    config = IoTConfig(endpoint=ENDPOINT, routing_key=ROUTING_KEY, region="us-east-1")

    assert (config.endpoint, config.routing_key) == (ENDPOINT, ROUTING_KEY)
