// onboarding/setup/actors.ts — the (now EMPTY) actor layer for the
// OnboardSession aggregate.
//
// ZERO EGRESS (CDO-S5 / ADR-048 §4 / ADR-049 D3): the onboarding machine has been
// REPORT-DRIVEN since CDO-S1 (initial state `awaiting_org_report`, no `invoke`).
// The egress resolvers that USED to live here — the WorkOS `/oauth/userinfo`
// re-verify (loadSession / loadVerifiedSession / getWorkOSUserInfo) and the
// backend org SSOT (`GET /api/orgs/me`, `POST /api/orgs` via getUserOrg /
// createOrgFn / getOrg) — were DEAD CODE (no state invoked them) and are DELETED
// at CDO-S5 step 05-02 along with every `fetch` / `backendUrl` / `workosUrl`
// reference. ui-state now holds ZERO live network egress; the client reports the
// org-existence / org-create outcomes and the machine transitions on the report.
//
// What REMAINS here is the empty `actors` bundle machine.ts threads into
// `setup({ actors })` (so the statechart's `setup` shape is unchanged) plus the
// `OnboardingActor` provided-actor union derived from it, and the inert I/O-port
// type aliases (`RequestClient` / `OnboardingDeps`) the composition root + the
// chat-app transport still NAME on the begin-envelope shape — they carry no live
// reference (nothing calls `request_client`).
//
// References:
//   docs/decisions/adr-048-*.md  — ui-state zero network egress; Redis-only startup config
//   docs/decisions/adr-049-*.md  — D3: onboarding WorkOS re-verify egress removed (report-driven)
//   docs/decisions/adr-050-*.md  — client-reported onboarding outcomes

/**
 * The (inert) I/O port type the begin-envelope's `deps.request_client` field is
 * typed against: literally the `fetch` function. RETAINED as a TYPE alias only —
 * the report-driven onboarding machine invokes no resolver, so nothing calls it.
 * Kept so the composition root + chat-app transport may continue to NAME the
 * begin-envelope `deps` shape without an out-of-package type churn.
 */
export type RequestClient = typeof fetch;

/** The (inert) injected I/O-port bundle the begin envelope's `deps` field carries.
 *  No resolver reads it any more (zero egress); retained as a type so the
 *  envelope shape is stable. */
export interface OnboardingDeps {
  request_client: RequestClient;
}

/**
 * The machine's default actor map. EMPTY since CDO-S5: the report-driven machine
 * (awaiting_org_report initial, no `invoke`) names no actors. machine.ts still
 * threads this into `setup({ actors })` so the setup shape is unchanged.
 */
export const actors = {} as Record<string, never>;

/**
 * The ProvidedActor union XState derives from `actors` when it types
 * `setup({ actors })`. DERIVED from `typeof actors` (now empty), so the machine's
 * `setup({ actions })` pin stays valid. Mirrors project-context's `ProvidedActorOf`.
 */
type ProvidedActorOf<TActors extends Record<string, unknown>> = {
  [K in keyof TActors as K & string]: {
    src: K & string;
    logic: TActors[K];
    id: string | undefined;
  };
}[keyof TActors & string];

export type OnboardingActor = ProvidedActorOf<typeof actors>;
