// LEAF-5 — THE EQUIVALENCE GATE. SettledStateStore byte-equivalence vs the
// legacy buildProjection(eventLog.read() ++ [terminalEvent]) path.
//
// ============================================================================
// THIS IS THE BINDING ARTIFACT ADR-040's Consequences MANDATES, and the
// highest-value artifact of this DISTILL pass. It converts the LEAF-5 hard
// swap's "no parity safety net" from aspirational prose into a falsifiable,
// mechanically verifiable gate. Read ADR-040 Consequences > "LEAF-5
// equivalence gate (binding)" — it is reproduced in the contract below.
// ============================================================================
//
// DISTILL-authored. DELIVER-deferred: `describe.skip` until LEAF-5.
//
// Behavior-neutrality: LEAF-5 is the ONE BEHAVIOR-CHANGING LEAF (driven
// read-port source swap: event-log -> SettledStateStore). The OBSERVABLE
// surface — the GET /projection payload — MUST remain BYTE-IDENTICAL. This
// gate is exactly the proof of that.
//
// BINDING AUTHORING + RUN ORDER (ADR-040 Consequences, verbatim intent):
//   1. This spec is authored FIRST, in its OWN commit, BEFORE the read-port
//      swap (roadmap.json LEAF-5.red_prerequisite.commit_sequence Commit A).
//   2. It is run against the LEGACY buildProjection path FIRST to establish
//      the baseline — it goes GREEN against legacy = baseline locked.
//   3. It THEN becomes the regression gate the LEAF-5 swap MR (Commit B)
//      MUST pass. LEAF-5 cannot submit until it is green post-swap.
//   4. SINGLE HARD SWAP — NOT decomposed into 5a/5b/5c (binding overseer
//      decision, see handoff-distill-to-deliver.md). This gate IS the
//      safety net that replaced the rejected dual-read parity window.
//
// Binding source:
//   ADR-040 §D3 (hybrid store model = the tripwire exit; the per-flow
//     settled-state record becomes the SSOT; GET .../projection resolves to
//     store.get(flow_id); the Redis-Streams FlowEventLog + buildProjection
//     rebuild path is REMOVED; harvestSettled* family becomes dead code,
//     deleted same MR),
//   ADR-040 Consequences "LEAF-5 equivalence gate (binding)",
//   ADR-030 §"Amendment 2026-05-16 — Emission-completeness tripwire" +
//     "Pre-costed alternative" (the store model; machines + FREEZE/THAW
//     untouched),
//   ADR-027 §1 + §4 (FE projection read contract + FlowProjection wire
//     format — the byte surface that must not move),
//   ADR-028 §"Amendment 2026-05-15" (snapshot is internal handler state;
//     the harvestSettled* family — orchestrator-harvester.ts — exists only
//     to feed the projection-of-log and is dead by construction here).

import { describe, it } from "vitest";

import { buildProjection, type FlowEvent } from "../projection.ts";

// ---------------------------------------------------------------------------
// Deterministic fixture primitives. ts AND correlation_id are PINNED so the
// byte comparison JSON.stringify(a) === JSON.stringify(b) is exact and
// stable — last_event_at and correlation_id are part of the FlowProjection
// wire format (ADR-027 §4) and the store MUST reproduce them identically.
// ---------------------------------------------------------------------------
const TS = "2026-05-16T12:00:00.000Z";
const CORR = "corr-leaf5-fixed";

const ev = (
  type: string,
  payload: Record<string, unknown> = {},
  correlation_id: string = CORR,
): FlowEvent => ({ ts: TS, type, payload, correlation_id });

// A J-002 state-history fixture: the FlowEvent log that precedes the
// terminal settle, the terminal event the orchestrator emits on settle,
// the legacy harvest source the terminal payload was sourced from
// (orchestrator-harvester.ts — deleted at LEAF-5), and the settled state
// the projection reducer must land in. `store.set(flow_id, settledState)`
// then `store.get(flow_id)` MUST be byte-equivalent to
// `buildProjection(flow_id, eventLog ++ [terminalEvent])`.
interface StateHistory {
  id: string;
  category:
    | "begin"
    | "project_select"
    | "session_resume"
    | "session_list"
    | "dataset_switch"
    | "freeze_thaw"
    | "cross_machine_settle_race"
    | "error_arm";
  story: string;
  flowId: string;
  eventLog: FlowEvent[];
  terminalEvent: FlowEvent;
  legacyHarvestSource:
    | "harvestSettledProjectContextState"
    | "harvestSettledSessionChatState"
    | "harvestSettledFreezeState"
    | "harvestSettledLoginState"
    | "none";
  expectedSettledState: string;
}

