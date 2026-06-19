"""Unit tests for :class:`IoTConfig` — the validated IoT connection configuration.

``IoTConfig`` resolves the SigV4 signing region and derives the keyed MQTT client id at
construction, so an unconfigured region fails fast here rather than deep inside
``connect()``, and the connection builder is a thin consumer that just reads the
ready-made values off the config. These tests pin that resolution directly; how the
builder forwards it into the signing call is covered in ``test_iot_connection.py``.
"""

from __future__ import annotations

import pytest

from webhook_feeds.iot_feed import IoTConfig, IoTConnectionError

ROUTING_KEY = "creator-9f2c-iot-consumer"
ENDPOINT = "a3k7example-ats.iot.us-east-1.amazonaws.com"


def make_config(**overrides: object) -> IoTConfig:
    """Build an IoTConfig with representative defaults; override only the field under test."""
    fields: dict[str, object] = {
        "endpoint": ENDPOINT,
        "routing_key": ROUTING_KEY,
        "region": "us-east-1",
    }
    fields.update(overrides)
    return IoTConfig(**fields)  # type: ignore[arg-type]


def test_region_prefers_the_explicit_value_over_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An explicit region wins even when the AWS_REGION env var is set."""
    monkeypatch.setenv("AWS_REGION", "eu-west-1")

    assert make_config(region="us-east-1").region == "us-east-1"


def test_region_falls_back_to_aws_region_over_aws_default_region(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no explicit region, AWS_REGION is preferred over AWS_DEFAULT_REGION."""
    monkeypatch.setenv("AWS_REGION", "eu-west-1")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-south-1")

    assert make_config(region=None).region == "eu-west-1"


def test_region_falls_back_to_aws_default_region_when_aws_region_is_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no explicit region and no AWS_REGION, AWS_DEFAULT_REGION supplies it."""
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-south-1")

    assert make_config(region=None).region == "ap-south-1"


def test_region_raises_when_neither_explicit_nor_in_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no region anywhere the config refuses to guess and raises at construction."""
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)

    with pytest.raises(IoTConnectionError):
        make_config(region=None)


def test_client_id_is_prefixed_with_cyrus_and_the_routing_key() -> None:
    """The MQTT client id is keyed off the routing key (with a random uniqueness suffix)."""
    assert make_config().client_id.startswith(f"cyrus-{ROUTING_KEY}-")


def test_client_id_is_capped_at_the_128_char_mqtt_limit() -> None:
    """A long routing key is truncated so the client id stays within the MQTT id limit."""
    config = make_config(routing_key="r" * 200)

    assert len(config.client_id) == 128


def test_client_id_is_unique_per_instance_so_two_processes_do_not_clash() -> None:
    """Each config gets its own random suffix so two consumers on one key don't collide."""
    assert make_config().client_id != make_config().client_id


def test_endpoint_and_routing_key_are_carried_through_verbatim() -> None:
    """The config preserves the endpoint and routing key for the builder and topic."""
    config = make_config()

    assert (config.endpoint, config.routing_key) == (ENDPOINT, ROUTING_KEY)
