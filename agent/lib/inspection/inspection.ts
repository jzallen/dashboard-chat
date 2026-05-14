// Inspection-probe route registration per ADR-036.
//
// Inspection probes are read-only observability endpoints; they share the
// ENVIRONMENT gate with the failure-simulation registry but live outside its
// module home because they are a different shape of solution (route-side, no
// manifest entry, no audit emission). This file is the agent service's
// inspection-probe entry point.
//
// Conditional registration is the contract: when the gate verdict is
// disabled, no `/debug/*` route is registered at all. Requests then return
// 404 (route absent) rather than 403 (route present but denied) — CA-7 in
// the DISTILL contract assertions. The 404-not-403 distinction matters
// because it removes the read-side surface from staging/production entirely
// rather than relying on a runtime denial.

import type { GateVerdict } from "@dashboard-chat/shared-failure-simulation";
import type { Hono } from "hono";

import { requestLog } from "../chat/requestLog";

export function registerInspectionRoutes(
  app: Hono,
  verdict: GateVerdict,
): void {
  if (verdict.state !== "enabled") {
    return;
  }

  app.get("/debug/last-request-scope", (c) => {
    const last = requestLog.last();
    if (!last) {
      return c.json({ scope: null, reason: "no requests recorded" });
    }
    return c.json({ scope: last.scope, status: last.status });
  });

  app.get("/debug/request-log", (c) => {
    return c.json({ entries: requestLog.all() });
  });

  app.post("/debug/request-log/clear", (c) => {
    requestLog.clear();
    return c.json({ cleared: true });
  });
}
