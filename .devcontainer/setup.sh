#!/bin/bash
set -e

mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null
chmod 600 ~/.ssh/known_hosts

# Ensure we have the latest from remote main
git pull origin main

# Node workspace dependencies
npm install

# Claude
curl -LsSf https://claude.ai/install.sh | bash

# Python package manager (uv)
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.cargo/bin:$PATH"

# Python backend dependencies
cd backend && uv sync --extra test && cd ..

# Git hooks
npx husky init

# Global CLI tools
npm install -g @bazel/bazelisk          # Bazel version manager (picks up .bazelversion)
npm install -g @fission-ai/openspec@latest
