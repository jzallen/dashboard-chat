#!/bin/bash
# Run the FastAPI server using uv (with local dev setup)

uv run python scripts/setup_dev.py && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
