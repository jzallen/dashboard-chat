// ChatApp snapshot restart-recovery helpers.
//
// Make the ChatApp actor's getPersistedSnapshot() the internal state-of-record
// for hot restart. This module is the thin seam between the live actor and the
// ChatAppSnapshotStore (lib/persistence/chatapp-snapshot-store.ts):
//
//   - persistChatApp(actor)         → the JSON-serializable persisted snapshot
//   - rehydrateChatApp(machine, s)  → a STARTED actor restored from a snapshot
//   - isSettledForSnapshot(snap)    → the R3 "settled states only" guard
//   - saveChatAppSnapshot(...)      → persist via the store, ONLY when settled
//   - loadChatAppSnapshot(...)      → read + (caller) rehydrate
//
// R3 invariant: on xstate 5.31.1, rehydrating a snapshot taken mid-invoke
// RE-FIRES the in-flight invoke (self-heals) and survives a JSON round-trip. The
// discipline that backs this: snapshot at SETTLED control states so the
// non-idempotent create* invokes (createProject / createSessionEagerly) are
// never the persisted state and can never double-fire on restart.
// isSettledForSnapshot enforces that; the re-fire is then a pure safety net.
//
// References:
//   docs/decisions/adr-044-*.md  — hybrid log/snapshot state-of-record

import { type AnyActorRef, type AnyStateMachine, createActor, type Snapshot } from "xstate";

import type { PersistedChatAppSnapshot } from "../../persistence/chatapp-snapshot-store.ts";
import type { ChatAppSnapshotStore } from "../../persistence/chatapp-snapshot-store.ts";
import type { ChatAppChildId } from "./setup/types.ts";

/** The actor surface persistChatApp reads (the persisted blob). Both a live and
 *  a rehydrated ChatApp actor satisfy it. */
interface SnapshottableActor {
  getPersistedSnapshot: () => PersistedChatAppSnapshot;
}

/** A view over the live snapshot's invoked children — enough to read each
 *  child's current state value for the settled-state check. */
interface ChildrenView {
  children: Partial<
    Record<ChatAppChildId, { getSnapshot: () => { value: unknown } } | undefined>
  >;
}

/**
 * The invoke-bearing (TRANSIENT) state of each child — the states where a
 * `fromPromise` is in flight. A snapshot taken while ANY live child sits in one
 * of these is NOT safe to persist as the canonical restart point: rehydration
 * would re-fire the invoke, and for the non-idempotent create* invokes that
 * could duplicate a resource (R3 audit). Settled = no live child is here.
 */
const TRANSIENT_CHILD_STATES: Readonly<
  Record<ChatAppChildId, ReadonlySet<string>>
> = {
  // Client-reported onboarding (ADR-049/050) has NO invoke states — every
  // onboarding state (awaiting_org_report/needs_org/ready/error_recoverable) is
  // settled the instant it is reached, so the set is empty.
  "onboarding": new Set<string>(),
  // Client-reported model (ADR-049/050): awaiting_scope_report / no_projects /
  // project_selected all SETTLE immediately (no invoke). Only the retained
  // switching_project (US-207 switch invoke) is transient.
  "project-context": new Set(["switching_project"]),
  // Report-driven session-chat (ADR-050 §e.5 / DR-8/AR-8) invokes NO actors —
  // every state (including awaiting_session_list_report) SETTLES the instant it
  // is reached, so the transient set is empty (the four retired invoke states
  // no longer exist).
  "session-chat": new Set<string>(),
};

/** Capture the JSON-serializable persisted snapshot of a live ChatApp actor
 *  (parent + invoked children). */
export function persistChatApp(
  actor: SnapshottableActor,
): PersistedChatAppSnapshot {
  return actor.getPersistedSnapshot();
}

/**
 * R3 settled-state guard: true when NO live invoked child is mid-invoke, so the
 * snapshot is safe to persist as the canonical restart point. Reads the live
 * snapshot's invoked-children values (the parent's own lifecycle states carry no
 * invoke of their own beyond the children, so only children matter).
 */
export function isSettledForSnapshot(snapshot: ChildrenView): boolean {
  for (const childId of Object.keys(TRANSIENT_CHILD_STATES) as ChatAppChildId[]) {
    const childSnapshot = snapshot.children[childId]?.getSnapshot();
    if (
      childSnapshot &&
      TRANSIENT_CHILD_STATES[childId].has(childSnapshot.value as string)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Persist the principal's ChatApp snapshot via the store — but ONLY when the
 * actor is at a settled control state (R3 discipline). Returns whether a save
 * happened, so a caller can observe the skip on a transient.
 *
 * `getLiveSnapshot` reads the live state value for the settled check; it is
 * separate from getPersistedSnapshot (the blob) because the settled check needs
 * the resolved child state values, not the persisted shape.
 */
export async function saveChatAppSnapshot(
  store: ChatAppSnapshotStore,
  principal_id: string,
  actor: SnapshottableActor & { getSnapshot: () => ChildrenView },
): Promise<boolean> {
  if (!isSettledForSnapshot(actor.getSnapshot())) {
    return false;
  }
  await store.save(principal_id, persistChatApp(actor));
  return true;
}

/** Load the principal's stored snapshot (or null). The caller rehydrates with
 *  {@link rehydrateChatApp} once it has the wired machine. */
export async function loadChatAppSnapshot(
  store: ChatAppSnapshotStore,
  principal_id: string,
): Promise<PersistedChatAppSnapshot | null> {
  return store.load(principal_id);
}

/**
 * Rehydrate a STARTED ChatApp actor from a persisted snapshot. `machine` is a
 * freshly-built wired ChatApp (createChatApp(deps)) — the same machine
 * definition, on a fresh process. Per R3, any in-flight child invoke captured in
 * the snapshot re-fires automatically on `.start()` and self-heals once it
 * settles.
 */
export function rehydrateChatApp(
  machine: AnyStateMachine,
  snapshot: PersistedChatAppSnapshot,
): AnyActorRef {
  return createActor(machine, {
    snapshot: snapshot as Snapshot<unknown>,
  }).start();
}
