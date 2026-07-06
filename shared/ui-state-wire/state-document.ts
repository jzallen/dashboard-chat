// The ui-state `/state` wire contract — the SINGLE SOURCE OF TRUTH for the one
// `ChatAppStateDocument` the StateProxy surface publishes (ADR-046 Decision 1,
// option 1B + Decision 2 placement 2-i).
//
// This module is imported by BOTH sides of the wire:
//   - ui-state (the ORIGIN) — `deriveStateDocument` emits exactly this shape.
//   - frontend (the PROXY)  — `createStateProxy` caches + slices exactly this
//                             shape via `useSelector`.
//
// It mirrors `shared/chat/` (the cross-package chat-event schema shared by
// `agent/` + `frontend/`): a workspace package that owns the wire types so they
// have ONE owner and cannot drift between producer and consumer.
//
// These types are LIFTED VERBATIM from the shapes MR-1 (`deriveStateDocument`)
// established and MR-2 (`buildStateRouter`) serves — they are NOT new shapes.
// They are plain, serializable data types only: NO machine internals, NO XState,
// NO `getPersistedSnapshot` coupling (that is precisely the mirror-model coupling
// ADR-046 rejected). The document is a STABLE DERIVED VIEW of the one
// per-principal ChatApp actor.
//
// References:
//   docs/decisions/adr-046-*.md — StateProxy actor surface; Decision 1 (1B), Decision 2 (2-i)
//   ui-state/lib/machines/chat-app/projection/derive-state-document.ts — MR-1 origin (the shape this mirrors)
//   ui-state/lib/domain/projection.ts      — ReducedContext + initialContext (the region context shape)
//   ui-state/lib/domain/active-scope.ts    — ActiveScope + ResourceType
//   shared/chat/                           — the cross-package wire-type precedent

// ───────────────────────────── active scope (← ui-state/lib/domain/active-scope.ts) ─────────────────────────────

/** The single resource literal today. The alias name lets call sites read
 *  structurally; the `resource_type` field stays polymorphism-ready for the day
 *  a second resource type ships. */
export type ResourceType = "dataset";

/** The authoritative scope a request resolves to. Carried at the document's top
 *  level (`active_scope`) — the deepest-resolved region wins. */
export interface ActiveScope {
  org_id: string;
  project_id: string | null;
  resource_type: ResourceType | null;
  resource_id: string | null;
}

// ───────────────────────────── reduced context (← ui-state/lib/domain/projection.ts) ─────────────────────────────

/**
 * The reduced read-model context each region slice exposes — the SAME shape the
 * per-machine projection's `context` carried, minus the wire envelope. Plain
 * serializable data: the FE's `useSelector` selectors read these fields directly
 * (`d.regions.projectContext.context.project`, etc.).
 *
 * Lifted verbatim from ui-state's `ReducedContext` (the producer); kept here as
 * the wire SSOT so the proxy is typed without importing ui-state internals.
 */
export interface ReducedContext {
  user: {
    email: string | null;
    display_name: string | null;
    first_name: string | null;
  };
  org: { id: string | null; name: string | null };
  /** The authoritative (current) project name as known to the user's machine. */
  project: { id: string | null; name: string | null };
  underlying_cause_tag: string | null;
  retries_count: number;
  org_validation_error: { kind: string; message: string } | null;
  /** I5: true when last deep-link reconciliation rewrote the bookmarked name. */
  scope_reconciled: boolean;
  /** I4: surfaced when a deep link to a foreign tenant's resource is rejected. */
  scope_resolution_error: { reason: string } | null;
  /** The resolved scope from the most recent deep_link_opened event. */
  resolved_scope: ActiveScope | null;
  project_validation_error: { kind: string; message: string } | null;
  /** J-002 deep-link WISH payload (URL-level user wish, not yet confirmed). */
  deeplink_project_id: string | null;
  deeplink_session_id: string | null;
  /** Resource fields kept on the polymorphic `intent_resource_*` prefix for
   *  forward-compat with the `open_deep_link` event payload. */
  intent_resource_id: string | null;
  intent_resource_type: ResourceType | null;
  /** Click-captured resume target (session-chat half — MR-D split). */
  pending_resume_session_id: string | null;
  // ── session-chat context ───────────────────────────────────────────────
  /** Sessions visible in the current project; sorted DESC by last_active_at. */
  session_list: Array<{
    id: string;
    title: string | null;
    last_active_at: string;
    active_dataset_id: string | null;
  }>;
  session_list_next_cursor: string | null;
  session_list_has_more: boolean;
  /** Active session: populated on session_resumed. */
  session_id: string | null;
  transcript: Array<{
    id: string;
    role: "user" | "assistant" | "tool";
    content: string;
    ts: string;
  }>;
  /** Active resource (dataset). Populated on session_resumed when resolved. */
  resource: { type: ResourceType | null; id: string | null };
  /** Surfaced when a resumed session's active_dataset_id 404s. */
  session_dataset_unavailable: boolean;
  /** US-206 composer-state preservation: the welcome-state's pending first message. */
  pending_first_message: string;
  // ── cross-machine FREEZE/THAW ────────────────────────────────────────
  /** The live state the machine froze from; restored on THAW. */
  last_live_state: string | null;
  /** Cumulative stale-intent drop counter (observability only). */
  stale_intents_dropped_count: number;
  /** The most recent stale-dropped intent. */
  last_stale_intent: { intent_type: string; target_id: string } | null;
}

