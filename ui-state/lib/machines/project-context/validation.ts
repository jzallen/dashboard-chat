// Project-name validation — the barrel re-exports a stable public surface
// (`validateProjectName` + `ProjectValidationError`) so callers need not reach
// into the machine module itself.
//
// Internal handler state (transient composer + inline-error fields) lives on
// machine context; the validation primitive itself is a pure function with no
// XState dependency.
//
// Public surface (re-exported by `./index.ts`):
//   - ProjectValidationError    — discriminated union of failure kinds
//   - validateProjectName(raw)  — returns null on success, error otherwise
//
// References:
//   docs/decisions/adr-028-*.md  — machines own transitions, the log owns state

/**
 * Discriminated-union shape attached to `context.project_validation_error`
 * when a submitted project name fails local validation. Parallels J-001's
 * `org_validation_error` shape so the UI's inline-error component can
 * render either uniformly.
 */
export interface ProjectValidationError {
  kind: "empty" | "too_short" | "too_long";
  message: string;
}

/**
 * Trim + length-check the project name; returns `null` if valid.
 *
 * Bounds (lifted verbatim from the pre-split file at `cd4103e`):
 *   - whitespace-only / empty   → `kind: "empty"`
 *   - trimmed length < 2        → `kind: "too_short"`
 *   - trimmed length > 80       → `kind: "too_long"`
 *
 * The bounds are local-validation only; the backend enforces its own
 * authoritative bounds at `POST /api/projects` and surfaces server-side
 * failures via the actor's `onError` branch (creating_project →
 * error_recoverable).
 */
export function validateProjectName(
  raw: string,
): ProjectValidationError | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return { kind: "empty", message: "Please enter a project name" };
  }
  if (trimmed.length < 2) {
    return { kind: "too_short", message: "Project name is too short" };
  }
  if (trimmed.length > 80) {
    return { kind: "too_long", message: "Project name is too long" };
  }
  return null;
}
