import asyncio

import pytest

from app.auth.context import clear_auth_user, get_auth_user, set_auth_user
from app.auth.types import AuthUser


class TestAuthContext:
    """Tests for auth context variable management."""

    async def test_get_auth_user_raises_when_not_set(self):
        """get_auth_user should raise RuntimeError when no user in context."""
        clear_auth_user()
        with pytest.raises(RuntimeError, match="No auth user in context"):
            get_auth_user()

    async def test_set_and_get_auth_user_roundtrip(self):
        """set_auth_user followed by get_auth_user should return the same user."""
        user = AuthUser(id="test-1", email="test@example.com", org_id="org-1", name="Test")
        set_auth_user(user)
        result = get_auth_user()
        assert result == user
        assert result.id == "test-1"
        assert result.email == "test@example.com"
        assert result.org_id == "org-1"
        assert result.name == "Test"

    async def test_auth_user_is_frozen(self):
        """AuthUser should be immutable (frozen dataclass)."""
        user = AuthUser(id="test-1", email="test@example.com", org_id="org-1")
        with pytest.raises(AttributeError):
            user.id = "modified"

    async def test_context_var_isolation_across_tasks(self):
        """Context vars should be isolated between concurrent asyncio tasks."""
        user_a = AuthUser(id="user-a", email="a@test.com", org_id="org-a")
        user_b = AuthUser(id="user-b", email="b@test.com", org_id="org-b")

        results = {}

        async def task(name: str, user: AuthUser):
            set_auth_user(user)
            await asyncio.sleep(0.01)  # Yield to let other task run
            results[name] = get_auth_user()

        await asyncio.gather(
            task("a", user_a),
            task("b", user_b),
        )

        assert results["a"] == user_a
        assert results["b"] == user_b

    async def test_auth_user_name_defaults_to_none(self):
        """AuthUser name field should default to None."""
        user = AuthUser(id="test-1", email="test@example.com", org_id="org-1")
        assert user.name is None