/**
 * The zero-event reduced context (every field at its initial value) — the SSOT
 * zero-value, mirroring ui-state's `initialContext()`. Used to build the
 * anonymous document the proxy returns before the first server frame resolves.
 */
export function initialReducedContext(): ReducedContext {
  return {
    user: { email: null, display_name: null, first_name: null },
    org: { id: null, name: null },
    project: { id: null, name: null },
    underlying_cause_tag: null,
    retries_count: 0,
    org_validation_error: null,
    scope_reconciled: false,
    scope_resolution_error: null,
    resolved_scope: null,
    project_validation_error: null,
    deeplink_project_id: null,
    deeplink_session_id: null,
    intent_resource_id: null,
    intent_resource_type: null,
    pending_resume_session_id: null,
    session_list: [],
    session_list_next_cursor: null,
    session_list_has_more: false,
    session_id: null,
    transcript: [],
    resource: { type: null, id: null },
    session_dataset_unavailable: false,
    pending_first_message: "",
    last_live_state: null,
    stale_intents_dropped_count: 0,
    last_stale_intent: null,
  };
}

// ───────────────────────────── the state document (← MR-1 derive-state-document.ts) ─────────────────────────────

/** Coarse lifecycle phase — the parent ChatApp region value, for routing /
 *  first-paint dispatch. NOT a region's state-of-record (consumers dispatch on
 *  `regions.<r>.state`). */
export type ChatAppPhase = "onboarding" | "project_context" | "chat";

/** A derived slice of one lifecycle region — the discriminated state + its
 *  reduced context (the exact shape the per-machine projection exposed).
 *
 *  `state` stays a wire-level `string` (a derived-view contract that must tolerate
 *  any region-state name the origin emits). Consumers dispatching on it read the
 *  typed vocabulary below ({@link OnboardingState} / {@link ProjectContextState})
 *  rather than bare literals, so a rename is a single-source edit. */
export interface RegionView {
  state: string;
  context: ReducedContext;
}

/** The `regions.onboarding.state` vocabulary — the settled discriminants the
 *  onboarding lifecycle region emits. The named constants consumers compare
 *  against instead of bare string literals. Co-declared as a type of the same
 *  name below, so one identifier serves both the values and the union. */
export const OnboardingState = {
  Verifying: "verifying",
  AwaitingOrgReport: "awaiting_org_report",
  NeedsOrg: "needs_org",
  Ready: "ready",
  ErrorRecoverable: "error_recoverable",
} as const;

/** The union of {@link OnboardingState} members — the typed vocabulary consumers
 *  narrow `RegionView.state` against on the onboarding region. */
export type OnboardingState =
  (typeof OnboardingState)[keyof typeof OnboardingState];

/** The `regions.projectContext.state` vocabulary — the settled discriminants the
 *  project-context lifecycle region emits. Co-declared as a type of the same name
 *  below. */
export const ProjectContextState = {
  AwaitingScopeReport: "awaiting_scope_report",
  ResolvingInitialScope: "resolving_initial_scope",
  CreatingProject: "creating_project",
  ProjectSelected: "project_selected",
  NoProjects: "no_projects",
  ErrorRecoverable: "error_recoverable",
} as const;

