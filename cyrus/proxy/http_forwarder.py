"""The HTTP-forwarder use case and the port it owns.

``CyrusHTTPForwarder`` replays a Linear webhook (already fetched from a feed) to a
local Cyrus daemon's webhook endpoint over HTTP, so the request Cyrus receives is
indistinguishable from Linear calling it directly.

Per "use cases own their ports," this module owns the ``RequestClient`` interface
the forwarder depends on (the slice of an HTTP client it uses) and stays ignorant of
how it is implemented. The forwarder is consumed by ``ProxyExecutionLoop`` via the
``WebhookForwarderProtocol`` it satisfies structurally.
"""

from __future__ import annotations

import logging
from typing import Mapping, Optional, Protocol

import requests

from proxy.messages import ForwardError, ForwardErrorEnum, LinearWebhookMessage

logger = logging.getLogger(__name__)


class HttpResponse(Protocol):
    """The slice of an HTTP response the forwarder relies on."""

    def raise_for_status(self) -> None:
        """Raise if the response status was an error (non-2xx)."""
        ...


class RequestClient(Protocol):
    """The slice of an HTTP client the forwarder uses (e.g. the ``requests`` module)."""

    def post(
        self, url: str, *, data: bytes, headers: Mapping[str, str], timeout: float
    ) -> HttpResponse:
        """POST ``data`` with ``headers`` to ``url`` (bounded by ``timeout``) and
        return the response."""
        ...


_DEFAULT_TIMEOUT_SECONDS = 30.0


class CyrusHTTPForwarder:
    """Replays Linear webhooks to a Cyrus daemon's Linear webhook route over HTTP.

    Configured once with where Cyrus lives (``base_url``) and the HTTP client to
    use, then ``forward`` is called per message. Cyrus routes by request path —
    ``/linear-webhook`` is its Linear route specifically (``/github-webhook`` and
    ``/callback`` are separate handlers; the bare ``/webhook`` is a deprecated
    legacy alias) — so this forwarder, which only carries Linear webhooks, targets
    the Linear path. Callers supply only the base URL, typically from a Config
    reading an env var at the composition root.

    Webhook routes reference (Cyrus self-hosting docs):
    https://github.com/cyrusagents/cyrus/blob/main/docs/SELF_HOSTING.md

    The ``request_client`` is injected for testability and defaults to the
    ``requests`` module; tests pass a stand-in instead.
    """

    _LINEAR_WEBHOOK_PATH = "/linear-webhook"

    def __init__(
        self,
        base_url: str,
        request_client: RequestClient = requests,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._base_url = base_url
        self._request_client = request_client
        self._timeout = timeout

    def forward(self, message: LinearWebhookMessage) -> Optional[ForwardError]:
        """Replay a Linear webhook to Cyrus's Linear webhook route.

        POSTs the message's raw body and Linear headers to
        ``{base_url}/linear-webhook`` so the request Cyrus receives is byte-for-byte
        indistinguishable from Linear calling it directly.

        Fire-and-forget: returns ``None`` on success. If the
        replay fails (a non-2xx response, or a transport error), returns a
        :class:`ForwardError` (``FAILED_FORWARD_REQUEST``) rather than raising, so
        the caller can react.
        """
        url = f"{self._base_url}{self._LINEAR_WEBHOOK_PATH}"
        logger.debug("forwarding webhook to %s", url)
        try:
            response = self._request_client.post(
                url,
                data=message["body"],
                headers=message["headers"],
                timeout=self._timeout,
            )
            response.raise_for_status()
        except Exception as exc:
            logger.warning("forward to %s failed: %s", url, exc, exc_info=True)
            return {
                "type": ForwardErrorEnum.FAILED_FORWARD_REQUEST,
                "reason": str(exc),
            }
        logger.debug("forwarded webhook to %s", url)
        return None
