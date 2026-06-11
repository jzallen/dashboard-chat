// session-chat/setup/actors.ts — REPORT-DRIVEN: zero egress (ADR-050 §e.5 /
// DR-8/AR-8).
//
// The session-chat machine no longer invokes server-side actors. Under the
// client-reported outcome model (ADR-049 §4 / INV-PCO) the client probes the
// backend session SSOT and NARRATES the past-tense outcome; the machine
// transitions on the report. The four egress actor resolvers that used to do
// network I/O here — loadSessionListFn / resumeSessionFn / createSessionEagerlyFn
// / switchDatasetContextFn and their `*Actor` factories — were DELETED in CDO-S5
// step 05-01 along with every `fetch` / `backendUrl` reference (the egress they
// performed is retired by design, not stubbed).
//
// What remains is the construction-DI seam the composition root + chat-app parent
// still reference by type:
//   - SessionChatMachineDeps — now an empty deps surface (no actors to inject).
//   - buildActors(deps)       — returns an empty actor map (no invoke states).
//   - SessionChatActor        — the (now empty) provided-actor union.
//
// References:
//   docs/decisions/adr-049-*.md  — client-reported outcome model; zero egress
//   docs/decisions/adr-050-*.md  — §e.5 session-chat vocabulary (DR-8/AR-8)

import type { ActiveScope } from "../../../domain/active-scope.ts";

/**
 * The construction-time deps surface the chat-app parent threads into
 * `createSessionChatMachine(deps)`. Report-driven session-chat invokes NO
 * actors, so this surface is intentionally EMPTY — kept as a named type so the
 * composition root (`ChatAppDeps.sessionChat`) and the parent's
 * `machine.provide` seam keep a stable shape across the egress retirement.
 */
export type SessionChatMachineDeps = Record<never, never>;

/**
 * Build the machine's actor map. Report-driven session-chat has no invoke
 * states, so the map is empty — `setup({ actors })` still accepts it and the
 * statechart names no `src`.
 */
export function buildActors(_deps: SessionChatMachineDeps) {
  return {} as Record<never, never>;
}

/**
 * The ProvidedActor union XState would derive from the (empty) actor map. Empty
 * by construction — there are no invoked actors. Kept exported for parity with
 * the project-context seam and any downstream `ReturnType` reads.
 */
export type SessionChatActor = never;

// Re-export ActiveScope so callers don't need a separate import path.
export type { ActiveScope };
