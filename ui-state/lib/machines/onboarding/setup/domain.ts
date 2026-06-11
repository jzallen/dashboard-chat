// The OnboardSession domain model: the value objects that give this bounded
// context a ubiquitous-language DSL named for what data IS, not where it crossed
// (an `Org`, not a `CreateOrgOutput`-style DTO). It also owns the bounded
// context's FAILURE VOCABULARY (the `UnderlyingCauseTag` union + `failWithCause`
// / `causeOf`) — see the "Failure cause" section at the foot of the file.
//
// VALUE OBJECTS WITH BEHAVIOR, not just types: `OrgName` owns its own shape
// invariant via the `constructOrgName` smart constructor and the `isValid()` /
// `getError()` methods on the value it returns. The rule lives ON the model, not
// in a free-floating validator.
//
// VALIDATION vs. GUARDS vs. ACTIONS — the role boundary the value object sits on:
//   • The value object (here) EVALUATES: "is this datum well-formed, and if not,
//     what exactly is wrong?" — `constructOrgName(raw).isValid()` / `.getError()`.
//   • Guards (./guards.ts) ROUTE: call `.isValid()` to pick a transition; they
//     never read the error and never mutate.
//   • Actions (./actions.ts) WRITE: call `.getError()` to record the rejection on
//     context, then render it to UI copy — a PRESENTATION concern that lives in
//     the action, not on the model (the domain doesn't know UI strings).
//
// SERIALIZATION CONSTRAINT: these values may live in XState machine context,
// which is harvested + projected through Redis. The STORED forms are PLAIN,
// serializable shapes — branded primitive strings + `readonly` records, never
// class instances. `constructOrgName` returns a TRANSIENT value object (it has
// methods) used only at the guard/action boundary; what gets stored is its
// branded `.value` string. Brands are compile-time only (erased at runtime), so
// JSON round-trips are lossless; rehydrated values are a trust boundary.
//
// References:
//   docs/decisions/adr-041-*.md  — session-onboarding domain realignment

/** Branded id of the already-authenticated principal (the verified X-User-Id) —
 *  the OnboardSession aggregate root id. Opaque; branding asserts only "this is
 *  a principal id", which is true at the router boundary that mints it. */
export type PrincipalId = string & { readonly __brand: "PrincipalId" };

/** Branded id of an Org — a reference to the backend Org aggregate (the SSOT).
 *  Opaque; branding is honest (it IS an org id, no shape rule to satisfy). */
export type OrgId = string & { readonly __brand: "OrgId" };

/** A submitted org name that has passed the shape rule. Construct ONLY via
 *  `constructOrgName` (or, where a guard has already validated, by branding the
 *  raw submission). An EXISTING org's display name (`Org.name`) is a plain
 *  string, not an `OrgName`: the backend is authoritative for it and it need not
 *  satisfy our submission rule. */
export type OrgName = string & { readonly __brand: "OrgName" };

/** Why a submitted org name was rejected by the shape rule. No `message` — UI
 *  copy is a presentation concern rendered in the action, not the domain. */
export type OrgNameRejection =
  | { kind: "empty" }
  | { kind: "too_short"; min: number; actual: number }
  | { kind: "too_long"; max: number; actual: number };

const MIN_ORG_NAME = 2;
const MAX_ORG_NAME = 64;

/** One shape rule: `failsWhen` is the violation predicate; `error` builds the
 *  typed rejection for it. */
interface OrgNameRule {
  failsWhen: (trimmed: string) => boolean;
  error: (trimmed: string) => OrgNameRejection;
}

/** Ordered shape rules — first failure wins (list order = precedence). */
const ORG_NAME_RULES: readonly OrgNameRule[] = [
  { failsWhen: (s) => s.length === 0, error: () => ({ kind: "empty" }) },
  {
    failsWhen: (s) => s.length < MIN_ORG_NAME,
    error: (s) => ({ kind: "too_short", min: MIN_ORG_NAME, actual: s.length }),
  },
  {
    failsWhen: (s) => s.length > MAX_ORG_NAME,
    error: (s) => ({ kind: "too_long", max: MAX_ORG_NAME, actual: s.length }),
  },
];

/** The `OrgName` value object as returned by `constructOrgName`: the branded
 *  value (present only when valid) plus the behavior that owns the invariant.
 *  TRANSIENT — never stored in context (it has methods); store `.value`. */
export interface OrgNameValue {
  /** The branded value — present only when the submission is valid. */
  readonly value: OrgName | null;
  /** True when the submission satisfies every shape rule. */
  isValid(): boolean;
  /** The first violated rule's typed rejection, or null when valid. */
  getError(): OrgNameRejection | null;
}

