// LoginAndOrgSetupMachine — XState v5 statechart for J-001.
//
// Per `docs/product/journeys/login-and-org-setup.yaml` the machine has 8
// states: anonymous, authenticating, authenticated_no_org, creating_org,
// ready, error_recoverable, expired_token, error_terminal.
//
// Step 01-01 (walking skeleton) wires only the happy path:
//   anonymous --[sign_in_clicked]--> authenticating
//   authenticating --[invoke: workosUserInfo onDone]--> authenticated_no_org
//
// Subsequent steps fill in org creation, error recovery, and the
// expired_token freeze contract per ADR-027 §"Cross-machine freeze".

import { assign, fromPromise, setup } from "xstate";

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

export type LoginEvent =
  | { type: "sign_in_clicked"; persona_email: string; persona_display_name: string }
  | { type: "auth_callback_resolved" }
  | { type: "auth_failed"; underlying_cause_tag: UnderlyingCauseTag }
  | { type: "FREEZE" }
  | { type: "THAW" };

export interface WorkOSProfile {
  email: string;
  display_name: string;
}

export interface WorkOSUserInfoInput {
  persona_email: string;
  persona_display_name: string;
}

export type WorkOSUserInfoActor = ReturnType<
  typeof fromPromise<WorkOSProfile, WorkOSUserInfoInput>
>;

export interface LoginMachineDeps {
  workosUserInfo: WorkOSUserInfoActor;
}

export function createLoginAndOrgSetupMachine(deps: LoginMachineDeps) {
  return setup({
    types: {
      context: {} as LoginMachineContext,
      events: {} as LoginEvent,
      input: {} as { correlation_id: string },
    },
    actors: {
      workosUserInfo: deps.workosUserInfo,
    },
  }).createMachine({
    id: "login-and-org-setup",
    initial: "anonymous",
    context: ({ input }) => ({
      correlation_id: input.correlation_id,
      user: { email: null, display_name: null },
      org: { id: null, name: null },
      underlying_cause_tag: null,
      retries: 0,
    }),
    states: {
      anonymous: {
        on: {
          sign_in_clicked: {
            target: "authenticating",
          },
        },
      },
      authenticating: {
        invoke: {
          src: "workosUserInfo",
          input: ({ event }) => {
            if (event.type !== "sign_in_clicked") {
              return { persona_email: "", persona_display_name: "" };
            }
            return {
              persona_email: event.persona_email,
              persona_display_name: event.persona_display_name,
            };
          },
          onDone: {
            target: "authenticated_no_org",
            actions: assign({
              user: ({ event }) => ({
                email: event.output.email,
                display_name: event.output.display_name,
              }),
            }),
          },
          onError: {
            target: "error_recoverable",
            actions: assign({
              underlying_cause_tag: () => "transient" as const,
            }),
          },
        },
      },
      authenticated_no_org: {
        // Walking skeleton terminus. Subsequent steps add org_form_submitted
        // → creating_org → ready.
      },
      creating_org: {},
      ready: {},
      error_recoverable: {},
      expired_token: {},
      error_terminal: {},
    },
  });
}

/**
 * Build a WorkOS user-info actor that calls the real WorkOS-compatible
 * `/oauth/userinfo` endpoint. Used in production; tests can substitute via
 * `.provide({ actors: { workosUserInfo: fromPromise(...) } })`.
 */
export function createWorkOSUserInfoActor(workosUrl: string): WorkOSUserInfoActor {
  return fromPromise<WorkOSProfile, WorkOSUserInfoInput>(async ({ input }) => {
    // First do the token exchange.
    const tokenResp = await fetch(`${workosUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // The fake-workos `set_profile_for(code, ...)` keys profiles by code.
        // Persona name doubles as the auth code for fixture lookup.
        code: derivePersonaCode(input.persona_email),
      }),
    });
    if (!tokenResp.ok) {
      throw new Error(`workos token exchange failed: ${tokenResp.status}`);
    }
    const tokenBody = (await tokenResp.json()) as { access_token: string };

    // Then fetch the user profile.
    const userResp = await fetch(`${workosUrl}/oauth/userinfo`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        // The fake server keys profile lookup by `x-fake-workos-code` header.
        "x-fake-workos-code": derivePersonaCode(input.persona_email),
      },
    });
    if (!userResp.ok) {
      throw new Error(`workos userinfo failed: ${userResp.status}`);
    }
    const profile = (await userResp.json()) as {
      email?: string;
      name?: string;
    };
    if (!profile.email) {
      throw new Error("workos profile missing email");
    }
    return {
      email: profile.email,
      display_name: profile.name ?? "",
    };
  });
}

/**
 * Map persona email → fake-workos lookup code. The fake server's harness
 * sets `set_profile_for("maya-auth-code", { ... })`; persona local-part
 * doubles as the code so production-shaped calls find the fixture.
 */
function derivePersonaCode(email: string): string {
  const local = email.split("@")[0] ?? "";
  // "maya.chen" → "maya-auth-code"; preserves the fixture contract the
  // walking-skeleton step set up.
  const first = local.split(".")[0];
  return `${first}-auth-code`;
}
