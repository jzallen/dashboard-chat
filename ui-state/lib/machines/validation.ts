// Pure validation + failure classification for J-001 (login + org setup).
//
// CM-D: these functions take zero fixtures and zero I/O. They convert raw
// inputs from the wire into closed-union shapes the machine can branch on.
//
// validateOrgName: parses + validates the SHAPE of the org name Maya submits
// (non-empty, length bounds). Duplicate detection is NOT done here — org names
// are globally unique and the backend (the SSOT, `POST /api/orgs`) is the
// authority; a collision surfaces as a `duplicate` inline error from the
// create-org path, not from this pure shape check.
//
// classifyFailure: maps a raw Error / payload into the closed UnderlyingCauseTag
// union the machine + projection use to drive copy variants on the recoverable-
// error page.

export type UnderlyingCauseTag =
  | "transient"
  | "cookie-blocked"
  | "partial-setup"
  | "workos-profile-corrupt"
  | "silent-reauth-failed";

export type OrgNameValidationError =
  | { kind: "empty" }
  | { kind: "too_short"; min: number; actual: number }
  | { kind: "too_long"; max: number; actual: number }
  | { kind: "duplicate"; name: string };

export type ValidatedOrgName = { value: string };

export type OrgNameResult =
  | { ok: true; value: ValidatedOrgName }
  | { ok: false; error: OrgNameValidationError };

const MIN_ORG_NAME = 2;
const MAX_ORG_NAME = 64;

/**
 * Validate the SHAPE of an organization-name submission.
 *
 * Rules:
 *   - trim leading/trailing whitespace
 *   - non-empty after trim
 *   - length in [MIN_ORG_NAME, MAX_ORG_NAME]
 *
 * Duplicate detection is intentionally NOT done here (org names are globally
 * unique; the backend create is the authority — a collision yields a
 * `duplicate` inline error from the create-org path). Returns a closed Result
 * union — the machine guard branches on `ok`.
 */
export function validateOrgName(raw: string): OrgNameResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: "empty" } };
  }
  if (trimmed.length < MIN_ORG_NAME) {
    return {
      ok: false,
      error: { kind: "too_short", min: MIN_ORG_NAME, actual: trimmed.length },
    };
  }
  if (trimmed.length > MAX_ORG_NAME) {
    return {
      ok: false,
      error: { kind: "too_long", max: MAX_ORG_NAME, actual: trimmed.length },
    };
  }
  return { ok: true, value: { value: trimmed } };
}

export interface ClassifiableFailure {
  /** Free-form message string from a thrown Error or upstream payload. */
  message?: string;
  /** Optional explicit tag — passes through when present and valid. */
  tag?: string | null;
  /** Optional kind hint from a known internal source. */
  kind?: "reissue_exhausted" | "workos_userinfo" | "cookie_blocked" | null;
}

/**
 * Classify a failure into the closed UnderlyingCauseTag union used by the
 * recoverable-error projection. Unknown failures default to "transient".
 *
 * Precedence:
 *   1. explicit `kind` hint (mapped deterministically)
 *   2. explicit `tag` (if it's already a member of the union)
 *   3. message-keyword sniffing (best-effort fallback)
 */
export function classifyFailure(failure: ClassifiableFailure): UnderlyingCauseTag {
  if (failure.kind) {
    switch (failure.kind) {
      case "reissue_exhausted":
        return "partial-setup";
      case "workos_userinfo":
        return "workos-profile-corrupt";
      case "cookie_blocked":
        return "cookie-blocked";
    }
  }
  if (failure.tag && isUnderlyingCauseTag(failure.tag)) {
    return failure.tag;
  }
  const msg = (failure.message ?? "").toLowerCase();
  if (msg.includes("missing email") || msg.includes("profile missing")) {
    return "workos-profile-corrupt";
  }
  if (msg.includes("cookie")) {
    return "cookie-blocked";
  }
  if (msg.includes("reissue") && msg.includes("exhaust")) {
    return "partial-setup";
  }
  return "transient";
}

function isUnderlyingCauseTag(value: string): value is UnderlyingCauseTag {
  return (
    value === "transient" ||
    value === "cookie-blocked" ||
    value === "partial-setup" ||
    value === "workos-profile-corrupt" ||
    value === "silent-reauth-failed"
  );
}
