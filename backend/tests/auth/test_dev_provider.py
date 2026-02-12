import pytest

from app.auth.dev_provider import DevAuthProvider, DEV_USER, DEV_TOKEN
from app.auth.exceptions import AuthenticationError


class TestDevAuthProvider:
    """Tests for DevAuthProvider -- zero-network dev auth."""

    @pytest.fixture
    def provider(self) -> DevAuthProvider:
        return DevAuthProvider()

    async def test_verify_token_with_valid_token_returns_dev_user(self, provider: DevAuthProvider):
        """verify_token with the static dev token should return DEV_USER."""
        result = await provider.verify_token(DEV_TOKEN)
        assert result == DEV_USER

    async def test_verify_token_with_invalid_token_raises_authentication_error(self, provider: DevAuthProvider):
        """verify_token with a bad token should raise AuthenticationError."""
        with pytest.raises(AuthenticationError, match="Invalid dev token"):
            await provider.verify_token("bad-token")

    async def test_verify_token_with_empty_token_raises_authentication_error(self, provider: DevAuthProvider):
        """verify_token with an empty string should raise AuthenticationError."""
        with pytest.raises(AuthenticationError, match="Invalid dev token"):
            await provider.verify_token("")

    async def test_handle_callback_returns_dev_user_and_token(self, provider: DevAuthProvider):
        """handle_callback should always return (DEV_USER, DEV_TOKEN)."""
        user, token = await provider.handle_callback("any-code")
        assert user == DEV_USER
        assert token == DEV_TOKEN

    async def test_get_login_url_includes_redirect_uri(self, provider: DevAuthProvider):
        """get_login_url should return the redirect_uri with a code query param."""
        url = await provider.get_login_url("http://localhost:3000/callback")
        assert url == "http://localhost:3000/callback?code=dev-auth-code"

    async def test_get_logout_url_returns_root(self, provider: DevAuthProvider):
        """get_logout_url should return '/'."""
        url = await provider.get_logout_url()
        assert url == "/"
