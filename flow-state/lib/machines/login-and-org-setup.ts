// SCAFFOLD: true
//
// LoginAndOrgSetupMachine — XState v5 statechart scaffold.
//
// Per `docs/product/journeys/login-and-org-setup.yaml` the machine has 8
// states: anonymous, authenticating, authenticated_no_org, creating_org,
// ready, error_recoverable, expired_token, error_terminal.
//
// This scaffold defines the IDs and shapes only. Transitions are stubbed —
// invoking them throws. DELIVER fills in the actor invocations + guards
// per ADR-028 outside-in from the acceptance scenarios.

export const __SCAFFOLD__ = true;

export type LoginState =
  | "anonymous"
  | "authenticating"
  | "authenticated_no_org"
  | "creating_org"
  | "ready"
  | "error_recoverable"
  | "expired_token"
  | "error_terminal";

export type UnderlyingCauseTag =
  | "transient"
  | "cookie-blocked"
  | "partial-setup"
  | "workos-profile-corrupt";

export interface LoginMachineContext {
  correlation_id: string;
  user: { email: string | null; display_name: string | null };
  org: { id: string | null; name: string | null };
  underlying_cause_tag: UnderlyingCauseTag | null;
  retries: number;
}

export function createLoginAndOrgSetupMachine(_deps: unknown): never {
  throw new Error("Not yet implemented — RED scaffold");
}
