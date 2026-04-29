"""Idempotency-Key support for mutation endpoints.

Backs Epic C.3. Mutation endpoints can opt-in by reading the
`Idempotency-Key` request header and routing the work through
``idempotent_request``. Repeat requests with the same key return the
prior cached response; a key reused with a different body returns 409.
"""

from .middleware import idempotent_request
from .record import IdempotencyKeyRecord
from .store import DEFAULT_TTL, IdempotencyHit, IdempotencyStore, hash_body

__all__ = [
    "DEFAULT_TTL",
    "IdempotencyHit",
    "IdempotencyKeyRecord",
    "IdempotencyStore",
    "hash_body",
    "idempotent_request",
]
