// In-process INTEGRATION tests for the ADR-046 `/state` actor surface (MR-2).
//
// These drive the LIVE ui-state HTTP tier via `app.fetch` (no socket, no Redis),
// exactly as index.test.ts drives the per-machine wire. The `/state` surface is
// ADDITIVE: it shares the SAME `ChatAppRuntime` (one registry, one event log, one
// snapshot store) as the five per-machine mounts, so a document derived from
// `GET /state` reads the SAME per-principal actor the `/flow/<m>/projection`
// reads do. Mocks are ONLY at the child port boundaries (the onboarding child's
// `fetch`; `fromPromise` fakes for project-context + session-chat resolvers).
//
// The three behaviours pinned (the ADR-046 §9 MR-2 acceptance row):
//   1. begin→event via POST /state/events; the returned document's regions equal
//      the three per-machine reads for the SAME actor (the MR-1 equivalence gate,
//      now over the live route);
//   2. GET /state pre-bootstrap folds to the anonymous document and does NOT
//      cold-start; post-bootstrap returns the live document (Decision 3a);
//   3. GET /state/stream emits a first document frame and a FRESH document frame
//      after a child-log event.
//
// References:
//   docs/decisions/adr-046-*.md  — StateProxy actor surface; Decision 3/3a; §9 MR-2

import { describe, expect, it } from "vitest";
import { fromPromise } from "xstate";

import { buildChatAppApp } from "../../../index.ts";
import type { ChatAppDeps } from "./index.ts";
import { createNoopChatAppSnapshotStore } from "../../persistence/chatapp-snapshot-store.ts";
import {
  createNoopFlowEventLog,
  type FlowEventLog,
} from "../../persistence/redis.ts";
import type { RequestClient } from "../onboarding/index.ts";
import { makeMockFetch, makeTestConfig } from "../../testing/test-config.ts";
import type { ChatAppStateDocument } from "./projection/derive-state-document.ts";

const MAYA_PROFILE = { email: "maya@acme", name: "Maya Chen" };
const PROJECT_A = { id: "proj-A", name: "Project A" };

/** Returning user — backend /api/orgs/me reports an org (cascade reaches chat). */
function returningFetch(
  org: { id: string; name: string } = { id: "org-1", name: "Acme Data" },
): RequestClient {
  return makeMockFetch({ profile: MAYA_PROFILE, existingOrg: org });
}

/** New user — re-verify OK, backend 404 (no org), create OK (org id "org-1"). */
function okFetch(): RequestClient {
  return makeMockFetch({ profile: MAYA_PROFILE, orgId: "org-1" });
}

function fakeChatAppDeps(): ChatAppDeps {
  return {
    projectContext: {
      resolveInitialScope: fromPromise(async () => ({ project: PROJECT_A })),
      createProject: fromPromise(async () => PROJECT_A),
      switchProject: fromPromise(async ({ input }) => ({
        project: {
          id: (input as { new_project_id: string }).new_project_id,
          name: "Switched",
        },
      })),
    },
    sessionChat: {
      loadSessionList: fromPromise(async () => ({
        items: [],
        next_cursor: null,
        has_more: false,
        resume_target: null,
      })),
      resumeSession: fromPromise(async ({ input }) => ({
        session_id: (input as { session_id: string }).session_id,
        transcript: [],
        active_dataset_id: null,
      })),
    },
  } as unknown as ChatAppDeps;
}

interface Scenario {
  app: ReturnType<typeof buildChatAppApp>;
  eventLog: FlowEventLog;
}

function buildScenario(opts: { requestClient: RequestClient }): Scenario {
  const eventLog = createNoopFlowEventLog();
  const app = buildChatAppApp({
    eventLog,
    snapshotStore: createNoopChatAppSnapshotStore(),
    chatAppDeps: fakeChatAppDeps(),
    config: makeTestConfig(),
    requestClient: opts.requestClient,
    logTransition: () => undefined,
  });
  return { app, eventLog };
}

// ───────────────────────────── transport helpers ─────────────────────────────

