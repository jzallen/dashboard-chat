# DISTILL Upstream Issues — client-driven-onboarding

Findings surfaced while designing the acceptance tests that touch PRIOR-wave
artifacts (DESIGN ADRs, the product SSOT journey, and sibling features). HIGH items
are blockers for a DELIVER step and need architect/user resolution; MEDIUM/LOW are
back-propagation hygiene. None block the DISTILL deliverable for THIS feature (the
org-onboarding acceptance rework stands); they constrain DELIVER and adjacent SSOT.

---

## UPSTREAM-2 — HIGH — AR-7 field pruning breaks the sibling J-002 acceptance suite

**Severity:** HIGH (blocks the CDO-S3 `ReducedContext` pruning at DELIVER).

**What.** AR-7 / ADR-050 §e.3 deletes four `ReducedContext` fields and retires
`resolveInitialScopeFn` (whose last-used-resolution policy "moves to the client").
The DISTILL gate for AR-7 is *"verify no harness reads them before deletion."* That
verification **FAILS**: the sibling acceptance suite
`tests/acceptance/project-and-chat-session-management/` (feature **J-002**) reads
three of the four directly off the ui-state document:

- `test_us202_returning_user_lands_in_last_used_project.py` asserts
  `regions.projectContext.context.most_recent_session_per_project` (lines ~132, ~215)
  and `…context.last_used_resolution_degraded` (line ~417).
- `test_us201_first_time_lands_in_no_projects_empty_state.py` asserts
  `…context.pending_project_name` (line ~334).

**Why it matters.** J-002's acceptance contract observes the **last-used-resolution**
and **pending-create** behaviours *through the ui-state document*. This feature
prunes those document fields and relocates the producing policy
(`resolveInitialScopeFn`) to the client. When CDO-S3 lands, those J-002 assertions
lose their subject — a currently-`@skip`-pending (RED-by-design) suite becomes
**unsatisfiable as written**, not merely still-RED. J-002 also embeds the
last-used-resolution + deep-link-discrimination policy that ADR-049/050 move client-side,
so the conflict is design-level, not just test-level.

**Status note.** J-002's suite is present and skip-marked (lands RED at DISTILL,
DELIVER-unpends per its roadmap); its `docs/feature/project-and-chat-session-management/`
directory was not found at this path (possibly finalized/relocated) — the architect
should confirm J-002's current lifecycle state as part of resolution.

**Needs a decision before CDO-S3 pruning ships. Options:**
1. **Retain the fields** (`most_recent_session_per_project`, `last_used_resolution_degraded`,
   `pending_project_name`) in the document as display snapshots populated by *client
   reports* (consistent with INV-PCO — they become reported display data, not
   resolver output). Smallest blast radius for J-002; the resolver still retires.
2. **Rework J-002's acceptance suite** to assert last-used resolution via the
   backend/client SSOT (the INV-PCO-correct observable) rather than the ui-state
   document — coordinated in the same MR sequence as CDO-S3.
3. **Sequence J-002 behind client-driven-onboarding** and redesign its
   last-used-resolution contract on the client-driven model (largest scope).

**Recommendation:** Option 1 if J-002's last-used UX is still wanted as a
document-visible snapshot (cheapest, INV-PCO-clean); else Option 2. Either way the
deletion of `pending_project_name` (DR-1 — in-flight create retired) is safe to
proceed once J-002's US-201 assertion is reworked, since no in-flight name is
captured server-side anymore.

---

## UPSTREAM-3 — HIGH — WorkOS org-name-uniqueness assumption (carry-forward from DESIGN R1)

**Severity:** HIGH (a DELIVER-validated assumption that changes the failure design if false).

