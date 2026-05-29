// Domain types for the session-onboarding statechart (ADR-041): the machine's
// context / event / state / input shapes, plus the typed-arg aliases the
// extracted guards (./guards.ts) and actions (./actions.ts) annotate their
// params with. setup() infers those args for INLINE definitions; once the
// definitions move out of machine.ts they must spell the type out, so they all
// share `ActionArgs`/`GuardArgs` from here.
//
// Imports are type-only and one-way: types.ts → actors.ts (for Config + the deps
// bundle the params envelope carries) and types.ts → domain.ts (for OrgName,
// PrincipalId, and the UnderlyingCauseTag failure vocabulary). Nothing here
// imports machine.ts, so there is no machine ↔ types cycle.

import type { Config, SessionOnboardingDeps } from "./actors.ts";
import type { OrgName, PrincipalId, UnderlyingCauseTag } from "./domain.ts";

export type { UnderlyingCauseTag } from "./domain.ts";

export type SessionOnboardingState =
  | "verifying"
  | "needs_org"
  | "creating_org"
  | "ready"
  | "error_recoverable"
  | "session_rejected";

export interface OrgValidationInlineError {
  kind: "empty" | "too_short" | "too_long" | "duplicate";
  message: string;
}

/**
 * The immutable envelope injected at begin (= the machine input, normalized).
 * Written once by the context factory and NEVER reassigned; it lives in context
 * only because the invoke `input:` mappers + guards can read `context` but not
 * the actor's spawn `input`, and the input-driven (no-closure) actor design
 * means `config`/`deps` must reach the resolvers this way.
 */
export interface SessionOnboardingParams {
  request_id: string;
  /** Branded id of the verified principal (the auth-proxy X-User-Id), branded
   *  once in the context factory; the raw machine input carries it as a string. */
  principal_id: PrincipalId;
  /** The forwarded Bearer (L4) — from the router's Authorization header into the
   *  re-verify invoke input. Never a client body claim. */
  bearer_token: string;
  /** Env config (`workosUrl` + `backendUrl`) the `loadSession` resolver reads
   *  from input rather than a closure. Null in tests that stub the actor. */
  config: Config | null;
  /** The I/O port (the `fetch` library) the resolvers call directly. Mirrors
   *  `config`'s nullable + fail-fast pattern — null in tests that stub the actor. */
  deps: SessionOnboardingDeps | null;
}

export interface SessionOnboardingContext {
  /** Write-once injected envelope — see SessionOnboardingParams. */
  params: SessionOnboardingParams;

  // Outputs — the verified session being assembled.
  user: { email: string | null; display_name: string | null; first_name: string | null };
  org: { id: string | null; name: string | null };

  // Bookkeeping / coordination state.
  /** The validated org name (an `OrgName` value object) last submitted —
   *  preserved across `creating_org` re-entries so each retry sees the same name
   *  as the first attempt. Null until the first valid submission. */
  pending_org_name: OrgName | null;
  underlying_cause_tag: UnderlyingCauseTag | null;
  org_validation_error: OrgValidationInlineError | null;
}

export type SessionOnboardingEvent =
  | { type: "org_form_submitted"; org_name: string }
  | { type: "__force_failure__"; tag: UnderlyingCauseTag };

/** The raw machine input (the begin envelope before the context factory
 *  normalizes it into `params`). Mirrors `setup({ types: { input } })`. */
export interface SessionOnboardingInput {
  request_id: string;
  principal_id: string;
  bearer_token?: string;
  config?: Config | null;
  deps?: SessionOnboardingDeps | null;
}

/**
 * Shared typed-arg shape for the extracted guards + actions. `setup()` infers
 * this `{ context, event }` for inline definitions; the extracted predicates and
 * assigners annotate their single param with it. `event` is the declared event
 * union — done/error events from invoked actors are NOT members, which is why
 * the actor-result readers (assignVerifiedUser, hasOrg, …) cast `event` to read
 * `.output` / `.error`, exactly as they did when inline.
 */
export interface ActionArgs {
  context: SessionOnboardingContext;
  event: SessionOnboardingEvent;
}
export type GuardArgs = ActionArgs;
