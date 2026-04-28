"""Build-identity loader and startup logger.

Reads /etc/dashboard-chat/version.json (planted by the Bazel `version_layer`
macro) and emits a single canonical identity line on stdout. Falls back to
"unknown" tokens if the file is missing or unparseable so that uninstrumented
images still boot (AC1.5).

Format (matches AC1.1 regex from docs/feature/log-image-identity-on-startup/discuss/user-stories.md):

    <service> image=<tag> sha=<sha7>[+dirty] built=<rfc3339>
"""

from __future__ import annotations

import json
from pathlib import Path

VERSION_FILE = Path("/etc/dashboard-chat/version.json")
UNKNOWN = "unknown"


def _format_identity_line(
    service: str,
    image: str,
    sha: str,
    dirty: bool,
    built: str,
) -> str:
    short_sha = sha[:7] if sha != UNKNOWN and len(sha) >= 7 else sha
    dirty_marker = "+dirty" if dirty and sha != UNKNOWN else ""
    return f"{service} image={image} sha={short_sha}{dirty_marker} built={built}"


def log_image_identity(service: str) -> None:
    """Emit the canonical image identity line for `service` on stdout.

    Does not raise: a missing or malformed version.json degrades to
    "image=unknown sha=unknown built=unknown" and the service boots normally.
    """
    image = sha = built = UNKNOWN
    dirty = False
    try:
        payload = json.loads(VERSION_FILE.read_text(encoding="utf-8"))
        image = str(payload.get("image", UNKNOWN))
        sha = str(payload.get("sha", UNKNOWN))
        dirty = bool(payload.get("dirty", False))
        built = str(payload.get("built", UNKNOWN))
    except (OSError, ValueError, TypeError):
        # File missing, unreadable, or invalid JSON — graceful degradation.
        pass

    # print to stdout directly so the line appears in `docker compose logs`
    # regardless of logging-config timing during FastAPI startup.
    print(_format_identity_line(service, image, sha, dirty, built), flush=True)
