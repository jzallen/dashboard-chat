from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.http_validation_error import HTTPValidationError
from ...types import UNSET, Unset
from typing import cast


def _get_kwargs(
    session_id: str,
    *,
    since: None | str | Unset = UNSET,
    limit: int | Unset = 100,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_since: None | str | Unset
    if isinstance(since, Unset):
        json_since = UNSET
    else:
        json_since = since
    params["since"] = json_since

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/sessions/{session_id}/events".format(
            session_id=quote(str(session_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | HTTPValidationError | None:
    if response.status_code == 200:
        response_200 = response.json()
        return response_200

    if response.status_code == 422:
        response_422 = HTTPValidationError.from_dict(response.json())

        return response_422

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | HTTPValidationError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    since: None | str | Unset = UNSET,
    limit: int | Unset = 100,
) -> Response[Any | HTTPValidationError]:
    r"""List Session Events

     SSE replay endpoint (dc-x3y.3.2 / Epic C).

    Returns persisted DomainEvents for the session since `since` (opaque
    cursor; omit for \"from the beginning\"). Response shape per the bead:
        {session_id, events, next_cursor, has_more}

    Auth: org-scoped (404 for unknown session OR cross-org access — existence
    is not leaked). UI directives are filtered out per ADR-014.

    Args:
        session_id (str):
        since (None | str | Unset):
        limit (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | HTTPValidationError]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        since=since,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    since: None | str | Unset = UNSET,
    limit: int | Unset = 100,
) -> Any | HTTPValidationError | None:
    r"""List Session Events

     SSE replay endpoint (dc-x3y.3.2 / Epic C).

    Returns persisted DomainEvents for the session since `since` (opaque
    cursor; omit for \"from the beginning\"). Response shape per the bead:
        {session_id, events, next_cursor, has_more}

    Auth: org-scoped (404 for unknown session OR cross-org access — existence
    is not leaked). UI directives are filtered out per ADR-014.

    Args:
        session_id (str):
        since (None | str | Unset):
        limit (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | HTTPValidationError
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        since=since,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    since: None | str | Unset = UNSET,
    limit: int | Unset = 100,
) -> Response[Any | HTTPValidationError]:
    r"""List Session Events

     SSE replay endpoint (dc-x3y.3.2 / Epic C).

    Returns persisted DomainEvents for the session since `since` (opaque
    cursor; omit for \"from the beginning\"). Response shape per the bead:
        {session_id, events, next_cursor, has_more}

    Auth: org-scoped (404 for unknown session OR cross-org access — existence
    is not leaked). UI directives are filtered out per ADR-014.

    Args:
        session_id (str):
        since (None | str | Unset):
        limit (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | HTTPValidationError]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        since=since,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    since: None | str | Unset = UNSET,
    limit: int | Unset = 100,
) -> Any | HTTPValidationError | None:
    r"""List Session Events

     SSE replay endpoint (dc-x3y.3.2 / Epic C).

    Returns persisted DomainEvents for the session since `since` (opaque
    cursor; omit for \"from the beginning\"). Response shape per the bead:
        {session_id, events, next_cursor, has_more}

    Auth: org-scoped (404 for unknown session OR cross-org access — existence
    is not leaked). UI directives are filtered out per ADR-014.

    Args:
        session_id (str):
        since (None | str | Unset):
        limit (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | HTTPValidationError
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            since=since,
            limit=limit,
        )
    ).parsed
