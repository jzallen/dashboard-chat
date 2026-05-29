// Pure unit tests for the derived-view projection mapper. Hand-built snapshot
// views drive each branch in isolation (no wired actor, no I/O) — the contract
// (byte-identity vs buildProjection across the real scenarios) is pinned
// separately in derive-projection.contract.test.ts. These pin the mapper's
// internal logic: the child.value→state map, the phase-scoped no-child
// fallbacks, the full-ReducedContext shape, active_scope tiers per machine, and
// bookkeeping.

import { describe, expect, it } from "vitest";

import { FlowEvent } from "../../../domain/flow-event.ts";
import { initialContext } from "../../../domain/projection.ts";
import type { OnboardingResult } from "../setup/types.ts";
import {
  bookkeepingFromLog,
  type ChatAppSnapshotView,
  deriveProjection,
  LOGIN_AND_ORG_SETUP,
  PROJECT_AND_CHAT_SESSION_MANAGEMENT,
  SESSION_CHAT,
  UnknownWireMachineError,
} from "./derive-projection.ts";

// ── hand-built snapshot views ──

function child(value: string, context: Record<string, unknown>) {
  return { getSnapshot: () => ({ value, context }) };
}

function snap(opts: {
  onboarding_result?: OnboardingResult | null;
  children?: ChatAppSnapshotView["children"];
}): ChatAppSnapshotView {
  return {
    value: "login",
    context: {
      principal_id: "p1",
      onboarding_result: opts.onboarding_result ?? null,
    },
    children: opts.children ?? {},
  };
}

const BK = { sequence_id: 0, last_event_at: "", request_id: "" };
const NOOP = (m: string, s: ChatAppSnapshotView) => deriveProjection(s, m, BK);

// ───────────────────────────── bookkeeping ─────────────────────────────

describe("bookkeepingFromLog (the log-sourced envelope fields)", () => {
  it("is zero/empty for an empty log", () => {
    expect(bookkeepingFromLog([])).toEqual({
      sequence_id: 0,
      last_event_at: "",
      request_id: "",
    });
  });

  it("counts events and takes the LAST event's ts + request_id", () => {
    const e = (ts: string, request_id: string) =>
      FlowEvent.fromCache("m:p", { ts, type: "x", payload: {}, request_id });
    expect(
      bookkeepingFromLog([e("t1", "r1"), e("t2", "r2"), e("t3", "r3")]),
    ).toEqual({ sequence_id: 3, last_event_at: "t3", request_id: "r3" });
  });
});

// ───────────────────────────── login-and-org-setup ─────────────────────────────

describe("deriveProjection — login-and-org-setup", () => {
  it("yields the full zero-event ReducedContext + verifying when neither child nor outcome exist", () => {
    const out = NOOP(LOGIN_AND_ORG_SETUP, snap({}));
    expect(out.state).toBe("verifying");
    // The context is the COMPLETE ReducedContext shape with every default — so
    // any field the mapper does not populate matches the log fold byte-for-byte.
    expect(out.context).toEqual(
      initialContext() as unknown as Record<string, unknown>,
    );
    expect(out.active_scope).toEqual({
      org_id: "",
      project_id: null,
      resource_type: null,
      resource_id: null,
    });
    expect(out.flow_id).toBe("login-and-org-setup:p1");
  });

  it("maps a live onboarding child's state (needs_org) and reads its user/org", () => {
    const out = NOOP(
      LOGIN_AND_ORG_SETUP,
      snap({
        children: {
          "onboarding": child("needs_org", {
            user: { email: "m@x", display_name: "M X", first_name: "M" },
            org: { id: null, name: null },
            underlying_cause_tag: null,
            org_validation_error: null,
          }),
        },
      }),
    );
    expect(out.state).toBe("needs_org");
    expect(out.context.user).toEqual({
      email: "m@x",
      display_name: "M X",
      first_name: "M",
    });
    expect(out.active_scope.org_id).toBe(""); // no org yet → empty scope
  });

  it("uses the retained outcome (ready) once the phase-scoped child is gone", () => {
    const out = NOOP(
      LOGIN_AND_ORG_SETUP,
      snap({
        onboarding_result: {
          state: "ready",
          user: { email: "m@x", display_name: "M X", first_name: "M" },
          org: { id: "o1", name: "Org One" },
          underlying_cause_tag: null,
          org_validation_error: null,
        },
      }),
    );
    expect(out.state).toBe("ready");
    expect(out.context.org).toEqual({ id: "o1", name: "Org One" });
    expect(out.active_scope).toEqual({
      org_id: "o1",
      project_id: null,
      resource_type: null,
      resource_id: null,
    });
  });
});

