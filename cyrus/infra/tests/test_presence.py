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


def test_absent_row_is_offline():
    assert row_is_offline(None, NOW) is True
    assert row_is_offline({}, NOW) is True


def test_connected_false_is_offline():
    item = {"connected": {"BOOL": False}, "ttl": {"N": str(int(NOW + 999))}}
    assert row_is_offline(item, NOW) is True


def test_present_connected_and_unexpired_is_online():
    item = {"connected": {"BOOL": True}, "ttl": {"N": str(int(NOW + 60))}}
    assert row_is_offline(item, NOW) is False


def test_expired_ttl_is_offline_even_when_connected_true():
    """A stale (unreaped) row must read offline: TTL deletion is eventually consistent."""
    item = {"connected": {"BOOL": True}, "ttl": {"N": str(int(NOW - 1))}}
    assert row_is_offline(item, NOW) is True


def test_connected_true_without_ttl_is_online():
    assert row_is_offline({"connected": {"BOOL": True}}, NOW) is False


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


def test_offline_check_reads_the_username_row_and_reports_online(stubbed_dynamodb):
    client, stubber = stubbed_dynamodb
    stubber.add_response(
        "get_item",
        {"Item": {"connected": {"BOOL": True}, "ttl": {"N": str(int(NOW + 60))}}},
        {"TableName": TABLE, "Key": {"username": {"S": "zallen"}}},
    )
    stubber.activate()

    is_offline = make_offline_check(client, TABLE, now=lambda: NOW)
    assert is_offline("zallen") is False
    stubber.assert_no_pending_responses()


def test_offline_check_reports_offline_for_a_missing_row(stubbed_dynamodb):
    client, stubber = stubbed_dynamodb
    stubber.add_response(
        "get_item", {}, {"TableName": TABLE, "Key": {"username": {"S": "ghost"}}}
    )
    stubber.activate()

    is_offline = make_offline_check(client, TABLE, now=lambda: NOW)
    assert is_offline("ghost") is True
    stubber.assert_no_pending_responses()
