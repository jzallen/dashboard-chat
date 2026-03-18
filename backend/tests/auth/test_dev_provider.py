import pytest

from app.auth.dev_provider import DEV_USER, DevAuthProvider
from app.auth.exceptions import AuthenticationError


class TestDevAuthProvider:
    """Tests for DevAuthProvider -- RS256 JWT-based dev auth."""

    @pytest.fixture
    def provider(self) -> DevAuthProvider:
        return DevAuthProvider()

    async def test_verify_token_roundtrip(self, provider: DevAuthProvider):
        """A token from handle_callback should verify back to DEV_USER."""
        _, token, _, _ = await provider.handle_callback("any-code")
        result = await provider.verify_token(token)
        assert result.id == DEV_USER.id
        assert result.email == DEV_USER.email
        assert result.org_id == DEV_USER.org_id

    async def test_verify_token_with_invalid_token_raises_authentication_error(self, provider: DevAuthProvider):
        """verify_token with a bad token should raise AuthenticationError."""
        with pytest.raises(AuthenticationError, match="Invalid dev token"):
            await provider.verify_token("bad-token")

    async def test_verify_token_with_empty_token_raises_authentication_error(self, provider: DevAuthProvider):
        """verify_token with an empty string should raise AuthenticationError."""
        with pytest.raises(AuthenticationError, match="Invalid dev token"):
            await provider.verify_token("")

    async def test_handle_callback_returns_jwt(self, provider: DevAuthProvider):
        """handle_callback should return a signed RS256 JWT."""
        user, token, refresh_token, expires_in = await provider.handle_callback("any-code")
        assert user == DEV_USER
        # Token is a real JWT (3 dot-separated segments)
        assert token.count(".") == 2
        assert refresh_token == "dev-refresh-token-001"
        assert expires_in == 300

    async def test_get_login_url_includes_redirect_uri(self, provider: DevAuthProvider):
        """get_login_url should return the redirect_uri with a code query param and state."""
        url, state = await provider.get_login_url("http://localhost:3000/callback")
        assert url == "http://localhost:3000/callback?code=dev-auth-code"
        assert state == "dev-state-static"

    async def test_get_logout_url_returns_root(self, provider: DevAuthProvider):
        """get_logout_url should return '/'."""
        url = await provider.get_logout_url()
        assert url == "/"


class TestDevRefreshAccessToken:
    """Tests for DevAuthProvider.refresh_access_token."""

    @pytest.fixture
    def provider(self) -> DevAuthProvider:
        return DevAuthProvider()

    async def test_valid_token_increments_counter(self, provider: DevAuthProvider):
        """refresh_access_token should increment the counter suffix."""
        user, token, new_refresh, expires_in = await provider.refresh_access_token("dev-refresh-token-001")
        assert user == DEV_USER
        assert token.count(".") == 2
        assert new_refresh == "dev-refresh-token-002"
        assert expires_in == 300

    async def test_counter_rolls_over_correctly(self, provider: DevAuthProvider):
        """refresh_access_token should handle larger counter values."""
        _, _, new_refresh, _ = await provider.refresh_access_token("dev-refresh-token-099")
        assert new_refresh == "dev-refresh-token-100"

    async def test_invalid_prefix_raises_authentication_error(self, provider: DevAuthProvider):
        """refresh_access_token should reject tokens without the correct prefix."""
        with pytest.raises(AuthenticationError, match="Invalid refresh token"):
            await provider.refresh_access_token("bad-prefix-001")

    async def test_non_numeric_suffix_raises_authentication_error(self, provider: DevAuthProvider):
        """refresh_access_token should reject tokens with non-numeric suffix."""
        with pytest.raises(AuthenticationError, match="Invalid refresh token"):
            await provider.refresh_access_token("dev-refresh-token-abc")
