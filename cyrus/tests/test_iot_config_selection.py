"""Specification for IoT feed config + selection.

``CYRUS_PROXY_FEED=iot`` selects an ``IoTConfig`` whose routing key (this consumer's
``creator.id``) and IoT endpoint are read from the ``CYRUS_PROXY_IOT_*`` env vars,
alongside the existing ``CYRUS_PROXY_*`` core settings — without disturbing ``sqs`` /
``canary`` selection.
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
    """CYRUS_PROXY_FEED=iot selects an IoTConfig."""
    config = config_from_env(IOT_ENV)

    assert isinstance(config, IoTConfig)


def test_iot_config_reads_routing_key_and_endpoint_from_env() -> None:
    """The routing key, endpoint and region come from CYRUS_PROXY_IOT_* env vars."""
    config = IoTConfig.from_env(IOT_ENV)

    assert config.iot_endpoint == "a3k7example-ats.iot.us-east-1.amazonaws.com"
    assert config.iot_routing_key == "creator-9f2c-iot-consumer"
    assert config.iot_region == "us-east-1"
