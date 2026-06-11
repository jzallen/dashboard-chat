# CDO-S3 — upstream issues (raised during DELIVER, out of shared+ui-state scope)

## UPSTREAM-S3-1 (MEDIUM) — backend `AuthorizationError→500` on a second org-create blocks `test_org_name_taken_reedit`

**Where:** `backend/app/use_cases/organization/create_organization.py:33,50` +
the org controller result-mapper (`backend/app/controllers/organization_controller.py`)
+ `backend/app/main.py:133` (the FastAPI `AuthorizationError` handler).

**Symptom:** the `cdo_s3` acceptance test
`test_org_name_taken_reedit.py::test_name_taken_stays_needs_org_then_recovers_with_a_new_name`
is RED — the second `POST /api/orgs` returns **500** where the test expects **409**.

**Root cause (two compounding issues, both upstream of the CDO-S3 shared+ui-state slice):**

1. **Backend error-mapping gap (CDO-S2 domain, merged).** `create_organization`
   calls `_ensure_user_has_no_org(user)` FIRST (line 33); for a principal that
   already owns an org it raises `AuthorizationError` (line 50). `@handle_returns`
   catches that into a `Failure`, so the `@app.exception_handler(AuthorizationError)`
   at `main.py:133` never fires; the org controller's result-mapper has no
   `AuthorizationError → 4xx` arm, so it surfaces as a generic **500** ("Unhandled
   error"). It should map to a clean `403` (or the name-uniqueness check should run
   first and yield the `409` the contract documents).

2. **DISTILL test-design limitation.** The scenario models "an organisation name
   already in use (someone took it first)" by having the driver `create_org(name)`
   then attempt the same name — but with the SAME dev bearer. In the single-principal
   `AUTH_MODE=dev` + `DEV_NO_ORG` target there is only `dev-user-001`, so the first
   create makes that principal own the org and the second create hits
   `_ensure_user_has_no_org` ("already has org") BEFORE any name-uniqueness `409`.
   A genuine `409`-name-conflict-by-**another**-user is unreproducible without a
   second principal (or a pre-seeded org with a known name owned by a different
   `created_by`).

**Why it is not a CDO-S3 defect:** the ui-state contract the test asserts (a
re-edit cause → REMAIN `needs_org` with `org_validation_error`, recoverable, no
dead end) is delivered and verified by (a) the GREEN sibling acceptance arm
`test_invalid_org_name_stays_needs_org` (the `org_name_invalid` re-edit path,
same machine arm) and (b) the 03-01 unit tests
(`onboarding/machine.test.ts` — `org_create_failed{cause:org_name_taken}` stays
`needs_org` + `org_validation_error`). The test was RED-by-design before this slice
(it failed earlier, at the report step, on the closed-ACL 400); CDO-S3 moved the
failure later (now it reaches the backend conflict step), exposing the pre-existing
500. The Iron Rule forbids editing the test to pass; the backend is out of the
declared shared+ui-state scope.

**Suggested resolution (a future slice / backend follow-up — NOT CDO-S3):**
- Map `AuthorizationError` to a JSON:API `403` in the org controller's result
  mapper (so use-case-raised auth failures are not 500s), AND/OR
- run the name-uniqueness check before `_ensure_user_has_no_org` so a duplicate
  name yields the documented `409`; AND
- give the acceptance suite a second-principal (or pre-seeded foreign org) affordance
  so the name-conflict scenario is reproducible in the dev target — or re-scope the
  scenario's choreography in DISTILL.
