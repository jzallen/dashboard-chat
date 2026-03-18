"""Simple in-memory rate limiter for token refresh requests."""

import time


class InMemoryRateLimiter:
    def __init__(self, window_seconds: int = 10):
        self._timestamps: dict[str, float] = {}
        self._window = window_seconds

    def check(self, key: str) -> bool:
        """Returns True if request is allowed, False if rate limited."""
        now = time.time()
        # Lazy cleanup of stale entries
        stale = [k for k, v in self._timestamps.items() if now - v > self._window * 10]
        for k in stale:
            del self._timestamps[k]

        last = self._timestamps.get(key)
        if last and now - last < self._window:
            return False
        self._timestamps[key] = now
        return True


refresh_limiter = InMemoryRateLimiter(window_seconds=10)
