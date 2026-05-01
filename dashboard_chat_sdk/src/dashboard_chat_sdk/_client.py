"""Public Client wrapper around the openapi-python-client codegen output.

The generated `_generated.client.AuthenticatedClient` is fine on its own, but
its constructor surface (token + prefix + scheme + base_url + ...) is wider
than the SDK promises in v0.1.0. This thin wrapper pins the public shape so
codegen churn does not leak into partner code.
"""

from __future__ import annotations

from ._generated.client import AuthenticatedClient

DEFAULT_BASE_URL = "http://localhost:3000"


class Client:
    """A bearer-authenticated Dashboard Chat client.

    Args:
        token: a Bearer credential — a PAT, an M2M access_token, or (in dev)
            the static `dev-token-static`. PAT/M2M minting itself is not yet
            covered by this SDK; obtain one via curl per
            `docs/guides/headless-tokens.md` (or wait for H.4).
        base_url: the auth-proxy endpoint that fronts the backend. Defaults to
            the local compose-dev address.
        verify_ssl: pass False for self-signed dev stacks.
        timeout_seconds: request timeout, in seconds.
    """

    def __init__(
        self,
        token: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        verify_ssl: bool = True,
        timeout_seconds: float = 30.0,
    ) -> None:
        import httpx

        self._inner = AuthenticatedClient(
            base_url=base_url,
            token=token,
            verify_ssl=verify_ssl,
            timeout=httpx.Timeout(timeout_seconds),
            raise_on_unexpected_status=True,
        )

    @property
    def raw(self) -> AuthenticatedClient:
        """Escape hatch — the underlying generated client.

        Use this to call any endpoint the SDK does not yet expose as a
        first-class method. Stable across patch releases of the SDK; minor
        releases may regenerate against a newer OpenAPI schema.
        """
        return self._inner

    def __enter__(self) -> "Client":
        self._inner.__enter__()
        return self

    def __exit__(self, *args: object) -> None:
        self._inner.__exit__(*args)
