# UI-State Tier — production image.
#
# Per ADR-030 §SD2, this tier is single-replica (XState v5 actors are
# in-process). The image bundles Hono + xstate + ioredis and runs via tsx
# directly (no precompile step — index.ts is small enough that startup-time
# transpile is faster than maintaining a build pipeline).

FROM node:20-alpine

WORKDIR /app

# Copy manifest first for layer caching. The build context is the repo
# root (docker-compose.yml's `build: { context: ., dockerfile: ui-state/
# Dockerfile }`); paths are resolved from there.
COPY ui-state/package.json ui-state/tsconfig.json ./

# Install production deps + tsx for runtime TS execution.
# --no-package-lock because the lockfile sits at the workspace root; the
# tier's deps are stable and pinned in package.json.
RUN npm install --no-package-lock --omit=dev --ignore-scripts \
    && npm install --no-package-lock --ignore-scripts --no-save tsx

# `@dashboard-chat/shared-failure-simulation` is a workspace package that
# index.ts imports (ADR-035 gate verdict, ADR-036 composition-root probe).
# It is not listed in ui-state/package.json — the workspace symlink at the
# repo root provides it during local dev, but isolated Docker builds need it
# copied in explicitly. The build context in docker-compose.override.yml is
# the repo root for that reason; the Dockerfile resolves it relative to the
# `ui-state` subdirectory.
COPY shared/failure-simulation/ ./node_modules/@dashboard-chat/shared-failure-simulation/

# Copy source after deps so source-only changes don't bust the deps layer.
COPY ui-state/index.ts ui-state/config.ts ./
COPY ui-state/lib/ ./lib/

# Run as non-root for production safety.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 8788

CMD ["npx", "tsx", "index.ts"]
