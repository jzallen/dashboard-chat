// POST /state/keepalive — the TTL-refresh touch surface (slice B). The client's
// idle tracker fires this debounced to keep an active-but-idle session's keys
// alive; it must bump the snapshot + all four canonical child logs for the
// principal, never mutate state, and stay best-effort (always 204).
import { describe, expect, it, vi } from "vitest";

import { buildChatAppApp } from "../../../index.ts";
import {
  type ChatAppSnapshotStore,
  createNoopChatAppSnapshotStore,
} from "../../persistence/chatapp-snapshot-store.ts";
import {
  createNoopFlowEventLog,
  type FlowEventLog,
} from "../../persistence/redis.ts";

function buildWithStores(
  eventLog: FlowEventLog,
  snapshotStore: ChatAppSnapshotStore,
): ReturnType<typeof buildChatAppApp> {
  return buildChatAppApp({
    eventLog,
    snapshotStore,
    chatAppDeps: { projectContext: {}, sessionChat: {} },
    logTransition: () => undefined,
  });
}

async function keepalive(
  app: ReturnType<typeof buildChatAppApp>,
  headers: Record<string, string>,
): Promise<Response> {
  return app.fetch(
    new Request("http://t/state/keepalive", { method: "POST", headers }),
  );
}

describe("POST /state/keepalive", () => {
  it("204s and touches the snapshot + all four canonical child logs", async () => {
    const eventLog = createNoopFlowEventLog();
    const snapshotStore = createNoopChatAppSnapshotStore();
    const eventTouch = vi.spyOn(eventLog, "touch");
    const snapTouch = vi.spyOn(snapshotStore, "touch");
    const app = buildWithStores(eventLog, snapshotStore);

    const res = await keepalive(app, { "X-User-Id": "u-keep" });

    expect(res.status).toBe(204);
    expect(snapTouch).toHaveBeenCalledWith("u-keep");
    expect(eventTouch.mock.calls.map((c) => c[0]).sort()).toEqual(
      [
        "onboarding:u-keep",
        "project-context:u-keep",
        "session-chat:u-keep",
        "source-upload:u-keep",
      ].sort(),
    );
  });

  it("400s when X-User-Id is absent (no principal to touch)", async () => {
    const eventLog = createNoopFlowEventLog();
    const snapshotStore = createNoopChatAppSnapshotStore();
    const snapTouch = vi.spyOn(snapshotStore, "touch");
    const app = buildWithStores(eventLog, snapshotStore);

    const res = await keepalive(app, {});

    expect(res.status).toBe(400);
    expect(snapTouch).not.toHaveBeenCalled();
  });

  it("still 204s when a touch rejects (best-effort)", async () => {
    const eventLog = createNoopFlowEventLog();
    const snapshotStore = createNoopChatAppSnapshotStore();
    vi.spyOn(snapshotStore, "touch").mockRejectedValue(new Error("redis down"));
    const app = buildWithStores(eventLog, snapshotStore);

    const res = await keepalive(app, { "X-User-Id": "u-x" });

    expect(res.status).toBe(204);
  });
});

describe("POST /state/logout", () => {
  it("204s and resets the snapshot + all four canonical child logs", async () => {
    const eventLog = createNoopFlowEventLog();
    const snapshotStore = createNoopChatAppSnapshotStore();
    const eventReset = vi.spyOn(eventLog, "reset");
    const snapReset = vi.spyOn(snapshotStore, "reset");
    const app = buildWithStores(eventLog, snapshotStore);

    const res = await app.fetch(
      new Request("http://t/state/logout", {
        method: "POST",
        headers: { "X-User-Id": "u-out" },
      }),
    );

    expect(res.status).toBe(204);
    expect(snapReset).toHaveBeenCalledWith("u-out");
    expect(eventReset.mock.calls.map((c) => c[0]).sort()).toEqual(
      [
        "onboarding:u-out",
        "project-context:u-out",
        "session-chat:u-out",
        "source-upload:u-out",
      ].sort(),
    );
  });

  it("400s when X-User-Id is absent", async () => {
    const app = buildWithStores(
      createNoopFlowEventLog(),
      createNoopChatAppSnapshotStore(),
    );
    const res = await app.fetch(
      new Request("http://t/state/logout", { method: "POST" }),
    );
    expect(res.status).toBe(400);
  });
});
