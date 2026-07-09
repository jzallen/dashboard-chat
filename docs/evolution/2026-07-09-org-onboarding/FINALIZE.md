# Finalize — `org-onboarding` (precursor, subsumed by `client-driven-onboarding`)

> **Disposition**: **ARCHIVED AS A PRECURSOR.** `org-onboarding` shipped on `main`
> (2026-06-10, MR-1 + MR-2) and is not being finalized as a standalone evolution entry.
> The initiative broadened into **`client-driven-onboarding` (CDO)** — ratified by
> [ADR-048](../../decisions/adr-048-auth-proxy-owns-workos-write-workflow.md) /
> [ADR-049](../../decisions/adr-049-client-reported-outcome-event-model.md) /
> [ADR-050](../../decisions/adr-050-client-driven-onboarding-application-contracts.md) —
> which **reworked the onboarding wire choreography, the `ui/` surfaces, and the
> acceptance suite** this feature introduced. This document records what
> `org-onboarding` durably contributed, what CDO reworked, and where the live truth now
> lives. The full CDO post-mortem is a separate `/nw-finalize` (its own sub-issue under
> DC-163); this entry forward-references it and CDO's FINALIZE.md will back-reference
> this precursor.
>
> **Feature shipped**: 2026-06-10 (MR-1 backend S1, MR-2 `ui/` S2–S4 — both merged on `main`).
> **Wave path**: DESIGN (bridge doc, no full DESIGN wave — architecture pre-ratified by ADR-044/046) → DISTILL → DELIVER → *(FINALIZE deferred, then subsumed)*.
> **`main` HEAD at archive**: `b994b3a4`.
> **Archived artifacts**: this directory (`design/`, `distill/`, `deliver/`) is the verbatim feature-workspace snapshot, moved here via `git mv` from `docs/feature/org-onboarding/` so blame and rename history survive.

---

## 1. Summary

`org-onboarding` was the **initial cut** at first-run onboarding: get an org-less
principal from an authenticated entry into the app by creating an org and a single
default project. It rode already-ratified architecture (ADR-044 ChatApp coordinator,
ADR-046 StateProxy `/state` surface) as a thin **wiring slice** — a `/onboarding`
surface in `ui/`, plus a small backend affordance so the dev principal could actually
reach the empty-org state ([`design/delta-and-decisions.md`](design/delta-and-decisions.md)).
Scope was hard-bounded: **org + one default project only** — no member invites, no
project naming beyond the default.

It shipped in two merge requests:

- **MR-1 (backend, slice S1)** — the durable, still-live contribution (§2).
- **MR-2 (`ui/`, slices S2–S4)** — the onboarding surfaces + StateProxy port, later
  reworked by CDO (§3).

