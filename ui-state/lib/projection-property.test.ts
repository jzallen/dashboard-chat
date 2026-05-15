// Property test — project-context and session-chat agree on project state.
//
// Audit reference: docs/discussion/ui-state-vocabulary-audit/findings.md §9 Q3.
// ADR reference:   docs/decisions/adr-039-ui-state-naming-conventions.md §C12.
//
// Gate for the field-collapse step. The projection currently maintains TWO
// pairs of fields that carry project identity:
//
//   - `context.project.{id,name}`             — written by project_selected
//                                                (project-context's settle).
//   - `context.session_chat_project_{id,name}` — written by project_context_inherited
//                                                (session-chat's wake-up; the
//                                                event payload originates from
//                                                the orchestrator's project_ready
//                                                re-broadcast, which is built
//                                                from project-context's own
//                                                `project.{id,name}`).
//
// Audit §7 #5 + §9 Q3: the duplicate is a machine-name leak (C12) safe to
// retire ONCE the two paths are proven to agree across arbitrary
// project-switch sequences. This test is that proof.
//
// Production constraint encoded below: the orchestrator's project_ready
// re-broadcast carries the SAME (project_id, project_name) tuple it just
// learned from project-context's `project_selected`. The test generates
// sequences where each `project_context_inherited` payload is sourced from
// the most-recent `project_selected` — mirroring production.
//
// Property-test framework choice: this repo does not have `fast-check` as a
// dep (only acceptance-test comments mention it as a future enhancement).
// The audit asks for a property test, not specifically fast-check. We use a
// seeded deterministic generator that enumerates ~30 scenarios — covers the
// shape space without adding a runtime dep, and the seed makes failures
// reproducible.

import { describe, expect,it } from "vitest";

import { buildProjection, type FlowEvent } from "./projection.ts";

// ── Test fixtures ────────────────────────────────────────────────────────

const ORG_ID = "org-acme";

interface Project {
  id: string;
  name: string;
}

const PROJECTS: Project[] = [
  { id: "proj-q4-analytics", name: "Q4 Analytics" },
  { id: "proj-q3-sales", name: "Q3 Sales" },
  { id: "proj-revops", name: "RevOps" },
  { id: "proj-data-eng", name: "Data Engineering" },
];

const projectSelectedEvent = (project: Project, seq: number): FlowEvent => ({
  ts: `2026-05-15T22:${String(seq).padStart(2, "0")}:00.000Z`,
  type: "project_selected",
  payload: { org_id: ORG_ID, project },
  correlation_id: `corr-${seq}`,
});

const projectContextInheritedEvent = (
  project: Project,
  seq: number,
): FlowEvent => ({
  ts: `2026-05-15T22:${String(seq).padStart(2, "0")}:00.000Z`,
  type: "project_context_inherited",
  payload: {
    org_id: ORG_ID,
    project_id: project.id,
    project_name: project.name,
  },
  correlation_id: `corr-${seq}`,
});

// ── Seeded PRNG (mulberry32) — reproducible without a fast-check dep ─────

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// ── Sequence generator ───────────────────────────────────────────────────
//
// Mirrors the production wire chain:
//   1. project-context picks (or switches to) a project → emits `project_selected`.
//   2. orchestrator re-broadcasts `project_ready` to session-chat → session-chat's
//      log appends `project_context_inherited` with the SAME (id, name) tuple.
//   3. user may switch again — repeat. Mid-switch a `project_context_inherited`
//      always trails the most-recent `project_selected`.
//
// The generator interleaves the two events under this constraint. Optional
// gap: a `project_selected` may not yet have a trailing `project_context_inherited`
// (this is the bootstrap-window case the property explicitly tolerates).

function generateSequence(
  rng: () => number,
  length: number,
): { events: FlowEvent[]; settlePoints: number[] } {
  const events: FlowEvent[] = [];
  const settlePoints: number[] = [];
  let mostRecentSelection: Project | null = null;
  let inheritedMatchesSelection = false;

  for (let step = 0; step < length; step += 1) {
    const pickProjectSelected =
      !mostRecentSelection || rng() < 0.55; // bias toward eventually switching
    const seq = events.length + 1;
    if (pickProjectSelected) {
      const next = PROJECTS[Math.floor(rng() * PROJECTS.length)] ?? PROJECTS[0];
      events.push(projectSelectedEvent(next, seq));
      mostRecentSelection = next;
      inheritedMatchesSelection = false;
    } else {
      if (!mostRecentSelection) continue;
      events.push(projectContextInheritedEvent(mostRecentSelection, seq));
      inheritedMatchesSelection = true;
    }
    if (mostRecentSelection && inheritedMatchesSelection) {
      // Settled tick: both fields have been populated for this project and
      // the most-recent broadcast matches the most-recent selection.
      settlePoints.push(events.length);
    }
  }

  return { events, settlePoints };
}

// ── Property assertion ───────────────────────────────────────────────────
//
// The invariant under test:
//
//   At every settle point in a sequence, the project-context view of project
//   state and the session-chat view of project state agree.
//
// Pre-collapse this means:
//   context.project.id   === context.session_chat_project_id
//   context.project.name === context.session_chat_project_name
//
// Post-collapse (after the field collapse lands) the legacy fields are gone
// — `'session_chat_project_id' in context` returns false — and the
// assertion narrows to: context.project.id matches the latest broadcast
// payload. The `in`-guarded shape below survives the collapse without edit.

interface AgreementContext {
  project: { id: string | null; name: string | null };
  session_chat_project_id?: string | null;
  session_chat_project_name?: string | null;
}

