"""Uvicorn entrypoint for the backend API."""

import contextlib
import sys

import uvicorn

from app.main import app

if __name__ == "__main__":
    # Run dev setup (MinIO buckets + SQLite seed) before starting the server.
    # Mimics the old docker-compose command: setup_dev.py && uvicorn ...
    sys.argv = [sys.argv[0]]  # clear args so argparse in setup_dev doesn't choke
    from scripts.setup_dev import main as setup_dev

    with contextlib.suppress(SystemExit):
        setup_dev()

    uvicorn.run(app, host="0.0.0.0", port=8000)
