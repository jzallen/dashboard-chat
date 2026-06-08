# org-onboarding — upstream issues (DISTILL back-propagation)

Gaps / contradictions discovered while reading the accepted ADRs + code to write the
acceptance tests. Severity reflects DELIVER risk, not effort.

---

## UI-1 — `create_project_submitted` carries the project name in a field named `org_name` (HIGH)

**Where:** `ui-state/lib/machines/project-context/machine.ts` + `setup/types.ts`.

The project-context machine's first-project event is typed as
`{ type: "create_project_submitted"; org_name: string }`, and `creating_project`'s
invoke input reads `org_name: context.pending_project_name`. The field that carries the
**project** name is literally named `org_name` — a misnomer carried over from copy/paste.

Meanwhile the shared wire schema (`shared/ui-state-wire/wire-event.ts`) has **no named
member** for `create_project_submitted` — it falls through the catch-all
`{ type: string; payload?: Record<string, unknown> }`, and the router forwards it as
`child_event: { type, payload }`. So the FE posts
`{ type: "create_project_submitted", payload: { ... } }`, but it is **ambiguous which key
inside `payload`** the machine's `capturePendingProjectName` action reads (`name`?
`org_name`? top-level vs under `payload`?).

**Why it matters:** if `ui/` posts the name under the wrong key, the machine captures an
empty `pending_project_name` → `createProject` → `POST /api/projects` with an empty name →
backend validation failure (422). This is exactly the "empty-name project → backend
validation fail" trap the feature decisions warned about for `create_project_clicked`.

**Mitigation taken in DISTILL:** the acceptance tests post the name under **both** `name`
and `org_name` keys so the scenario is robust to whichever the implementation reads. This
is a stopgap, not a fix.

**Ask for DELIVER (S4):** verify, in code, exactly which key + nesting
`capturePendingProjectName` reads, and either (a) add a named member to the wire schema
for `create_project_submitted` with a clearly-named `project_name` field, or (b) document
the `org_name`-means-project-name quirk at the FE post site. Reconcile so the submitted
name reaches `pending_project_name`.

---

## UI-2 — No reset affordance for the dev principal's org → acceptance runs are not repeatable (MEDIUM)

**Where:** `backend/app/routers/organizations.py` (no `DELETE`), DEV_NO_ORG resolution (D1).

DEV_NO_ORG resolves the dev principal's org by `created_by == dev-user-001`. Once any test
creates an org owned by that principal, every subsequent "empty-org" scenario resolves the
existing org → `needs_org` no longer holds, and those scenarios go RED for the *wrong*
reason (state pollution, not a missing feature). There is no `DELETE /api/orgs` and no
test-only reset endpoint today.

**Impact:** the suite is reliable on a **fresh backend DB** (first run) but not across
repeated runs in the same DB. The `fresh_dev_principal` fixture documents the precondition
but cannot enforce it.

**Ask for DELIVER (S1):** provide a repeatable-run affordance — either run the acceptance
suite against an ephemeral DB (compose profile / fresh volume per run), or add a test-only
reset (e.g. a `DEV_NO_ORG`-gated `DELETE /api/orgs/me` or a fixture that truncates the dev
principal's org + projects via `docker exec`). Mirror the sibling suite's
`clean_projects_for_dev_user` pattern (it deletes projects via `docker exec dashboard-api
curl`).

---

## UI-3 — SSE auth under CSR + Bearer: `EventSource` cannot set an Authorization header (MEDIUM)

**Where:** `frontend/app/lib/state-proxy.ts` (`openStream`), ported to `ui/` in S2.

The `frontend/` proxy opens the SSE stream with `new EventSource(url, { withCredentials:
true })` — cookie auth. `ui/` uses a **localStorage Bearer**, and the `EventSource` API
**cannot attach an `Authorization` header**. So the ported `GET /state/stream` cannot carry
the Bearer the same way the POST/GET calls do.

**Why it matters:** if `/ui-state/state/stream` requires the Bearer, the SSE subscription
401s under CSR and live updates never arrive (the onboarding surface would still work off
each POST's settled document, but lose push updates).

**Ask for DELIVER (S2):** confirm how auth-proxy authenticates the SSE GET for a CSR
client. Options: (a) a short-lived token query param on the stream URL, (b) rely on the
POST-settled document + periodic `GET /state` instead of SSE for the onboarding surface
(onboarding is short-lived; push may be unnecessary), or (c) an EventSource polyfill that
supports headers. The acceptance tests assert off the **POST-settled documents**, so they
do not depend on SSE — but the production surface needs a decided answer.

---

## UI-4 — `created_by` is not exposed on any read surface (LOW / informational)

**Where:** `backend/app/use_cases/organization/get_organization.py` (OrgSettings response).

The OrgSettings response (`GET /api/orgs/me`) does not include `created_by`. The acceptance
suite therefore asserts ownership **indirectly** — via the DEV_NO_ORG resolution behaviour
(after creation the same principal resolves the org). The **direct** column assertion
(`organizations.created_by == user.id`) lives in the gate-tested backend unit test (S1).
This is intentional (no need to leak ownership onto the wire), recorded so DELIVER does not
"fix" the acceptance test by adding `created_by` to the response.

---

## Reconciliation result

No contradictions between the accepted ADRs (044/046) and the feature decisions
(D1–D6). The wire contract, region flow, and event vocabulary are consistent with the
acceptance scenarios. The items above are **gaps to close in DELIVER**, not blockers to
DISTILL — the acceptance suite is written to be honest and RED against current code while
remaining robust to UI-1 and independent of UI-3.
