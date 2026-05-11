// SCAFFOLD: true
//
// Flow-State Tier — Hono server entry point.
//
// RED scaffold per Mandate 7 (DISTILL wave 2026-05-11). All four routes
// from `docs/feature/user-flow-state-machines/design/handoff-design-to-distill.md`
// §"Endpoints to assert against" are wired here but return:
//
//   HTTP 501 Not Implemented
//   { __SCAFFOLD__: true, message: "Not yet implemented — RED scaffold" }
//
// This makes the acceptance tests classify as RED (failing for the right
// reason — production code does not yet exist) rather than BROKEN
// (failing for an import or wiring error).
//
// DELIVER replaces these stubs incrementally per `roadmap.json` steps 1-6.

import { serve } from "@hono/node-server";
import { Hono } from "hono";

export const __SCAFFOLD__ = true;

const SCAFFOLD_BODY = {
  __SCAFFOLD__: true,
  message: "Not yet implemented — RED scaffold",
} as const;

const app = new Hono();

app.get("/health", (c) => c.json({ status: "scaffold", __SCAFFOLD__: true }));

// Begin a new flow instance for the given machine name.
// Contract: { correlation_id, projection } returned on success.
app.post("/flow/:machine/begin", (c) => c.json(SCAFFOLD_BODY, 501));

// Send an event to an existing flow.
// Contract: { projection } returned on success.
app.post("/flow/:machine/event", (c) => c.json(SCAFFOLD_BODY, 501));

// Read the current projection for a given flow_id.
// Contract: FlowProjection object returned on success.
app.get("/flow/:machine/projection", (c) => c.json(SCAFFOLD_BODY, 501));

// Freeze + thaw routes (US-005 cross-machine coordination).
app.post("/flow/:machine/freeze", (c) => c.json(SCAFFOLD_BODY, 501));
app.post("/flow/:machine/thaw", (c) => c.json(SCAFFOLD_BODY, 501));

// SSE projection stream (Slice 3 requirement; deferred behind the others).
app.get("/flow/:machine/projection/stream", (c) =>
  c.json(SCAFFOLD_BODY, 501),
);

const PORT = parseInt(process.env.PORT ?? "8788", 10);

if (process.env.FLOW_STATE_AUTOSTART !== "false") {
  serve({ fetch: app.fetch, port: PORT });
  // eslint-disable-next-line no-console
  console.log(
    `[flow-state] SCAFFOLD listening on :${PORT} — all routes return 501`,
  );
}

export { app };