**What.** ADR-048 R1 chose A+B layered failure handling (pre-check + best-effort
compensate) on the **ASSUMPTION that WorkOS does NOT enforce organization-name
uniqueness**. ADR-048 §3 + the DESIGN handoff flag this explicitly: *if false,
compensation becomes mandatory-blocking* (an uncompensated orphan with a duplicate
name would make the client's retry FAIL, breaking the "retry still succeeds either
way" property the acceptance suite encodes).

**Why it matters for DISTILL.** The Spec-5 acceptance scenario
(`test_org_create_failure_retryable.py`) asserts that a retry after a failure
SUCCEEDS — its docstring states "compensated and uncompensated are
client-indistinguishable; the retry succeeds either way." That guarantee holds only
under the no-uniqueness assumption.

**Action (DELIVER, CDO-S2/CDO-S5):** validate WorkOS org-name-uniqueness against the
real IdP (or the documented contract) before the interception ships. If WorkOS DOES
enforce uniqueness: make compensation mandatory-blocking on the org-create failure
path, and the Spec-5 scenario's "uncompensated retry succeeds" clause must be
revisited (an orphan would block the same-name retry).

---

## UPSTREAM-1 — MEDIUM — J-001 journey SSOT encodes the superseded server-actor write model

**Severity:** MEDIUM (back-propagation hygiene; not a blocker — the ADRs are the
binding SSOT for this feature).

**What.** `docs/product/journeys/login-and-org-setup.yaml` (J-001, changelog
2026-05-11) still describes the pre-feature write model: states `creating_org` (with
"re-issuing JWT with org_id claim" + idempotent re-issue retry), events
`org_form_submitted` / `auth_retry_clicked` / `org_created_and_jwt_reissued`,
transition `validation_failed → authenticated_no_org`, and `failure_modes` like
`jwt_reissue_failed_after_org_create`. ADR-048/049/050 (ratified 2026-06-11) and the
user-ratified `design-intent.md` supersede this: org creation's IdP half moves to
auth-proxy interception, the machine becomes client-reported (plain past tense:
`org_created`/`org_not_found`/…), `creating_org` retires, the reissue rides
`Set-Cookie` (not a machine state), and `auth_retry_clicked` retires (AR-5).

**Why non-blocking.** `docs/product/architecture/brief.md` is ALREADY amended for
this feature (§"Context map (amended — client-driven-onboarding, 2026-06-10,
ADR-049)" and the domain/application feature sections). Only the J-001 journey YAML
lags. The acceptance suite is written against the ADRs (the binding SSOT), not J-001.

**Action (back-propagation, low urgency — owner: Mayor, the journey SSOT owner):**
update J-001 to the client-reported model on a future pass, OR add a changelog entry
pointing to ADR-048/049/050 as the superseding authority for the org-setup half.
Recommended: a one-line changelog supersession note now; full rewrite when J-001 is
next touched.

---

## VERIFY notes (DISTILL-time checks pinned by the wave)

- **AR-7 within THIS suite — clean.** The only `access_token` references in
  `tests/acceptance/org-onboarding/` are `driver.mint_dev_jwt` reading the
  `/api/auth/callback` JWT-mint payload (`access_token`/`token`) — the AUTH token
  mint, NOT the pruned `ReducedContext.access_token` projection echo (DR-6). No
  reader of the pruned projection field survives in this suite. (Cross-suite reader
  collision: UPSTREAM-2.)

- **Spec-8 crash-vector reproducibility (informational, see DWD-5).** The
  deterministic 2026-06-10 process-crash vector (`user_rejected` via a re-verify
  failure) is not reproducible at the HTTP port in the dev fake-WorkOS stack. The
  acceptance Spec-8 scenario asserts the user-facing convergence + liveness
  guarantee; the deterministic crash reproduction is a ui-state unit/router test in
  CDO-S3 (recorded so DELIVER does not lose it). Not a blocker.

- **Cause-tag DOM rule + console-log audit (informational).** The "no raw cause tag
  in the rendered DOM" (amendment 2) and the `createLogger` audit narration
  (amendment 3) are browser-pass / DELIVER-unit assertions; this port-to-port suite
  asserts the document/state contracts (re-edit signal present; report-accepting
  error state reached). Recorded as CDO-S5 acceptance criteria. Not a blocker.