/** The union of {@link ProjectContextState} members — the typed vocabulary
 *  consumers narrow `RegionView.state` against on the project-context region. */
export type ProjectContextState =
  (typeof ProjectContextState)[keyof typeof ProjectContextState];

/** The onboarding states that keep an authenticated principal on the
 *  client-driven `/onboarding` flow (the app-shell gate's active set). Declared
 *  over `string` so a raw `RegionView.state` can be membership-tested directly;
 *  its members are drawn from {@link OnboardingState}. */
export const ONBOARDING_ACTIVE_STATES: ReadonlySet<string> =
  new Set<OnboardingState>([
    OnboardingState.NeedsOrg,
    OnboardingState.ErrorRecoverable,
  ]);

/** The optimistic source node's phase, mirroring the ui-state source-upload
 *  child's state vocabulary (idle → creating_source → uploading → processing →
 *  linked, plus error_recoverable). */
export type SourceUploadPhase =
  | "idle"
  | "creating_source"
  | "uploading"
  | "processing"
  | "linked"
  | "error_recoverable";

/**
 * The `sourceUpload` region — a FLAT slice the lineage canvas reads to render an
 * optimistic source node advancing through the Source-creation saga and to
 * reconcile it against the real source/dataset once linked (client-reported
 * model, ADR-049/050). Unlike the three lifecycle regions it is NOT a
 * `{ state, context }` slice — the source-upload child carries only this small
 * flat shape.
 */
export interface SourceUploadRegion {
  phase: SourceUploadPhase;
  temp_node_id: string | null;
  source_id: string | null;
  dataset_id: string | null;
  error: string | null;
}

/**
 * The single JSON document `GET /state` and `/state/stream` emit and
 * `POST /state/events` returns — a STABLE DERIVED VIEW of the one per-principal
 * ChatApp actor (never the raw, version-coupled persisted snapshot).
 */
export interface ChatAppStateDocument {
  /** Lifecycle phase — routing/first-paint convenience, not a state-of-record. */
  phase: ChatAppPhase;
  /** The single authoritative active scope (deepest-resolved region wins). */
  active_scope: ActiveScope;
  /** Monotonic per-actor change marker (aggregated over the region logs). */
  sequence_id: number;
  /** Timestamp of the last settled transition. */
  last_event_at: string;
  request_id: string;
  /** Every lifecycle region, always present, each a derived slice of the snapshot. */
  regions: {
    onboarding: RegionView;
    projectContext: RegionView;
    sessionChat: RegionView;
    /** The optimistic source-upload flow (client-reported; ADR-049/050). */
    sourceUpload: SourceUploadRegion;
  };
}

/**
 * The anonymous document — the zero-state document the server's `emptyView`
 * produces (every region in its initial `verifying` state, the empty scope, zero
 * bookkeeping). Byte-equal to `deriveStateDocument(emptyView, { sequence_id: 0,
 * last_event_at: "", request_id: "" })` on the origin.
 *
 * The proxy's `getSnapshot()` returns this for pure CSR (no SSR seed) until the
 * first GET/SSE frame resolves, so `useSelector` NEVER sees `undefined`.
 */
export function anonymousStateDocument(): ChatAppStateDocument {
  return {
    phase: "onboarding",
    active_scope: {
      org_id: "",
      project_id: null,
      resource_type: null,
      resource_id: null,
    },
    sequence_id: 0,
    last_event_at: "",
    request_id: "",
    regions: {
      // Client-reported model (ADR-049/050): the zero state is the cold-start
      // "waiting for the client's outcome report" state, NOT a server-probe
      // "verifying". sessionChat keeps its zero unchanged (CDO-S1 realigns only
      // onboarding + project-context).
      onboarding: {
        state: "awaiting_org_report",
        context: initialReducedContext(),
      },
      projectContext: {
        state: "awaiting_scope_report",
        context: initialReducedContext(),
      },
      sessionChat: { state: "verifying", context: initialReducedContext() },
      // The source-upload flow folds to `idle` before the workspace is engaged
      // (no live source-upload child), byte-equal to the origin's emptyView.
      sourceUpload: {
        phase: "idle",
        temp_node_id: null,
        source_id: null,
        dataset_id: null,
        error: null,
      },
    },
  };
}
