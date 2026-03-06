"""Tests for the GET /api/uploads/formats endpoint."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.plugins import create_plugin_registry


@pytest.fixture(autouse=True)
def _set_plugin_registry():
    """Ensure plugin_registry is set on app.state (lifespan doesn't run in test transport)."""
    app.state.plugin_registry = create_plugin_registry()


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


class TestListFormats:
    """Verify the /api/uploads/formats response shape."""

    async def test_returns_200_with_formats_list(self, client: AsyncClient):
        """GET /api/uploads/formats should return 200 with a formats list."""
        async with client:
            response = await client.get(
                "/api/uploads/formats",
                headers={"Authorization": "Bearer dev-token-static"},
            )

        assert response.status_code == 200
        body = response.json()
        assert "formats" in body
        assert isinstance(body["formats"], list)
        assert len(body["formats"]) > 0

    async def test_each_format_has_required_keys(self, client: AsyncClient):
        """Each format entry should have 'name', 'extensions' (list), and 'label' (str)."""
        async with client:
            response = await client.get(
                "/api/uploads/formats",
                headers={"Authorization": "Bearer dev-token-static"},
            )

        body = response.json()
        for fmt in body["formats"]:
            assert "name" in fmt
            assert "extensions" in fmt
            assert "label" in fmt
            assert isinstance(fmt["extensions"], list)
            assert isinstance(fmt["label"], str)

    async def test_csv_plugin_is_present(self, client: AsyncClient):
        """The CSV plugin should always be registered."""
        async with client:
            response = await client.get(
                "/api/uploads/formats",
                headers={"Authorization": "Bearer dev-token-static"},
            )

        body = response.json()
        names = [fmt["name"] for fmt in body["formats"]]
        assert "csv" in names
        csv_fmt = next(f for f in body["formats"] if f["name"] == "csv")
        assert ".csv" in csv_fmt["extensions"]
