# CDO-S4 — upstream issues (carried forward / surfaced at DELIVER)

## UPSTREAM-S3-1 (MEDIUM, CARRIED FORWARD) — backend `AuthorizationError→500` on a second org-create

**Status:** UNRESOLVED — carried forward from CDO-S3 (`../cdo-s3/upstream-issues.md` UPSTREAM-S3-1). NOT a CDO-S4
regression: CDO-S4 touches auth-proxy only (no backend files in the diff since main `e8d6014c`), and this test was
already RED at the CDO-S3 post-merge gate (which merged with it documented as MEDIUM).

**Where:** `backend/app/use_cases/organization/create_organization.py:50` (`_ensure_user_has_no_org` raises
`AuthorizationError`) + `backend/app/controllers/organization_controller.py` result mapper (no
`AuthorizationError → 4xx` arm) + `backend/app/main.py:133` (the global `AuthorizationError` handler maps to 403,
but `@handle_returns` has already caught the exception into a `Failure` before it reaches the global handler, so it
surfaces as a generic 500).

**Symptom:** `tests/acceptance/org-onboarding/test_org_name_taken_reedit.py::test_name_taken_stays_needs_org_then_recovers_with_a_new_name`
is RED — the **second** `POST /api/orgs` (same dev principal, who now owns the org created in the first call)
returns **500** where the test expects **409**. The same-user guard (`_ensure_user_has_no_org`) fires BEFORE any
name-uniqueness `409` check, and the use-case-raised `AuthorizationError` is not mapped to a 4xx in the controller's
`match Failure(...)` arm, so it falls through to "Unhandled error" → 500.

**Why CDO-S4 does not fix it:**
- Out of slice scope — CDO-S4 is auth-proxy only. The fix is backend (controller result-mapper + arguably reordering
  the name-uniqueness check before the already-has-org guard so a genuine cross-user duplicate yields the documented 409).
- Iron Rule — the test asserts the documented contract (409); editing the test to accept 500 is forbidden.
- The auth-proxy reissue hook only fires on a `201`; a `500`/`409` passes through verbatim, so no auth-proxy change
  affects this path.

**Recommended fix (backend slice / CDO-S5 or a dedicated backend bugfix):**
1. Add an `AuthorizationError → 403` (JSON:API) arm to the org controller's result mapper so use-case-raised auth
   failures are not 500s; AND/OR
2. Reorder `create_organization` so the name-uniqueness `409` is evaluated before `_ensure_user_has_no_org`, so a
   genuine cross-user duplicate name yields the documented `409` and the same-user case yields a clean `403`.

The CDO-S4 deliverables (`test_mode_discovery.py`, `test_reissue_sets_cookie.py`) are GREEN; the CDO-S1 walking
skeleton + all cdo_s1/cdo_s2 + the other cdo_s3 scenarios remain GREEN.

## OBS-1 (LOW, NOTED) — no `auth.reissue.emitted` observability event exists to carry `transport: "both"`

ADR-050 §a states `auth.reissue.emitted` (ADR-048 §5) should report `transport: "both"` now that the reissue rides
both headers and cookies. A grep of `auth-proxy/app.ts` + `lib/` found **no existing `auth.reissue.emitted`
emitter** — the reissue path only sets headers/cookies; it emits no observability event today. Per the slice
boundary (do not invent a new observability event in this slice) the dual-emission is shipped without an
accompanying event. When the reissue observability event is introduced (ADR-048 §5 build-out, likely with the
CDO-S5 interception KPIs), it should set `transport: "both"`. No functional impact on the cookie/header emission.
