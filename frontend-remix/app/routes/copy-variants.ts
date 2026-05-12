// Copy variants table for the recoverable-error page, keyed by the
// closed-vocabulary UnderlyingCauseTag union shared with the flow-state
// machine. Each variant is jargon-free per US-003 — Maya sees what
// happened, what to do, and a reference she can share with support.
// Per the @us-003 scenarios, no raw error/status code is exposed.
//
// The union is intentionally redeclared here (not imported from
// flow-state/) so the frontend module stays decoupled from the
// state-machine internals — the wire shape is the contract.

export type UnderlyingCauseTag =
  | "transient"
  | "cookie-blocked"
  | "partial-setup"
  | "workos-profile-corrupt";

export interface CopyVariant {
  title: string;
  body: string;
  cta: string;
}

export const COPY_VARIANTS: Record<UnderlyingCauseTag, CopyVariant> = {
  transient: {
    title: "We could not verify your identity right now",
    body: "This is usually a brief network issue and resolves with a retry.",
    cta: "Try again",
  },
  "cookie-blocked": {
    title: "Your browser is blocking the sign-in cookie",
    body:
      "Allow cookies for this application or try another browser to continue.",
    cta: "Try again",
  },
  "partial-setup": {
    title: "Your organization is partly set up",
    body:
      "We created your organization but could not finish issuing your access. Try again to complete setup.",
    cta: "Try again",
  },
  "workos-profile-corrupt": {
    title: "We need to refresh your profile to sign you in",
    body:
      "Your identity provider returned an incomplete profile. Try again — if it persists, sign in with a different account.",
    cta: "Try again",
  },
};
