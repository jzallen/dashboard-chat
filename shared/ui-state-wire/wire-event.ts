// The closed wire vocabulary the StateProxy may `.send` to `POST /state/events`
// (ADR-046 Decision 3) — the SINGLE SOURCE OF TRUTH for the event union, shared
// by the proxy (frontend) and the origin (ui-state).
//
// `POST /state/events` accepts ONE event of this shape and maps it to the parent
// ChatApp actor's event union via the same `forwardToActor` logic the live
// router uses (`switching_project_intent` → PROJECT_SWITCH; everything else →
// `child_event` forwarded to the active region's child). The named members below
// document the meaningful vocabulary; the trailing catch-all keeps the surface
// total (XState ignores events the active child doesn't model — research
// Finding 4).
//
// Plain serializable types only — NO machine internals.
//
// References:
//   docs/decisions/adr-046-*.md — Decision 3 (the event surface)
//   ui-state/lib/machines/chat-app/router.ts — buildStateRouter (POST /state/events, forwardToActor)

export type ChatAppWireEvent =
  // onboarding closed vocabulary (validated server-side while onboarding is the
  // active phase; unmodeled type → HTTP 400 — see Decision 3 ACL)
  | { type: "org_form_submitted"; payload: { org_name: string } }
  // failure-simulation side-channel (gate-authorized; env-gated knob)
  | { type: "__force_failure__"; payload: { tag: string } }
  // project switch — maps to the parent's PROJECT_SWITCH (reaches project-context
  // even while chat is the active child)
  | { type: "switching_project_intent"; payload: { new_project_id: string } }
  // deep link — was POST /open-deep-link; now an ordinary event (route collapsed)
  | {
      type: "open_deep_link";
      payload: {
        intent_project_id?: string;
        intent_session_id?: string;
        intent_resource_id?: string;
        intent_resource_type?: string;
      };
    }
  // restart — was POST /begin force-restart; now a reserved event (route collapsed)
  | { type: "session_begin"; payload?: { force_restart?: boolean } }
  // everything else — forwarded verbatim as child_event to the active region's child
  | { type: string; payload?: Record<string, unknown> };