/**
 * Smart constructor for the `OrgName` value object. Trims, then evaluates the
 * ordered shape rules ONCE (first failure wins); the returned value object
 * exposes that verdict as behavior — `isValid()` to route, `getError()` for the
 * specific rejection, `value` for the branded result. Duplicate detection is NOT
 * a rule here: org names are globally unique and the backend (the SSOT,
 * `POST /api/orgs`) is the authority — a collision surfaces as a `duplicate`
 * inline error from the create-org path, not from this pure shape check.
 */
export function constructOrgName(raw: string): OrgNameValue {
  const trimmed = raw.trim();
  const broken = ORG_NAME_RULES.find((rule) => rule.failsWhen(trimmed));
  const error = broken ? broken.error(trimmed) : null;
  return {
    value: error ? null : (trimmed as OrgName),
    isValid: () => error === null,
    getError: () => error,
  };
}

/** The re-verified identity — what the WorkOS `/oauth/userinfo`
 *  call yields once refined at the boundary. Identity ONLY; carries no org
 *  binding. `first_name` is derived once, at that boundary, from `display_name`. */
export interface VerifiedUser {
  readonly email: string;
  readonly display_name: string;
  readonly first_name: string | null;
}

/** An org binding the principal belongs to — what the create-org resolver and
 *  the backend org lookup yield. Replaces a provenance-named create-org DTO. */
export interface Org {
  readonly id: OrgId;
  readonly name: string;
}

/** The combined result the `verifying` step resolves: the verified identity PLUS
 *  the user's org binding from the backend SSOT (`null` = new user, no org yet).
 *  The `[hasOrg]` guard reads `.org` off this. */
export interface VerifiedSession {
  readonly user: VerifiedUser;
  readonly org: Org | null;
}

// --- Failure cause -----------------------------------------------------------
//
// The OnboardSession failure vocabulary: the closed set of REASONS a verifying /
// org-create step can fail, which the recoverable-error + session_rejected
// projections map to user copy. A cause is tagged AT THE BOUNDARY that knows the
// reason — `failWithCause(...)` brands the thrown Error — and read back off the
// `onError` event by `causeOf(...)`. This INVERTS the old downstream classifier
// that sniffed `error.message` substrings: the seam that raised the failure
// declares its cause; nothing downstream has to guess from a string.

/** The §c onboarding org-create failure causes the client reports on the wire
 *  (`org_create_failed { cause }`). Machine-readable only — never rendered raw
 *  (that mapping is CDO-S5). The re-edit causes (`org_name_taken`,
 *  `org_name_invalid`) return the user to the form; the generic
 *  `org_create_failed` is the retryable cause that lands in error_recoverable. */
export type OrgCreateFailureCause =
  | "org_name_taken"
  | "org_name_invalid"
  | "org_create_failed";

/** The closed set of underlying causes the projection drives error copy from.
 *  `partial-setup` retired (ADR-048: no terminal-in-practice dead-end); the
 *  generic retryable onboarding cause `org_create_failed` takes its place. */
export type UnderlyingCauseTag =
  | "transient"
  | "cookie-blocked"
  | "org_create_failed"
  | "workos-profile-corrupt";

/** Brand a thrown failure with its domain cause so a downstream action can route
 *  on the REASON, not a message substring. Mirrors the `name_taken` flag the 409
 *  create-org path tacks onto its Error (./actors.ts) — a plain serializable
 *  property, not an Error subclass (no `instanceof` across the actor boundary). */
export function failWithCause(
  cause: UnderlyingCauseTag,
  message: string,
): Error {
  const err = new Error(message);
  (err as Error & { cause_tag?: UnderlyingCauseTag }).cause_tag = cause;
  return err;
}

/** Read the domain cause off a failure raised by an actor. `event.error` is
 *  `unknown` and may be a foreign throw, so this is a TRUST-BOUNDARY read: an
 *  untagged error — or one carrying a tag outside the closed union — falls back
 *  to `transient`, the safe retryable default. */
export function causeOf(error: unknown): UnderlyingCauseTag {
  const tag = (error as { cause_tag?: unknown } | null | undefined)?.cause_tag;
  return typeof tag === "string" && isUnderlyingCauseTag(tag)
    ? tag
    : "transient";
}

/** Map a reported org-create failure cause to the projection's underlying cause
 *  tag. The error_recoverable arm is only ever reached by the generic
 *  `org_create_failed` cause (the re-edit causes are intercepted by their guards
 *  and never tag a cause), so every cause that reaches a tag is the retryable
 *  `org_create_failed`. The total signature keeps the wire union honest without a
 *  cast at the call site. */
export function causeTagOf(_cause: OrgCreateFailureCause): UnderlyingCauseTag {
  return "org_create_failed";
}

export function isUnderlyingCauseTag(
  value: string,
): value is UnderlyingCauseTag {
  return (
    value === "transient" ||
    value === "cookie-blocked" ||
    value === "org_create_failed" ||
    value === "workos-profile-corrupt"
  );
}
