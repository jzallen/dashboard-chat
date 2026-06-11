# CDO-S2 DELIVER — Summary

**Feature:** client-driven-onboarding · **Slice:** CDO-S2 (backend pure-resource contracts)
**Branch:** `crew/quartermaster` · **Issue:** `dc-qw4` · **Date:** 2026-06-11

## What shipped

The backend became a **pure resource store** for the org-create path, and gained the two
read/validation affordances the client's status→cause mapping (CDO-S3) and the auth-proxy
WorkOS interception (CDO-S5) depend on:

1. **OrgCreate name validation → 422** on blank/whitespace (the retired machine-side
   `isOrgNameValid` guard's new SSOT home).
2. **WorkOS shrink** — the entire backend WorkOS footprint deleted: `_create_workos_org`,
   the `auth_mode` dispatch, `httpx`, `requires_reauth`, `ExternalServiceError`, and the
   five `config.py` WorkOS/auth-mode fields. Backend grep-clean of AUTH_MODE + WORKOS_*.
3. **`X-Provisioned-Org-Id` carry** — trust-gated header → repository row id (the WorkOS
   org id IS the local id); absent/untrusted → backend-generated.
4. **`GET /api/orgs/availability?name=`** → `200 {"available": bool}` over
   `get_organization_by_name`.
5. **Compose env deltas** — AUTH_MODE + WORKOS_* removed from `api`/`api-full`; the
   override's interim `AUTH_MODE: dev` api pin (sunset comment names this feature) deleted.

Name-uniqueness 409 + `created_by` + the dev create path are unchanged.

## Commits (atomic, Conventional Commits, no attribution)

`2f52083c` · `939773ee` · `ad058b58` · `a258c16c` · `18f39122` (steps 02-01 … 02-05).

## Verification

- **Backend gate (refinery `--backend`):** ruff check PASS · ruff format PASS ·
  `pytest --ignore=tests/integration` **1426 passed**.
- **DES:** all five steps logged PREPARE→COMMIT in the shared deliver execution-log
  (`02-01`..`02-05`); RED_ACCEPTANCE SKIPPED-by-design (real-stack outer loop is the
  orchestrator's gate).
- **Acceptance (real stack, `cdo_s2` marker):** see `wave-notes.md` → "Acceptance gate".
- **UPSTREAM-3 (HIGH):** RESOLVED — WorkOS docs confirm org name is non-unique; ADR-048
  R1 assumption holds; compensation stays best-effort. No CDO-S5 redesign.

## Scope boundary held

backend/ + compose env only. No auth-proxy / ui-state / ui / shared changes (CDO-S4/S5).
auth-proxy + agent + ui-state compose env left intact (later slices / ADR-048 R3).

## Handoff

`gt mq submit --branch crew/quartermaster --issue dc-qw4` (refinery rebases onto main,
runs `./tools/test/test.sh --auto` → `--backend`, merges on green). NOT merged by hand.
