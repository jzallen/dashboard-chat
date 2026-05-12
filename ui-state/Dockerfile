# UI-State Tier — production image.
#
# Per ADR-030 §SD2, this tier is single-replica (XState v5 actors are
# in-process). The image bundles Hono + xstate + ioredis and runs via tsx
# directly (no precompile step — index.ts is small enough that startup-time
# transpile is faster than maintaining a build pipeline).

FROM node:20-alpine

WORKDIR /app

# Copy manifest first for layer caching.
COPY package.json tsconfig.json ./

# Install production deps + tsx for runtime TS execution.
# --no-package-lock because the lockfile sits at the workspace root; the
# tier's deps are stable and pinned in package.json.
RUN npm install --no-package-lock --omit=dev --ignore-scripts \
    && npm install --no-package-lock --ignore-scripts --no-save tsx

# Copy source after deps so source-only changes don't bust the deps layer.
COPY index.ts ./
COPY lib/ ./lib/

# Run as non-root for production safety.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 8788

CMD ["npx", "tsx", "index.ts"]
