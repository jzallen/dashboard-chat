import { Hono } from "hono";

import type { PresentationStateLog } from "./presentationState";

/**
 * Hono sub-app that exposes the reflect-only directive log
 * (ADR-015 / dc-x3y.2.2).
 *
 * Mounted by `agent/index.ts`. Extracted into its own module so the route
 * can be exercised via Hono's `fetch(...)` API in tests without booting the
 * full agent server.
 */
export function createPresentationStateRoutes(
  log: PresentationStateLog,
): Hono {
  const app = new Hono();

  app.get("/api/channels/:channelId/presentation-state", async (c) => {
    const channelId = c.req.param("channelId");
    if (!channelId) {
      return c.json({ error: "channel_id required" }, 400);
    }
    const entry = await log.get(channelId);
    return c.json(entry);
  });

  return app;
}
