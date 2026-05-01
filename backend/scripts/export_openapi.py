"""Dump the FastAPI app's OpenAPI schema to stdout (or a file).

Used by the SDK build pipeline to feed openapi-python-client. Run from the
backend/ working directory so app imports resolve:

    cd backend && uv run python scripts/export_openapi.py \
        > ../dashboard_chat_sdk/openapi.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.main import app


def main(argv: list[str]) -> int:
    schema = app.openapi()
    out = json.dumps(schema, indent=2, sort_keys=True) + "\n"
    if len(argv) > 1:
        Path(argv[1]).write_text(out)
    else:
        sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