Both merged on 2026-06-10 with the `@walking_skeleton` scenario GREEN
([`deliver/wave-decisions.md`](deliver/wave-decisions.md) DLV-14). FINALIZE was
**deliberately deferred** at the time (DLV-8: "Finalize … is deliberately deferred until
this MR merges"). Before it happened, the initiative broadened into the client-reported
model and CDO absorbed the onboarding layer — hence this precursor archive rather than a
standalone finalize.

## 2. What `org-onboarding` durably contributed (still live on `main`)

The **backend DEV-reachability affordance** — MR-1's core — is unchanged by CDO and
remains the mechanism that lets a dev principal reach the empty-org state repeatably:

| Contribution | Where | Shipped in | Status on `main` |
|---|---|---|---|
| Nullable `organizations.created_by` column + migration 018 | `backend/app/repositories/metadata/organization_record.py:23`, `backend/migrations/versions/018_add_organizations_created_by.py` | `e80d7921` | **Live** |
| Stamp `created_by = user.id` on org create; **drop the "My First Project" backend auto-create** (D2) | `backend/app/use_cases/organization/create_organization.py` | `2b26cfbd` | **Live** — first-project creation is now user-driven, not backend-implicit |
| `DEV_NO_ORG` flag: ignore the injected `X-Org-Id` for the dev principal, resolve `org_id` from the DB by `created_by == user.id` | `backend/app/config.py:82`, `backend/app/routers/deps.py` (`get_current_user`) | `2b26cfbd` | **Live** — closes the otherwise-infinite dev loop (D1); ADR-050(a) notes CDO's cookie reissue makes the claim refresh "harmless redundancy" over this resolution |

Two pre-existing defects were also fixed under MR-1 and remain fixed
([`deliver/wave-decisions.md`](deliver/wave-decisions.md) DLV-4,
[`deliver/upstream-issues.md`](deliver/upstream-issues.md) DUI-3): the
`POST /api/orgs` **500-on-success** controller↔use-case shape mismatch (masked by a
theater characterization test + ui-state's 500-rule), and a `created_at` tie-break
nondeterminism in org ordering (DLV-6 D2, `82884550`).

## 3. What `client-driven-onboarding` reworked (superseding this feature's onboarding layer)

CDO ([ADR-050](../../decisions/adr-050-client-driven-onboarding-application-contracts.md))
moved onboarding from a **machine-driven write choreography** to a **client-reported
outcome model** (auth-proxy owns the WorkOS org-create; ui-state becomes a zero-egress
coordinator transitioning on client-reported past-tense outcome events). That
explicitly reworked three things `org-onboarding` introduced:

- **The wire vocabulary.** ADR-050 §e retires `org_form_submitted` and
  `create_project_submitted` (closing this feature's HIGH upstream issue **UI-1** — the
  `create_project_submitted`-carries-`org_name` misnomer, [`distill/upstream-issues.md`](distill/upstream-issues.md) — "dies with the event"). The `ChatAppWireEvent`
  catch-all becomes a closed union validated at the router edge.
- **The `ui/` surfaces.** `onboarding.tsx` / `app-shell.tsx` survive as files but their
  flow policy relocated into a new `ui/app/lib/onboarding-driver.ts`; the standalone
  `ProjectNameForm` was deleted (Phase D became an automatic client step); the shipped
  `Cause: partial-setup` rendering ADR-050(c) calls out as "the anti-pattern this kills."
  Later `ui/` commits (`aabaee25`, `61f846c3`, `e588789a`) reskinned them under CDO-S5.
- **The acceptance suite.** `tests/acceptance/org-onboarding/` was **reworked in place**
  for the client-reported model (`13da5567`) and now holds CDO scenarios
  (`test_reissue_sets_cookie.py`, `test_mode_discovery.py`,
  `test_org_create_failure_retryable.py`, `test_org_name_taken_reedit.py`, …), not this
  feature's original `org_form_submitted`/`create_project_submitted` choreography. The
  directory keeps the `org-onboarding` name but its contents are CDO's — a naming
  artifact, not a shared ownership.

The StateProxy/Provider port (`ui/app/lib/state-proxy.ts`, `StateProxyProvider.tsx`) is
the one MR-2 surface CDO left byte-untouched (ADR-050(e): "StateProxy/Provider are
untouched").

## 4. Verification at archive (2026-07-09)

Re-checked against `main` (`b994b3a4`):

- `018_add_organizations_created_by.py` present; `created_by` column present; `dev_no_org`
  config present — **MR-1 confirmed merged**.
- `ui/app/lib/state-proxy.ts`, `ui/app/lib/StateProxyProvider.tsx`,
  `ui/app/routes/onboarding.tsx` present — **MR-2 confirmed merged** (surfaces since
  reworked by CDO, per §3).

The feature's own DELIVER verification (green walking skeleton, 7/7 acceptance, backend
1418 pytest, `ui` 221 vitest) is recorded in
[`deliver/wave-decisions.md`](deliver/wave-decisions.md) DLV-5/DLV-14 and is a snapshot
of the 2026-06-10 landing, not re-run here (the acceptance suite it names has since been
reworked for CDO).

## 5. Deferred / carried-forward items

- **Mutation testing — never run.** DLV-7 / DLV-13: no mutation tooling exists in the
  repo (no cosmic-ray, no Stryker). Recorded honestly as skipped for both MRs;
  recommended follow-up (configure + run feature-scoped) carries forward — now most
  usefully against CDO's suite.
- **StateProxy module singleton vs a future logout** (DUI-5 / DLV-12 D4, LOW). The
  default proxy is a module-level singleton; safe today because `ui/` has no production
  logout (`_session.ts` signOut is a test scaffold) and login is a full page load. **A
  future client-side logout must tear down or replace the proxy** (stale document cache +
  bootstrap latch) or User B could briefly observe User A's document. Constraint on any
  future logout design, not a current defect.
- **UI-2 dev-principal org reset.** Repeatable browser walk-throughs need three resets
  (DB janitor + Redis **db 1** `ui-state:*` clear + ui-state restart — DLV-11); the
  acceptance suite sidesteps it with `force_restart:true`. Applies to CDO's suite too.

## 6. Lessons

- **Theater tests hide production defects.** The `POST /api/orgs` 500-on-success
  (DUI-3) survived because a characterization test mocked the use case with a fictional
  `{"id","name"}` shape the real code never returned, and ui-state's 500-reconcile rule
  masked it on the live path. It surfaced only when a real API-seam acceptance scenario
  first asserted `201` over the real ingress. Pin characterization tests to the **real**
  return shape (L2, test-refactoring catalog).
- **The API seam can't see handoff defects.** The org-global catalog memo with no
  invalidation (DUI-4) produced a stale "No projects yet" shell after onboarding
  completed — invisible at the API seam, caught only by the live browser pass. Where a
  feature spans navigation + cache, a browser pass is load-bearing, not optional.
- **Defer FINALIZE when a feature is a live initiative's first cut.** Deferring the
  archive until MR-2 merged was correct; the initiative then broadened and the right
  disposition became "precursor," not "standalone finalize." Naming a shared artifact
  (`tests/acceptance/org-onboarding/`) after the first cut left a directory whose name
  now misdescribes its owner — a small cost of shipping the precursor name into a shared
  path.

## 7. References

- Successor: [ADR-050](../../decisions/adr-050-client-driven-onboarding-application-contracts.md)
  (application contracts) + [ADR-048](../../decisions/adr-048-auth-proxy-owns-workos-write-workflow.md) (system) / [ADR-049](../../decisions/adr-049-client-reported-outcome-event-model.md) (domain);
  `docs/feature/client-driven-onboarding/` (active until its own `/nw-finalize`).
- Architecture this feature rode: ADR-044 (ChatApp coordinator), ADR-046 (StateProxy `/state`).
- This feature's artifacts: [`design/delta-and-decisions.md`](design/delta-and-decisions.md),
  [`distill/`](distill/) (roadmap, walking-skeleton, wave-decisions, upstream-issues),
  [`deliver/`](deliver/) (roadmap, execution-log, wave-decisions, upstream-issues).
- Key `main` commits: `e80d7921`, `2b26cfbd` (MR-1); `4b3e5c9b`, `a034659f`, `b0073a96`,
  `c2d96dc8`, `6b66f715` (MR-2); reworked under CDO by `13da5567`, `e5b12217`, `aabaee25`.
