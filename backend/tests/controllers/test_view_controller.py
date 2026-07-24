"""ViewController — use-case dependency injection at the controller seam.

Exercises the pattern that replaces the http_controller late-binding shim: each
endpoint takes a keyword-only ``*_func`` dependency typed against a Protocol, so
a test injects a fake use case matching that interface instead of monkeypatching
a module-level alias. No database, no ASGI stack — the controller is unit-tested
against injected fakes, and each test asserts the whole ``(body, status)`` result.

The envelope tests compare the full JSON:API tuple; the forwarding tests spy on
the injected use case to pin the argument contract the controller relies on.

``get_view`` inlines ``ViewSQLGenerator().generate_display(data)`` and attaches
the result as ``display_sql`` — a controller-layer leak of view-rendering logic.
The behavior is preserved and pinned below.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec — compare the full envelope,
don't weaken to spot-checks, and build expected values from literals here rather
than echoing the fake's return.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from returns.result import Failure, Success

from app.controllers.view_controller import ViewController
from app.use_cases.view.exceptions import (
    CircularDependency,
    InvalidSourceReference,
    ViewNotFound,
)


@dataclass
class _Model:
    id: str
    name: str = "x"

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# list_views
# ---------------------------------------------------------------------------


async def test_list_views__when_use_case_succeeds__returns_non_paginated_envelope():
    async def fake_list(project_id, project=None):
        return Success([_Model("v1", "A"), _Model("v2", "B")])

    result = await ViewController.list_views("p1", list_views_func=fake_list)

    assert result == (
        {
            "data": [
                {"type": "views", "id": "v1", "attributes": {"name": "A"}},
                {"type": "views", "id": "v2", "attributes": {"name": "B"}},
            ],
            "links": {"self": "/api/projects/p1/views?page[size]=2", "next": None, "prev": None},
            "meta": {"page": {"size": 2, "has_more": False}},
        },
        200,
    )


async def test_list_views__when_given_project__forwards_it_to_use_case():
    fake = AsyncMock(return_value=Success([]))
    proj = {"id": "p1"}

    await ViewController.list_views("p1", project=proj, list_views_func=fake)

    fake.assert_awaited_once_with("p1", project=proj)


async def test_list_views__when_empty__returns_empty_data_with_zero_size():
    async def fake_list(project_id, project=None):
        return Success([])

    result = await ViewController.list_views("p1", list_views_func=fake_list)

    assert result == (
        {
            "data": [],
            "links": {"self": "/api/projects/p1/views?page[size]=0", "next": None, "prev": None},
            "meta": {"page": {"size": 0, "has_more": False}},
        },
        200,
    )


# ---------------------------------------------------------------------------
# post_view
# ---------------------------------------------------------------------------


async def test_post_view__when_use_case_succeeds__returns_201_with_nested_self_link():
    async def fake_create(*, project_id, project=None, **kwargs):
        return Success(_Model("V-NEW", "New View"))

    result = await ViewController.post_view(
        "p1", name="New View", definition={"sources": []}, create_view_func=fake_create
    )

    assert result == (
        {
            "data": {"type": "views", "id": "V-NEW", "attributes": {"name": "New View"}},
            "links": {"self": "/api/projects/p1/views/V-NEW"},
        },
        201,
    )


async def test_post_view__when_given_kwargs__forwards_them_to_use_case():
    fake = AsyncMock(return_value=Success(_Model("v1")))
    proj = {"id": "p1"}

    await ViewController.post_view("p1", project=proj, name="N", definition={"x": 1}, create_view_func=fake)

    fake.assert_awaited_once_with(project_id="p1", project=proj, name="N", definition={"x": 1})


async def test_post_view__when_invalid_source_reference__returns_400():
    async def fake_create(*, project_id, project=None, **kwargs):
        return Failure(InvalidSourceReference(["missing-id"]))

    _, status = await ViewController.post_view("p1", name="X", create_view_func=fake_create)

    assert status == 400


async def test_post_view__when_circular_dependency__returns_400():
    async def fake_create(*, project_id, project=None, **kwargs):
        return Failure(CircularDependency("v1"))

    _, status = await ViewController.post_view("p1", name="X", create_view_func=fake_create)

    assert status == 400


# ---------------------------------------------------------------------------
# get_view
# ---------------------------------------------------------------------------


@patch("app.use_cases.view.sql_generator.ViewSQLGenerator")
async def test_get_view__when_use_case_succeeds__attaches_generated_display_sql_to_envelope(mock_generator_cls):
    """Pins the controller-layer leak: ``display_sql`` is generated in the
    controller (not the use case) and merged into the serialized attributes."""
    mock_generator = MagicMock()
    mock_generator.generate_display.return_value = "SELECT 1;"
    mock_generator_cls.return_value = mock_generator

    async def fake_get(view_id, project=None):
        return Success(_Model("v1", "My View"))

    result = await ViewController.get_view("v1", get_view_func=fake_get)

    assert result == (
        {
            "data": {
                "type": "views",
                "id": "v1",
                "attributes": {"name": "My View", "display_sql": "SELECT 1;"},
            },
            "links": {"self": "/api/views/v1"},
        },
        200,
    )


@patch("app.use_cases.view.sql_generator.ViewSQLGenerator")
async def test_get_view__when_use_case_succeeds__generates_display_sql_from_raw_use_case_model(mock_generator_cls):
    """The generator receives the raw use-case model, not the serialized dict —
    the second half of the leak the follow-up push-down must preserve."""
    mock_generator = MagicMock()
    mock_generator_cls.return_value = mock_generator
    view_obj = _Model("v1", "My View")

    async def fake_get(view_id, project=None):
        return Success(view_obj)

    await ViewController.get_view("v1", get_view_func=fake_get)

    mock_generator.generate_display.assert_called_once_with(view_obj)


async def test_get_view__when_not_found__returns_404():
    async def fake_get(view_id, project=None):
        return Failure(ViewNotFound("v1"))

    _, status = await ViewController.get_view("v1", get_view_func=fake_get)

    assert status == 404


async def test_get_view__when_given_project__forwards_it_to_use_case():
    fake = AsyncMock(return_value=Failure(ViewNotFound("v1")))
    proj = {"id": "p1"}

    await ViewController.get_view("v1", project=proj, get_view_func=fake)

    fake.assert_awaited_once_with("v1", project=proj)


# ---------------------------------------------------------------------------
# patch_view
# ---------------------------------------------------------------------------


async def test_patch_view__when_use_case_succeeds__returns_200_with_self_link():
    async def fake_update(view_id, update_data, project=None):
        return Success(_Model("v1", "Updated"))

    result = await ViewController.patch_view("v1", name="Updated", update_view_func=fake_update)

    assert result == (
        {
            "data": {"type": "views", "id": "v1", "attributes": {"name": "Updated"}},
            "links": {"self": "/api/views/v1"},
        },
        200,
    )


async def test_patch_view__when_given_kwargs__forwards_them_as_update_dict():
    fake = AsyncMock(return_value=Success(_Model("v1")))
    proj = {"id": "p1"}

    await ViewController.patch_view("v1", project=proj, name="N", definition={"x": 1}, update_view_func=fake)

    fake.assert_awaited_once_with("v1", {"name": "N", "definition": {"x": 1}}, project=proj)


# ---------------------------------------------------------------------------
# delete_view
# ---------------------------------------------------------------------------


async def test_delete_view__when_use_case_succeeds__returns_200_with_meta_deleted():
    async def fake_delete(view_id, project=None):
        return Success(True)

    result = await ViewController.delete_view("v1", delete_view_func=fake_delete)

    assert result == ({"meta": {"deleted": True}}, 200)


async def test_delete_view__when_not_found__returns_404():
    async def fake_delete(view_id, project=None):
        return Failure(ViewNotFound("v1"))

    _, status = await ViewController.delete_view("v1", delete_view_func=fake_delete)

    assert status == 404


async def test_delete_view__when_given_project__forwards_it_to_use_case():
    fake = AsyncMock(return_value=Success(True))
    proj = {"id": "p1"}

    await ViewController.delete_view("v1", project=proj, delete_view_func=fake)

    fake.assert_awaited_once_with("v1", project=proj)
