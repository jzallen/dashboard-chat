"""The compose topology gains exactly one new service (web-ssr) — Slice 1 / MR-0.

After MR-0 lands, the post-MR-0 compose topology contains the six
pre-MR-0 application services (reverse-proxy, auth-proxy, agent, api,
ui-state, redis) PLUS one new service `web-ssr`. No pre-MR-0 service
is removed. `web-ssr` exposes its port internally only (no host
binding).

Feature file (SSOT): `docs/feature/frontend-coexistence/distill/compose-topology-gains-one-service.feature`.
"""

from __future__ import annotations

import pytest

from driver import FrontendCoexistenceDriver

pytestmark = [
    pytest.mark.skip(
        reason="DISTILL: pending DELIVER phase 01 (MR-0 plumbing) per roadmap.json",
    ),
    pytest.mark.real_io,
    pytest.mark.slice_1,
]


def test_compose_lists_web_ssr_alongside_six_existing_services(
    docker_compose_services: list[str],
) -> None:
    """`docker compose config --services` includes web-ssr and the six pre-MR-0 application services."""
    expected = {"web-ssr", "reverse-proxy", "auth-proxy", "agent", "api", "ui-state", "redis"}
    services = set(docker_compose_services)
    missing = expected - services
    assert not missing, (
        f"expected compose services missing after MR-0: {missing!r}. "
        f"`docker compose config --services` returned: {sorted(services)!r}"
    )


def test_web_ssr_exposes_internal_port_only_no_host_mapping(
    driver: FrontendCoexistenceDriver,
) -> None:
    """The new `web-ssr` service uses `expose: 3001` (internal-only) and has no `ports:` host mapping."""
    block = driver.compose_service_block("web-ssr")
    expose = block.get("expose", [])
    # Compose normalizes scalar entries to strings.
    expose_normalized = [str(p) for p in expose]
    assert "3001" in expose_normalized, (
        f"`web-ssr` should `expose: ['3001']` (internal only). Got: {expose!r}"
    )
    ports = block.get("ports", [])
    assert not ports, (
        f"`web-ssr` should NOT declare any `ports:` host mapping (internal-only per "
        f"application-architecture.md §6.4). Got: {ports!r}"
    )


def test_pre_mr0_services_were_not_removed(
    docker_compose_services: list[str],
) -> None:
    """No application service that existed pre-MR-0 has been removed."""
    pre_mr0 = {"reverse-proxy", "auth-proxy", "agent", "api", "ui-state", "redis"}
    removed = pre_mr0 - set(docker_compose_services)
    assert not removed, (
        f"pre-MR-0 services missing from post-MR-0 compose: {removed!r}. "
        f"MR-0 is supposed to ADD web-ssr, not remove anything."
    )
