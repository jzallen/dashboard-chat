"""Trace one request end-to-end across ≥2 services by correlation id.

The cross-service walking-skeleton assertion: one request traverses the
auth-proxy ingress and the backend, and the operator can follow it by a single
`correlation_id` — every log line that request produced carries the same id, and
the error response itself carries the id.

This is the integration gate the per-service binding work greens. It reads back
each service's real emitted log lines, so it needs the local compose stack and
skips cleanly when the stack is unreachable; the stack-independent bind/read
contract is pinned in `test_ambient_binding.py`.
"""

from __future__ import annotations

import uuid

import pytest
from driver import CorrelationDriver

# A request the operator would actually be diagnosing: an authenticated GET for a
# project that does not exist. It clears the auth-proxy ingress, reaches the
# backend, and resolves on the backend's error path — exercising both hops.
NONEXISTENT_PROJECT = "00000000-0000-4000-8000-000000000000"


def _drive_error_request(driver: CorrelationDriver, correlation_id: str):
    """Drive the cross-service error request, pinning a known correlation id.

    Sending `X-Request-Id` exercises the reuse-when-present path and lets the
    assertion pin the exact id both services must echo onto their log lines.
    """
    bearer = driver.mint_dev_jwt()
    return driver.request(
        "GET",
        f"/api/projects/{NONEXISTENT_PROJECT}",
        bearer=bearer,
        extra_headers={"X-Request-Id": correlation_id},
    )


@pytest.mark.real_io
@pytest.mark.walking_skeleton
@pytest.mark.needs_compose_stack
def test_request_across_auth_proxy_and_backend_shares_one_correlation_id(
    driver: CorrelationDriver,
    requires_compose_stack: None,
) -> None:
    correlation_id = f"k1-{uuid.uuid4()}"

    _drive_error_request(driver, correlation_id)

    auth_proxy_ids = driver.correlation_ids(driver.service_log_records("auth-proxy", since="60s"))
    backend_ids = driver.correlation_ids(driver.service_log_records("api", since="60s"))

    assert correlation_id in auth_proxy_ids, "auth-proxy emitted no log line carrying the request's correlation id"
    assert correlation_id in backend_ids, "backend emitted no log line carrying the request's correlation id"
    assert auth_proxy_ids & backend_ids == {correlation_id}, (
        "the two services must share exactly one correlation id for this request"
    )


@pytest.mark.real_io
@pytest.mark.error_path
@pytest.mark.needs_compose_stack
def test_error_response_carries_correlation_id(
    driver: CorrelationDriver,
    requires_compose_stack: None,
) -> None:
    correlation_id = f"k1-err-{uuid.uuid4()}"

    probe = _drive_error_request(driver, correlation_id)

    assert probe.status >= 400, "the chosen request must resolve on an error path"
    echoed_in_header = (
        probe.headers.get("x-correlation-id") == correlation_id or probe.headers.get("x-request-id") == correlation_id
    )
    echoed_in_body = correlation_id in probe.body
    assert echoed_in_header or echoed_in_body, (
        "the error response must carry the correlation id (header and/or body) "
        "so the operator can copy it straight from the failure"
    )
