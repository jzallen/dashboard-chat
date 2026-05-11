# SCAFFOLD: true
#
# Flow-State Tier — RED scaffold image.
# Production Dockerfile lands during DELIVER (mirror agent/Dockerfile shape).

FROM node:22-alpine

WORKDIR /app

COPY package.json tsconfig.json ./
COPY index.ts ./
COPY lib/ ./lib/

# In the scaffold phase we install everything via the workspace; once
# DELIVER lands the production image we switch to a workspace-aware
# multi-stage build.
RUN npm install --no-save hono @hono/node-server xstate ioredis zod
RUN npm install --no-save -D tsx typescript

EXPOSE 8788

CMD ["npx", "tsx", "index.ts"]
