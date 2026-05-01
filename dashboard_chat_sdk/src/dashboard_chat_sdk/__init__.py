"""Dashboard Chat Python SDK.

v0.1.0 covers the FastAPI-emitted surface (projects, datasets, sessions,
session replay). Auth-proxy (PAT/M2M) and the agent /chat SSE endpoint are
out of scope for this release — see sibling beads H.4 and H.5.
"""

from __future__ import annotations

from ._client import Client
from ._generated import errors, models

__version__ = "0.1.0"

__all__ = ["Client", "errors", "models", "__version__"]
