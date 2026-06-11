// The closed wire vocabulary the StateProxy may `.send` to `POST /state/events`
// (ADR-046 Decision 3) — the SINGLE SOURCE OF TRUTH for the event union, shared
// by the proxy (frontend) and the origin (ui-state).
//
// `POST /state/events` accepts ONE event of this shape and maps it to the parent
// ChatApp actor's event union via the same `forwardToActor` logic the live
// router uses (`switching_project_intent` → PROJECT_SWITCH; everything else →
// `child_event` forwarded to the active region's child).
//
// CLOSED UNION (ADR-050 §e; ADR-049 §4): the union is genuinely closed — there is
// NO trailing `{ type: string; ... }` catch-all. Every member is named, so the
// ui-state router's Zod ACL (03-04) is a closed `z.ZodType<ChatAppWireEvent>`
// that 400s any unmodeled `type`. The closedness is the side-effect of the
// crash-class routing model (ADR-049 §4): the client narrates a finite vocabulary
// of past-tense outcomes + UI intents, never an open-ended event bag.
//
// Plain serializable types only — NO machine internals.
//
// References:
//   docs/decisions/adr-046-*.md — Decision 3 (the event surface)
//   docs/decisions/adr-049-*.md — §4 (closed union ← crash-class routing)
//   docs/decisions/adr-050-*.md — §e (closed wire vocabulary + cause enums)
//   ui-state/lib/machines/chat-app/router.ts — buildStateRouter (POST /state/events, forwardToActor)

import type { ResourceType } from "./state-document.ts";

/** The {id,name} display snapshot a client-reported org-outcome carries
 *  (ADR-050 §e.1). The client probes the org SSOT, then narrates the {id,name}
 *  it observed — never machine internals. */
export type OrgSnapshot = { id: string; name: string };

/** The {id,name} display snapshot a client-reported project-outcome carries
 *  (ADR-050 §e.1). */
export type ProjectSnapshot = { id: string; name: string };

// ───────────────────────────── failure-class cause enums (ADR-050 §c) ─────────────────────────────
// The wire-contract SSOT for the failure-class causes. Defined HERE in shared
// (shared cannot import ui-state); ui-state's machine-local copies carry the
// identical string literals (string-literal unions with equal members are
// assignable), and 03-04's router imports THESE for its closed Zod ACL.

/** Why a client-reported org-create outcome failed (ADR-050 §c). */
export type OrgCreateFailureCause =
  | "org_name_taken"
  | "org_name_invalid"
  | "org_create_failed";

/** Why a client-reported project-create outcome failed (ADR-050 §c). */
export type ProjectCreateFailureCause = "project_create_failed";

/** Why a client-reported scope resolution mismatched the requesting tenant
 *  (ADR-050 §c). */
export type ScopeMismatchCause =
  | "cross_tenant"
  | "project_not_found"
  | "access_revoked";

export type ChatAppWireEvent =
  // ── client-reported onboarding outcomes (ADR-049/050) — the client probes the
  //    org SSOT and narrates the past-tense result; ui-state transitions on the
  //    report (it has zero egress). Validated server-side while onboarding is the
  //    active phase (Decision 3 ACL: well-formedness only).
  | { type: "org_found"; payload: { org: OrgSnapshot } }
  | { type: "org_not_found"; payload: Record<string, never> }
  | { type: "org_created"; payload: { org: OrgSnapshot } }
  // ── client-reported project-context outcomes (ADR-049/050; settled by CDO-S2) ──
  | { type: "scope_resolved"; payload: { project: ProjectSnapshot } }
  | { type: "no_projects_found"; payload: Record<string, never> }
  | { type: "project_created"; payload: { project: ProjectSnapshot } }
  // onboarding closed vocabulary (validated server-side while onboarding is the
  // active phase; unmodeled type → HTTP 400 — see Decision 3 ACL). LEGACY: the
  // org-form submit retires in a later CDO slice (closure CDO-S3/S5); kept here
  // so out-of-scope frontend/ + ui/ + acceptance consumers still type-check.
  | { type: "org_form_submitted"; payload: { org_name: string } }
  // default-project creation (project-context vocabulary — legal only once the
  // phase has ADVANCED past onboarding; forwarded verbatim as child_event).
  // UI-1 QUIRK: `org_name` carries the PROJECT name — a historical machine-side
  // misnomer. The ui-state router posts child_event:{type,payload}, the parent
  // SPREADS payload to top level (forwardChildEventToActiveChild in
  // ui-state/lib/machines/chat-app/setup/actions.ts), and project-context's
  // capturePendingProjectName + projectNameValid guard read event.org_name.
  // Type-only seam fix making the contract explicit and type-checked at the ui/
  // post site — NO ui-state runtime change. See
  // docs/feature/org-onboarding/distill/upstream-issues.md (UI-1).
  | { type: "create_project_submitted"; payload: { org_name: string } }
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
  // ── client-reported failure/outcome members (ADR-050 §c/§e) — the client
  //    narrates the past-tense failure it observed; ui-state transitions on the
  //    report. The cause enum is the wire SSOT (defined above). ──
  | {
      type: "org_create_failed";
      payload: { cause: OrgCreateFailureCause; org_name?: string };
    }
  | {
      type: "project_create_failed";
      payload: { cause: ProjectCreateFailureCause };
    }
  | { type: "scope_mismatch"; payload: { cause: ScopeMismatchCause } }
  | { type: "project_switched"; payload: { project: ProjectSnapshot } }
  // ── surviving session-chat UI intents — the chat phase still delivers these
  //    as today; named here so 03-04's closed Zod ACL can NAME them. ──
  | { type: "session_clicked"; payload: { session_id: string } }
  | { type: "new_session_clicked" }
  | { type: "first_message_sent"; payload: { content: string } }
  | { type: "refresh_session_list" }
  | {
      type: "dataset_resolved_by_agent";
      payload: { resource_id: string; resource_type: ResourceType };
    }
  | {
      type: "dataset_picked_directly";
      payload: { resource_id: string; resource_type: ResourceType };
    }
  | { type: "suggestion_chip_clicked_upload" }
  | { type: "suggestion_chip_clicked_browse_projects" };
