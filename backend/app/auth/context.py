from contextvars import ContextVar

from .types import AuthUser

_auth_user: ContextVar[AuthUser | None] = ContextVar("auth_user", default=None)


def get_auth_user() -> AuthUser:
    user = _auth_user.get()
    if user is None:
        raise RuntimeError("No auth user in context. Auth middleware must run first.")
    return user


def set_auth_user(user: AuthUser) -> None:
    _auth_user.set(user)


def clear_auth_user() -> None:
    _auth_user.set(None)
