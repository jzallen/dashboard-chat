"""Specification for the DynamoDB-backed consumer-presence read.

A consumer is offline when its presence row is absent, ``connected=false``, or
expired (``ttl`` at/before now). TTL deletion is best-effort, so an
expired-but-unreaped row must still read as offline — the read does not trust
DynamoDB to have removed it. The ``GetItem`` wire contract is pinned with a
botocore Stubber; the row predicate is unit-tested directly.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec. "absent / expired /
connected=false ⇒ offline" is load-bearing; do not weaken the TTL-expiry case.
"""

from __future__ import annotations

import boto3
import pytest
from botocore.stub import Stubber

from presence import make_offline_check, row_is_offline

NOW = 1_700_000_000.0
TABLE = "ConsumerPresenceTable"


def test_row_is_offline__absent_row__returns_true():
    assert row_is_offline(None, NOW) is True
    assert row_is_offline({}, NOW) is True


def test_row_is_offline__connected_false__returns_true():
    item = {"connected": {"BOOL": False}, "ttl": {"N": str(int(NOW + 999))}}
    assert row_is_offline(item, NOW) is True


def test_row_is_offline__connected_and_unexpired__returns_false():
    item = {"connected": {"BOOL": True}, "ttl": {"N": str(int(NOW + 60))}}
    assert row_is_offline(item, NOW) is False


def test_row_is_offline__expired_ttl_though_connected__returns_true():
    """A stale (unreaped) row must read offline: TTL deletion is eventually consistent."""
    item = {"connected": {"BOOL": True}, "ttl": {"N": str(int(NOW - 1))}}
    assert row_is_offline(item, NOW) is True


def test_row_is_offline__connected_without_ttl__returns_false():
    assert row_is_offline({"connected": {"BOOL": True}}, NOW) is False


def test_row_is_offline__schema_drifted_row__returns_true():
    """A ``connected`` attribute that is not the expected ``{type: value}`` map
    must read offline rather than raise."""
    assert row_is_offline({"connected": True}, NOW) is True
    assert row_is_offline({"connected": "true"}, NOW) is True


@pytest.fixture
def stubbed_dynamodb():
    client = boto3.client(
        "dynamodb",
        region_name="us-east-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    stubber = Stubber(client)
    yield client, stubber
    stubber.deactivate()


def test_make_offline_check__connected_username_row__reports_online(stubbed_dynamodb):
    client, stubber = stubbed_dynamodb
    stubber.add_response(
        "get_item",
        {"Item": {"connected": {"BOOL": True}, "ttl": {"N": str(int(NOW + 60))}}},
        {"TableName": TABLE, "Key": {"username": {"S": "testuser"}}},
    )
    stubber.activate()

    is_offline = make_offline_check(client, TABLE, now=lambda: NOW)
    assert is_offline("testuser") is False
    stubber.assert_no_pending_responses()


def test_make_offline_check__missing_row__reports_offline(stubbed_dynamodb):
    client, stubber = stubbed_dynamodb
    stubber.add_response(
        "get_item", {}, {"TableName": TABLE, "Key": {"username": {"S": "ghost"}}}
    )
    stubber.activate()

    is_offline = make_offline_check(client, TABLE, now=lambda: NOW)
    assert is_offline("ghost") is True
    stubber.assert_no_pending_responses()


def test_make_offline_check__read_errors__fails_closed_to_offline(stubbed_dynamodb):
    """A DynamoDB error (throttle/network/IAM) reads offline, not a crash.

    iot-only has no SQS safety net, so a presence-cache blip must yield an honest
    503 (Linear retries) rather than take down the invocation and lose the webhook.
    """
    client, stubber = stubbed_dynamodb
    stubber.add_client_error(
        "get_item",
        service_error_code="ProvisionedThroughputExceededException",
        http_status_code=400,
        expected_params={"TableName": TABLE, "Key": {"username": {"S": "testuser"}}},
    )
    stubber.activate()

    is_offline = make_offline_check(client, TABLE, now=lambda: NOW)
    assert is_offline("testuser") is True
    stubber.assert_no_pending_responses()
