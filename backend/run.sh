#!/bin/bash
# Run the FastAPI server using uv

uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