/** GET /state for a principal — returns the parsed state document. */
async function getState(
  app: Scenario["app"],
  userId: string,
): Promise<ChatAppStateDocument> {
  const res = await app.fetch(
    new Request("http://t/state", {
      method: "GET",
      headers: { "X-User-Id": userId },
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as ChatAppStateDocument;
}

/** POST /state/events — apply ONE event, return { status, document }. */
async function postStateEvent(
  app: Scenario["app"],
  body: Record<string, unknown>,
  opts: { userId: string; bearer?: string },
): Promise<{ status: number; document: ChatAppStateDocument }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-User-Id": opts.userId,
  };
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  const res = await app.fetch(
    new Request("http://t/state/events", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, document: (await res.json()) as ChatAppStateDocument };
}

/** Read ONE per-machine projection slice ({ state, context }) for the actor. */
async function readSlice(
  app: Scenario["app"],
  userId: string,
  machine: string,
): Promise<{ state: string; context: unknown; active_scope: unknown }> {
  const res = await app.fetch(
    new Request(`http://t/flow/${machine}/projection`, {
      method: "GET",
      headers: { "X-User-Id": userId },
    }),
  );
  return (await res.json()) as {
    state: string;
    context: unknown;
    active_scope: unknown;
  };
}

/** A pull-based SSE frame reader over the streaming Response: each call yields
 *  the next parsed `data:` document; a buffer carries partial frames between
 *  calls so a POST can interleave between frame 1 and frame 2. */
function frameReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(): Promise<ChatAppStateDocument> {
      for (;;) {
        const idx = buffer.indexOf("\n\n");
        if (idx >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (dataLine) {
            return JSON.parse(dataLine.slice("data:".length).trim());
          }
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended before a frame arrived");
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel: () => reader.cancel().catch(() => undefined),
  };
}

// ═════════════════ 1 — begin→event document equals the three per-machine reads ═════════════════

describe("ADR-046 MR-2: POST /state/events returns the whole-actor document", () => {
  it("the post-bootstrap document's regions equal the three per-machine slice reads for the same actor", async () => {
    const { app } = buildScenario({ requestClient: returningFetch() });

    // begin: the reserved session_begin event cold-starts + cascades the actor.
    const { status, document } = await postStateEvent(
      app,
      { type: "session_begin" },
      { userId: "u1", bearer: "tok-1" },
    );
    expect(status).toBe(200);

    // The SAME actor, read through the legacy per-machine wire.
    const login = await readSlice(app, "u1", "login-and-org-setup");
    const project = await readSlice(
      app,
      "u1",
      "project-and-chat-session-management",
    );
    const chat = await readSlice(app, "u1", "session-chat");

    // Region-by-region equivalence (the MR-1 gate, now over the live route).
    expect(document.regions.onboarding).toEqual({
      state: login.state,
      context: login.context,
    });
    expect(document.regions.projectContext).toEqual({
      state: project.state,
      context: project.context,
    });
    expect(document.regions.sessionChat).toEqual({
      state: chat.state,
      context: chat.context,
    });

    // active_scope is the deepest-resolved region's scope.
    const deepest =
      (chat.active_scope as { org_id?: string }).org_id
        ? chat.active_scope
        : (project.active_scope as { org_id?: string }).org_id
          ? project.active_scope
          : login.active_scope;
    expect(document.active_scope).toEqual(deepest);

    // The returning user cascaded all the way to chat.
    expect(document.phase).toBe("chat");
    expect(document.regions.onboarding.state).toBe("ready");
    expect(document.regions.projectContext.state).toBe("project_selected");
    expect(document.regions.sessionChat.state).toBe("session_list_loaded");

    // The POST response IS the new state document — a follow-up GET /state agrees.
    const reread = await getState(app, "u1");
    expect(reread.regions).toEqual(document.regions);
    expect(reread.phase).toBe(document.phase);
  });

  it("an org submission applied via POST /state/events drives onboarding needs_org → ready", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });

    // Implicit bootstrap (no prior session_begin): first contact cold-starts.
    const bootstrap = await postStateEvent(
      app,
      { type: "session_begin" },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(bootstrap.document.regions.onboarding.state).toBe("needs_org");

    const { status, document } = await postStateEvent(
      app,
      { type: "org_form_submitted", payload: { org_name: "Acme Data" } },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(200);
    expect(document.regions.onboarding.state).toBe("ready");
    expect(document.regions.onboarding.context.org.id).toBe("org-1");
  });

  it("refuses an unmodeled onboarding event at the phase-dispatched ACL (400, no-op)", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });

    const { status } = await postStateEvent(
      app,
      { type: "totally_unknown_event", payload: {} },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(400);

    // The flow is unchanged — still needs_org.
    const doc = await getState(app, "u2");
    expect(doc.regions.onboarding.state).toBe("needs_org");
  });
});

// ═════════════════ 2 — GET /state pre/post bootstrap (Decision 3a) ═════════════════

describe("ADR-046 MR-2: GET /state folds to the anonymous document pre-bootstrap", () => {
  it("returns the anonymous document and does NOT cold-start", async () => {
    const { app } = buildScenario({ requestClient: returningFetch() });

    const anon = await getState(app, "u1");
    expect(anon.phase).toBe("onboarding");
    expect(anon.regions.onboarding.state).toBe("verifying");
    expect(anon.active_scope.org_id).toBe("");

    // A second pre-bootstrap read is STILL anonymous — the first read did not
    // mint an actor (Decision 3a: GET /state never cold-starts).
    const anonAgain = await getState(app, "u1");
    expect(anonAgain.regions.onboarding.state).toBe("verifying");
  });

  it("returns the live document once the principal has bootstrapped", async () => {
    const { app } = buildScenario({ requestClient: returningFetch() });

    await postStateEvent(app, { type: "session_begin" }, { userId: "u1", bearer: "tok-1" });

    const live = await getState(app, "u1");
    expect(live.phase).toBe("chat");
    expect(live.regions.onboarding.state).toBe("ready");
    expect(live.regions.onboarding.context.org).toEqual({
      id: "org-1",
      name: "Acme Data",
    });
  });
});

// ═════════════════ 3 — GET /state/stream first frame + fresh frame on a child-log event ═════════════════

describe("ADR-046 MR-2: GET /state/stream emits documents", () => {
  it("emits a first document frame, then a fresh document after a child-log event", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });

    // Bootstrap a new user → needs_org.
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });

    const streamRes = await app.fetch(
      new Request("http://t/state/stream?budget_ms=2000", {
        method: "GET",
        headers: { "X-User-Id": "u2" },
      }),
    );
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");

    const frames = frameReader(streamRes);
    try {
      // First frame: the current document (needs_org).
      const first = await frames.next();
      expect(first.regions.onboarding.state).toBe("needs_org");

      // A child-log event (org submission) must push a fresh document frame.
      const applied = await postStateEvent(
        app,
        { type: "org_form_submitted", payload: { org_name: "Acme Data" } },
        { userId: "u2", bearer: "tok-2" },
      );
      expect(applied.document.regions.onboarding.state).toBe("ready");

      const second = await frames.next();
      expect(second.regions.onboarding.state).toBe("ready");
    } finally {
      await frames.cancel();
    }
  });
});