// ───────────────────────── project-and-chat-session-management ─────────────────────────

describe("deriveProjection — project-and-chat-session-management", () => {
  const pcChild = (value: string, over: Record<string, unknown> = {}) =>
    child(value, {
      org_id: "o1",
      user: { first_name: "M" },
      project: { id: "p-A", name: "Proj A" },
      underlying_cause_tag: null,
      pending_project_name: "",
      project_validation_error: null,
      most_recent_session_per_project: {},
      deeplink_project_id: null,
      last_used_degraded_project_ids: [],
      ...over,
    });

  it("falls back to verifying (empty-log equivalent) before the child is invoked", () => {
    expect(NOOP(PROJECT_AND_CHAT_SESSION_MANAGEMENT, snap({})).state).toBe(
      "verifying",
    );
  });

  it("maps project_selected with project+org scope and a NULL org name (log never carries it)", () => {
    const out = NOOP(
      PROJECT_AND_CHAT_SESSION_MANAGEMENT,
      snap({ children: { "project-context": pcChild("project_selected") } }),
    );
    expect(out.state).toBe("project_selected");
    expect(out.context.org).toEqual({ id: "o1", name: null });
    expect(out.context.project).toEqual({ id: "p-A", name: "Proj A" });
    expect(out.active_scope).toEqual({
      org_id: "o1",
      project_id: "p-A",
      resource_type: null,
      resource_id: null,
    });
  });

  it("surfaces last_used_resolution_degraded from the degraded project ids", () => {
    const out = NOOP(
      PROJECT_AND_CHAT_SESSION_MANAGEMENT,
      snap({
        children: {
          "project-context": pcChild("project_selected", {
            last_used_degraded_project_ids: ["p-x", "p-y"],
          }),
        },
      }),
    );
    expect(out.context.last_used_resolution_degraded).toEqual({
      failed_project_ids: ["p-x", "p-y"],
      partial_result: true,
    });
  });
});

// ───────────────────────────── session-chat ─────────────────────────────

describe("deriveProjection — session-chat", () => {
  const scChild = (value: string, over: Record<string, unknown> = {}) =>
    child(value, {
      org_id: "o1",
      project: { id: "p-A", name: "Proj A" },
      session_list: [],
      session_list_next_cursor: null,
      session_list_has_more: false,
      session_id: null,
      transcript: [],
      resource: { type: null, id: null },
      pending_resume_session_id: null,
      underlying_cause_tag: null,
      pending_first_message: "",
      ...over,
    });

  it("falls back to verifying before chat is entered", () => {
    expect(NOOP(SESSION_CHAT, snap({})).state).toBe("verifying");
  });

  it("maps session_active with a dataset resource into active_scope", () => {
    const out = NOOP(
      SESSION_CHAT,
      snap({
        children: {
          "session-chat": scChild("session_active", {
            session_id: "s1",
            resource: { type: "dataset", id: "ds-1" },
          }),
        },
      }),
    );
    expect(out.state).toBe("session_active");
    expect(out.context.session_id).toBe("s1");
    expect(out.active_scope).toEqual({
      org_id: "o1",
      project_id: "p-A",
      resource_type: "dataset",
      resource_id: "ds-1",
    });
  });

  it("derives session_dataset_unavailable from the dataset_not_found cause", () => {
    const out = NOOP(
      SESSION_CHAT,
      snap({
        children: {
          "session-chat": scChild("session_active", {
            session_id: "s1",
            underlying_cause_tag: "dataset_not_found",
          }),
        },
      }),
    );
    expect(out.context.session_dataset_unavailable).toBe(true);
    expect(out.context.underlying_cause_tag).toBe("dataset_not_found");
  });
});

// ───────────────────────────── routing ─────────────────────────────

describe("deriveProjection — wire-name routing", () => {
  it("throws UnknownWireMachineError on an unknown machine name", () => {
    expect(() => NOOP("bogus", snap({}))).toThrow(UnknownWireMachineError);
  });
});
