#!/bin/bash
set -e

# Node workspace dependencies
npm install

# Python package manager (uv)
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.cargo/bin:$PATH"

# Python backend dependencies
cd backend && uv sync && cd ..

# Git hooks
npx husky init

# Global CLI tools
npm install -g @bazel/bazelisk          # Bazel version manager (picks up .bazelversion)
npm install -g @fission-ai/openspec@latest
npm install -g @upstash/context7-mcp@latest

# MCP server: Serena
uv tool install "serena @ git+https://github.com/oraios/serena"