const P_FLOW = "project-context:dev-user-001";
const S_FLOW = "session-chat:dev-user-001";

// ===========================================================================
// THE EXHAUSTIVE J-002 STATE-HISTORY CATALOGUE.
// Every category ADR-040 names — begin, project_select, session_resume,
// dataset_switch (US-209), freeze/thaw (US-210), the cross-machine settle
// race — plus every error arm the legacy harvest sourced (scope_mismatch,
// project_not_found, access_revoked, dataset_access_denied, transient
// error_recoverable, degraded). Event names follow the J-002 projection
// EVENT_HANDLERS vocabulary; DELIVER reconciles any ADR-039 _settled
// rename (no_projects_displayed -> no_projects_settled, etc.) against the
// live reducer keys at LEAF-5 time — the BYTE-EQUIVALENCE assertion is
// invariant under whatever names the legacy reducer actually uses, because
// both sides of the comparison run the SAME projection shape.
// ===========================================================================
const STATE_HISTORIES: StateHistory[] = [
  // ---- begin (US-201 / US-202) ------------------------------------------
  {
    id: "begin/no-projects-empty-state",
    category: "begin",
    story: "US-201 first sign-in, zero projects",
    flowId: P_FLOW,
    eventLog: [ev("j002_resolution_started")],
    terminalEvent: ev("no_projects_displayed", { org_id: "dev-org-001" }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "no_projects_empty_state",
  },
  {
    id: "begin/last-used-project-selected",
    category: "begin",
    story: "US-202 returning user resolves to last-used project",
    flowId: P_FLOW,
    eventLog: [ev("j002_resolution_started")],
    terminalEvent: ev("project_selected", {
      org_id: "dev-org-001",
      project: { id: "proj-1", name: "Acme" },
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "project_selected",
  },
  {
    id: "begin/last-used-resolution-degraded",
    category: "error_arm",
    story: "US-202 transient list-sessions failure during last-used resolution",
    flowId: P_FLOW,
    eventLog: [ev("j002_resolution_started")],
    terminalEvent: ev("last_used_resolution_degraded", {
      underlying_cause_tag: "transient",
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "project_selected",
  },

  // ---- project_select (US-201 create / US-204 deep-link / US-207 switch) -
  {
    id: "project_select/create-first-project",
    category: "project_select",
    story: "US-201 create first project -> project_selected",
    flowId: P_FLOW,
    eventLog: [
      ev("j002_resolution_started"),
      ev("no_projects_displayed", { org_id: "dev-org-001" }),
      ev("create_project_submitted", { name: "Acme" }),
    ],
    terminalEvent: ev("project_created", {
      org_id: "dev-org-001",
      project: { id: "proj-new", name: "Acme" },
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "project_selected",
  },
  {
    id: "project_select/cold-deep-link-resolve",
    category: "project_select",
    story: "US-204 cold deep-link resolves active scope before paint",
    flowId: P_FLOW,
    eventLog: [
      ev("j002_resolution_started"),
      ev("deep_link_opened", { intent_project_id: "proj-7" }),
    ],
    terminalEvent: ev("project_selected", {
      org_id: "dev-org-001",
      project: { id: "proj-7", name: "Deep" },
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "project_selected",
  },
  {
    id: "project_select/cross-tenant-scope-mismatch-terminal",
    category: "error_arm",
    story: "US-204 cross-tenant deep-link -> scope_mismatch_terminal",
    flowId: P_FLOW,
    eventLog: [
      ev("j002_resolution_started"),
      ev("deep_link_opened", { intent_project_id: "proj-other-org" }),
    ],
    terminalEvent: ev("scope_mismatch_displayed", {
      underlying_cause_tag: "scope_mismatch",
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "scope_mismatch_terminal",
  },
  {
    id: "project_select/deep-link-deleted-project-not-found",
    category: "error_arm",
    story: "US-204 deep-link to deleted project -> project_not_found cause",
    flowId: P_FLOW,
    eventLog: [
      ev("j002_resolution_started"),
      ev("deep_link_opened", { intent_project_id: "proj-deleted" }),
    ],
    terminalEvent: ev("scope_mismatch_displayed", {
      underlying_cause_tag: "project_not_found",
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "scope_mismatch_terminal",
  },
  {
    id: "project_select/atomic-switch-project-switched",
    category: "project_select",
    story: "US-207 atomic project switch (D-MR4-06 emission-completeness class)",
    flowId: P_FLOW,
    eventLog: [
      ev("project_selected", {
        org_id: "dev-org-001",
        project: { id: "proj-1", name: "Acme" },
      }),
      ev("switching_project_started", { target_project_id: "proj-2" }),
    ],
    terminalEvent: ev("project_switched", {
      org_id: "dev-org-001",
      project: { id: "proj-2", name: "Beta" },
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "project_selected",
  },
  {
    id: "project_select/switch-access-revoked",
    category: "error_arm",
    story: "US-207 switch to access-revoked project -> named diagnostic",
    flowId: P_FLOW,
    eventLog: [
      ev("project_selected", {
        org_id: "dev-org-001",
        project: { id: "proj-1", name: "Acme" },
      }),
      ev("switching_project_started", { target_project_id: "proj-x" }),
    ],
    terminalEvent: ev("project_switched", {
      underlying_cause_tag: "access_revoked",
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "error_recoverable",
  },

  // ---- session_resume (US-205) / session_list (US-203) ------------------
  {
    id: "session_resume/restore-transcript-and-dataset",
    category: "session_resume",
    story: "US-205 resume restores transcript + dataset atomically (IC-J002-3)",
    flowId: S_FLOW,
    eventLog: [
      ev("session_list_load_started"),
      ev("session_list_loaded", { count: 3 }),
      ev("session_resume_started", { session_id: "sess-1" }),
    ],
    terminalEvent: ev("session_resumed", {
      session_id: "sess-1",
      transcript: [{ id: "m1", role: "user", content: "hi", ts: TS }],
      resource: { type: "dataset", id: "ds-1" },
    }),
    legacyHarvestSource: "harvestSettledSessionChatState",
    expectedSettledState: "session_active",
  },
  {
    id: "session_resume/deleted-dataset-degrades-to-conversational",
    category: "error_arm",
    story: "US-205 resume with deleted dataset degrades gracefully",
    flowId: S_FLOW,
    eventLog: [
      ev("session_list_load_started"),
      ev("session_list_loaded", { count: 1 }),
      ev("session_resume_started", { session_id: "sess-2" }),
    ],
    terminalEvent: ev("session_dataset_unavailable", {
      session_id: "sess-2",
      transcript: [],
      resource: { type: null, id: null },
      underlying_cause_tag: "dataset_not_found",
    }),
    legacyHarvestSource: "harvestSettledSessionChatState",
    expectedSettledState: "session_active",
  },
  {
    id: "session_list/zero-sessions-empty-state-sub-shape",
    category: "session_list",
    story: "US-203 zero-sessions project enters no_sessions empty-state sub-shape",
    flowId: S_FLOW,
    eventLog: [ev("session_list_load_started")],
    terminalEvent: ev("session_list_displayed", { count: 0 }),
    legacyHarvestSource: "none",
    expectedSettledState: "session_list_loaded",
  },
  {
    id: "session_list/session-welcome-lazy-no-write",
    category: "session_list",
    story: "US-206 new-session welcome (lazy; no backend write)",
    flowId: S_FLOW,
    eventLog: [
      ev("session_list_load_started"),
      ev("session_list_displayed", { count: 2 }),
    ],
    terminalEvent: ev("session_welcome_displayed", {}),
    legacyHarvestSource: "harvestSettledSessionChatState",
    expectedSettledState: "session_welcome",
  },

  // ---- dataset_switch (US-209, D-MR5-01 emission-completeness class) -----
  {
    id: "dataset_switch/agent-resolve-then-attach",
    category: "dataset_switch",
    story: "US-209 agent-resolved dataset attaches and persists",
    flowId: S_FLOW,
    eventLog: [
      ev("session_resumed", {
        session_id: "sess-1",
        transcript: [],
        resource: { type: null, id: null },
      }),
      ev("switching_dataset_context_started", { resource_id: "ds-9" }),
    ],
    terminalEvent: ev("dataset_attached", {
      resource: { type: "dataset", id: "ds-9" },
    }),
    legacyHarvestSource: "harvestSettledSessionChatState",
    expectedSettledState: "session_active",
  },
  {
    id: "dataset_switch/direct-pick-then-attach",
    category: "dataset_switch",
    story: "US-209 direct dataset selection updates active scope and persists",
    flowId: S_FLOW,
    eventLog: [
      ev("session_resumed", {
        session_id: "sess-1",
        transcript: [],
        resource: { type: "dataset", id: "ds-1" },
      }),
      ev("switching_dataset_context_started", { resource_id: "ds-2" }),
    ],
    terminalEvent: ev("dataset_attached", {
      resource: { type: "dataset", id: "ds-2" },
    }),
    legacyHarvestSource: "harvestSettledSessionChatState",
    expectedSettledState: "session_active",
  },
  {
    id: "dataset_switch/cross-tenant-denied-prior-scope-preserved",
    category: "error_arm",
    story: "US-209 cross-tenant dataset pick rejected; prior scope preserved",
    flowId: S_FLOW,
    eventLog: [
      ev("session_resumed", {
        session_id: "sess-1",
        transcript: [],
        resource: { type: "dataset", id: "ds-1" },
      }),
      ev("switching_dataset_context_started", { resource_id: "ds-other-org" }),
    ],
    terminalEvent: ev("dataset_access_denied", {
      underlying_cause_tag: "dataset_access_denied",
      resource: { type: "dataset", id: "ds-1" },
    }),
    legacyHarvestSource: "harvestSettledSessionChatState",
    expectedSettledState: "session_active",
  },

  // ---- freeze / thaw (US-210) ------------------------------------------
  {
    id: "freeze_thaw/expiry-during-resume-replays-after-thaw",
    category: "freeze_thaw",
    story: "US-210 token expiry during session resume pauses + replays",
    flowId: S_FLOW,
    eventLog: [
      ev("session_resume_started", { session_id: "sess-1" }),
      ev("j002_frozen", {
        last_live_state: "resuming_session",
        pending_resume_session_id: "sess-1",
      }),
    ],
    terminalEvent: ev("j002_thawed", {
      last_live_state: "resuming_session",
      correlation_id: CORR,
    }),
    legacyHarvestSource: "harvestSettledFreezeState",
    expectedSettledState: "resuming_session",
  },
  {
    id: "freeze_thaw/fifo-replay-with-stale-drop",
    category: "freeze_thaw",
    story:
      "US-210 multiple intents queued during freeze replay FIFO with stale-drop (Praxis F-4)",
    flowId: S_FLOW,
    eventLog: [
      ev("session_resumed", {
        session_id: "sess-1",
        transcript: [],
        resource: { type: "dataset", id: "ds-1" },
      }),
      ev("j002_frozen", { last_live_state: "session_active" }),
    ],
    terminalEvent: ev("stale_intent_dropped_after_thaw", {
      stale_intents_dropped_count: 1,
      last_stale_intent: { intent_type: "dataset_picked_directly", target_id: "ds-2" },
    }),
    legacyHarvestSource: "harvestSettledFreezeState",
    expectedSettledState: "session_active",
  },
  {
    id: "freeze_thaw/replay-buffer-timeout-abandoned",
    category: "error_arm",
    story: "US-210 5s replay-buffer timeout -> error_recoverable, action preserved",
    flowId: S_FLOW,
    eventLog: [
      ev("session_resume_started", { session_id: "sess-1" }),
      ev("j002_frozen", {
        last_live_state: "resuming_session",
        pending_resume_session_id: "sess-1",
      }),
    ],
    terminalEvent: ev("replay_abandoned", {
      underlying_cause_tag: "replay_timeout",
      pending_resume_session_id: "sess-1",
    }),
    legacyHarvestSource: "harvestSettledFreezeState",
    expectedSettledState: "error_recoverable",
  },

  // ---- cross-machine settle race ---------------------------------------
  // The emission-completeness failure class (D-MR4-06; D-MR5-01 x2; MR-6
  // freeze). Project-context settle and session-chat settle interleaved:
  // the store eliminates the staleness by construction (ADR-040 D3). The
  // gate asserts the store projection is byte-equivalent to the legacy
  // buildProjection over the interleaved log + terminal events for BOTH
  // flow_ids — i.e. neither flow's projection goes stale.
  {
    id: "cross_machine_settle_race/project-and-session-interleaved",
    category: "cross_machine_settle_race",
    story:
      "project-context settle + session-chat settle race (the D-MR4-06 / D-MR5-01 class)",
    flowId: P_FLOW,
    eventLog: [
      ev("project_selected", {
        org_id: "dev-org-001",
        project: { id: "proj-1", name: "Acme" },
      }),
      ev("switching_project_started", { target_project_id: "proj-2" }),
    ],
    terminalEvent: ev("project_switched", {
      org_id: "dev-org-001",
      project: { id: "proj-2", name: "Beta" },
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "project_selected",
  },

  // ---- generic transient error_recoverable (composer preserved) --------
  {
    id: "error_arm/transient-create-project-failure-composer-preserved",
    category: "error_arm",
    story: "US-201 transient create-project failure -> error_recoverable, pending_ preserved",
    flowId: P_FLOW,
    eventLog: [
      ev("j002_resolution_started"),
      ev("no_projects_displayed", { org_id: "dev-org-001" }),
      ev("create_project_submitted", { name: "Acme" }),
    ],
    terminalEvent: ev("project_created", {
      underlying_cause_tag: "transient",
      pending_project_name: "Acme",
    }),
    legacyHarvestSource: "harvestSettledProjectContextState",
    expectedSettledState: "error_recoverable",
  },
];

describe.skip("LEAF-5 SettledStateStore byte-equivalence gate — DELIVER-deferred to LEAF-5", () => {
  it("the catalogue covers every ADR-040-named category exhaustively", () => {
    // DELIVER LEAF-5 (assertable now in shape; kept skipped for the
    // green-by-skip DISTILL contract): every category ADR-040 Consequences
    // names is present in STATE_HISTORIES — begin, project_select,
    // session_resume, session_list, dataset_switch, freeze_thaw,
    // cross_machine_settle_race, plus the error arms (scope_mismatch /
    // project_not_found / access_revoked / dataset_access_denied /
    // transient / degraded). DELIVER asserts:
    //   new Set(STATE_HISTORIES.map(h => h.category)) ⊇ the 8 categories.
    void STATE_HISTORIES;
    void buildProjection;
  });

  for (const h of STATE_HISTORIES) {
    it(`byte-equivalent: store.get == buildProjection(log ++ terminal) — ${h.id}`, () => {
      // DELIVER LEAF-5 BINDING ASSERTION (the gate), per history `h`:
      //
      //   const fullLog = h.eventLog.concat([h.terminalEvent]);
      //   const legacy  = buildProjection(h.flowId, fullLog);
      //   // settledState is what the orchestrator computes at settle and
      //   // hands the store (the value the legacy harvestSettled* family
      //   // — h.legacyHarvestSource — used to source the terminal payload).
      //   store.set(h.flowId, settledStateFor(h));
      //   const fromStore = store.get(h.flowId);
      //
      //   expect(JSON.stringify(fromStore)).toBe(JSON.stringify(legacy));
      //
      // Byte-exact over the FULL FlowProjection wire shape (ADR-027 §4):
      // state, context (ALL h.legacyHarvestSource-sourced fields),
      // active_scope, sequence_id, last_event_at, correlation_id. ts +
      // correlation_id are pinned in the fixtures so the comparison is
      // byte-stable. expectedSettledState (h.expectedSettledState) is the
      // projection.state both sides MUST agree on.
      //
      // RUN-ORDER (binding): this assertion is FIRST satisfied against the
      // LEGACY buildProjection path (Commit A: settledStateFor derived from
      // the legacy harvest) to lock the baseline, THEN re-run unchanged
      // after the swap (Commit B: settledStateFor produced by the new
      // settle->store.set path). Same assertion, both sides — that is the
      // safety net replacing the rejected dual-read window.
      void h;
    });
  }

  it("set idempotence: store.set applied N times == applied once (byte-identical)", () => {
    // DELIVER LEAF-5: for every history h:
    //   store.set(h.flowId, s); const once  = store.get(h.flowId);
    //   store.set(h.flowId, s); store.set(h.flowId, s);
    //   const thrice = store.get(h.flowId);
    //   expect(JSON.stringify(thrice)).toBe(JSON.stringify(once));
    // (ADR-040 Consequences: "Idempotence of `set` is asserted in the same
    // test.") A non-idempotent set would silently corrupt the SSOT under
    // the hard swap with no event-log to reconcile against.
  });

  it("harvestSettled* + buildProjection event-log path are deleted in the swap MR", () => {
    // DELIVER LEAF-5 (Commit B): assert ui-state/lib/orchestrator-harvester.ts
    // is deleted and buildProjection's eventLog.read() path is removed
    // (dead by construction per ADR-040 D3 — with no rebuilt projection
    // there is nothing to harvest for). The emission-completeness invariant
    // ceases to exist; this is the structural payoff the gate protects.
  });

  it("observable surface unchanged: full mr_1..mr_6 per-marker green end-to-end", () => {
    // DELIVER LEAF-5 = RG-LEAF. The GET /projection payload through
    // auth-proxy /ui-state/* MUST be byte-identical end-to-end: the J-002
    // acceptance suite stays green PER-MARKER (D-MR5-02 ordering hazard —
    // never the whole directory at once), baseline mr_4 14/0/0 · mr_5 7/0 ·
    // mr_6 8/0. ui-state vitest green; eslint 0 errors.
  });
});