function assertProjectStateAgreement(
  events: FlowEvent[],
  settlePoints: number[],
  expectedFinal: Project,
): void {
  // Replay the full sequence in one buildProjection call. The dispatch
  // table is total over event types, so replaying mixed events through one
  // projection mirrors how the public projection shape would be observed
  // if a single consumer subscribed to both flow logs.
  const projection = buildProjection("test-flow:property", events);
  const ctx = projection.context as AgreementContext;

  // Invariant for the *final* settled state: project.{id,name} matches the
  // expected most-recent selection (and, pre-collapse, agrees with the
  // session-chat copy of the same fields).
  expect(ctx.project.id).toBe(expectedFinal.id);
  expect(ctx.project.name).toBe(expectedFinal.name);
  if ("session_chat_project_id" in ctx) {
    expect(ctx.session_chat_project_id).toBe(expectedFinal.id);
  }
  if ("session_chat_project_name" in ctx) {
    expect(ctx.session_chat_project_name).toBe(expectedFinal.name);
  }

  // Invariant for every intermediate settle point: agreement holds whenever
  // both fields are non-null (pre-collapse). Replays the prefix of events
  // up to each settle point and asserts. Post-collapse the second clause is
  // a no-op (the legacy field is `undefined`, so the conjunction is false).
  for (const settleAt of settlePoints) {
    const prefix = events.slice(0, settleAt);
    const p = buildProjection("test-flow:property", prefix);
    const c = p.context as AgreementContext;
    if (c.project.id !== null && c.session_chat_project_id != null) {
      expect(c.project.id).toBe(c.session_chat_project_id);
      expect(c.project.name).toBe(c.session_chat_project_name);
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("project-state agreement invariant (audit §9 Q3)", () => {
  // Named scenarios — load-bearing edge cases.

  it("settles to project A after project_selected(A) + project_context_inherited(A)", () => {
    const a = PROJECTS[0];
    const events: FlowEvent[] = [
      projectSelectedEvent(a, 1),
      projectContextInheritedEvent(a, 2),
    ];
    assertProjectStateAgreement(events, [2], a);
  });

  it("agrees after a single mid-flow project switch (A → B with matching broadcast)", () => {
    const [a, b] = PROJECTS;
    const events: FlowEvent[] = [
      projectSelectedEvent(a, 1),
      projectContextInheritedEvent(a, 2),
      projectSelectedEvent(b, 3),
      projectContextInheritedEvent(b, 4),
    ];
    assertProjectStateAgreement(events, [2, 4], b);
  });

  it("agrees after a deep switch chain (A → B → C → D)", () => {
    const events: FlowEvent[] = [];
    let seq = 1;
    PROJECTS.forEach((p) => {
      events.push(projectSelectedEvent(p, seq++));
      events.push(projectContextInheritedEvent(p, seq++));
    });
    const settlePoints = [2, 4, 6, 8];
    assertProjectStateAgreement(events, settlePoints, PROJECTS[3]);
  });

  it("bootstrap window: project.id set but session_chat_project_id null is tolerated", () => {
    // Only project_selected — no corresponding project_context_inherited.
    // Pre-collapse, project.id is set and session_chat_project_id is null.
    // The property allows this transient (no settle point asserted).
    const a = PROJECTS[0];
    const projection = buildProjection("test-flow:property", [
      projectSelectedEvent(a, 1),
    ]);
    const ctx = projection.context as AgreementContext;
    expect(ctx.project.id).toBe(a.id);
    if ("session_chat_project_id" in ctx) {
      expect(ctx.session_chat_project_id).toBeNull();
    }
  });

  it("session-chat-only bootstrap: project_context_inherited without a prior project_selected", () => {
    // In production this happens when session-chat is rehydrated from
    // Redis before project-context's log has been read into projection.
    // Pre-collapse: session_chat_project_id is set; project.id is null.
    // Post-collapse: project.id is set directly by project_context_inherited.
    const a = PROJECTS[0];
    const projection = buildProjection("test-flow:property", [
      projectContextInheritedEvent(a, 1),
    ]);
    const ctx = projection.context as AgreementContext;
    if ("session_chat_project_id" in ctx) {
      expect(ctx.session_chat_project_id).toBe(a.id);
      expect(ctx.project.id).toBeNull();
    } else {
      // Post-collapse: project_context_inherited writes project.{id,name}.
      expect(ctx.project.id).toBe(a.id);
      expect(ctx.project.name).toBe(a.name);
    }
  });

  // Randomized sweep — 30 sequences over a seeded PRNG. Reproducible failure
  // by re-running with the same SEEDS list.

  const SEEDS = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53,
    59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109];

  SEEDS.forEach((seed) => {
    it(`randomized sequence (seed=${seed}) maintains agreement across switches`, () => {
      const rng = makeRng(seed);
      const length = 6 + Math.floor(rng() * 12); // 6..17 events
      const { events, settlePoints } = generateSequence(rng, length);
      if (settlePoints.length === 0) {
        // Degenerate run produced no settled tick; assertion is vacuous.
        // The other scenarios cover the settled cases.
        return;
      }
      // Determine the expected final project from the last settle.
      const lastSettle = settlePoints[settlePoints.length - 1];
      const lastSettleEvents = events.slice(0, lastSettle);
      const lastSelection = [...lastSettleEvents]
        .reverse()
        .find((e) => e.type === "project_selected");
      expect(lastSelection).toBeDefined();
      const expectedFinal = (lastSelection!.payload as { project: Project })
        .project;
      // Slice the events to the last settle point so the final-state
      // assertion is against a settled tick (not a trailing unmatched
      // project_selected).
      assertProjectStateAgreement(
        lastSettleEvents,
        settlePoints,
        expectedFinal,
      );
    });
  });
});
