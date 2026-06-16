"""Specification (RED scaffold) for IoT feed config + selection (DC-22 AC5).

``CYRUS_PROXY_FEED=iot`` must select an ``IoTConfig`` whose routing key (this
consumer's ``creator.id``) and IoT endpoint are read from the ``CYRUS_PROXY_IOT_*``
env vars, alongside the existing ``CYRUS_PROXY_*`` core settings — without disturbing
``sqs`` / ``canary`` selection.

This is a SKELETON: ``IoTConfig.from_env`` raises
``AssertionError("Not yet implemented — RED scaffold")``, so both selection tests
below are honest RED (they fail on that AssertionError once ``config_from_env`` routes
``iot`` to it). The unchanged ``sqs`` / ``canary`` branches of ``config_from_env``
keep existing selection working (the diff touches only the added ``iot`` branch).

IF YOU'RE AN AGENT, READ THIS:
- These tests are the specification. Implement ``IoTConfig.from_env`` to satisfy them;
  never weaken or rewrite an assertion to fit the implementation.
"""

from __future__ import annotations

from proxy.config import IoTConfig, config_from_env

IOT_ENV = {
    "CYRUS_PROXY_BASE_URL": "http://localhost:3456",
    "CYRUS_PROXY_FEED": "iot",
    "CYRUS_PROXY_IOT_ENDPOINT": "a3k7example-ats.iot.us-east-1.amazonaws.com",
    "CYRUS_PROXY_IOT_ROUTING_KEY": "creator-9f2c-iot-consumer",
    "CYRUS_PROXY_IOT_REGION": "us-east-1",
}


def test_config_from_env_selects_iot_feed() -> None:
    """AC5: CYRUS_PROXY_FEED=iot selects an IoTConfig (RED until from_env implemented)."""
    config = config_from_env(IOT_ENV)

    assert isinstance(config, IoTConfig)


def test_iot_config_reads_routing_key_and_endpoint_from_env() -> None:
    """AC5: the routing key, endpoint and region come from CYRUS_PROXY_IOT_* env vars."""
    config = IoTConfig.from_env(IOT_ENV)

    assert config.iot_endpoint == "a3k7example-ats.iot.us-east-1.amazonaws.com"
    assert config.iot_routing_key == "creator-9f2c-iot-consumer"
    assert config.iot_region == "us-east-1"
