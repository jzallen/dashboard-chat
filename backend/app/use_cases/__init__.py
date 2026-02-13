"""Use cases for application business logic."""

from functools import wraps
from logging import getLogger

from returns.result import Success, Failure

logger = getLogger(__name__)


def handle_returns(func):
    """Decorator that wraps use-case return values in Success/Failure."""

    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            result = await func(*args, **kwargs)
        except Exception as e:
            logger.exception("Error in %s: %s", func.__name__, str(e))
            return Failure(e)
        else:
            return Success(result)

    return wrapper
