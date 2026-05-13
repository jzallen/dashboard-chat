# JTBD Opportunity Scores — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS
> **Date**: 2026-05-13

Importance × satisfaction-gap scoring of the J-002 job stories. The
score formula is **importance + max(importance − satisfaction, 0)**
(ODI-style). Scores ≥15 are "under-served" (high opportunity);
10–14 "marginal"; <10 "appropriately served."

Scoring is **provisional** — DISCUSS-derived from in-repo evidence
and team intuition, not interview-validated. A formal DIVERGE pass
(if/when revisited) would interview real users to confirm
importance and measure satisfaction. For now:

* **Importance** reflects user + cross-job-amortization impact
  intuition.
* **Satisfaction** reflects the *current observable state* of the
  product surface (evidence cited).

---

## Opportunity table

| # | Job story | Importance | Satisfaction | Score | Status |
|---|---|---|---|---|---|
| J002-Job-1 | Resume — return to last-used project | 9 | 2 | 16 | **under-served** |
| J002-Job-2 | Switch projects without bleeding context | 9 | 3 | 15 | **under-served** |
| J002-Job-3 | Open a deep link cold | 8 | 3 | 13 | under-served (borderline marginal) |
| J002-Job-4 | Resume a session with dataset context restored | 8 | 2 | 14 | under-served |
| J002-Job-5 | Start a fresh conversation cleanly | 6 | 5 | 7 | appropriately served |
| J002-Job-6 | Stay scoped during a chat turn (agent receives `active_scope`) | 8 | 1 | 15 | **under-served** |
| J002-Job-7 | Switch dataset context inside a session | 7 | 4 | 10 | marginal |
| J002-Job-8 | Survive a token expiry without re-submitting | 7 | 5 | 9 | appropriately served (inherits J-001's `expired_token`) |

## Evidence for satisfaction scores

* **J002-Job-1 (sat 2)** — There is no `last_used_project` signal
  surfaced anywhere; `frontend/app/routes.ts:18-34` shows the
  app-shell index renders a generic ChatView with no pre-resolved
  project. Sat=2: a returning user gets to a useful surface only by
  manual navigation.
* **J002-Job-2 (sat 3)** — Project switching today works (the routes
  exist; the FE rerenders), but the race named at `adr-027:14` is
  not yet retired. Sat=3: it functions but is flaky.
* **J002-Job-3 (sat 3)** — Deep links resolve at the route level but
  with a flicker. Sat=3: works but visibly imperfect.
* **J002-Job-4 (sat 2)** — Session resume is documented in Gherkin
  (`features/chat-first-ui.feature:109-113`) but
  `update_session.py:50-52` shows there is no dataset-context column
  to restore from. Sat=2: documented but unimplemented.
* **J002-Job-5 (sat 5)** — "New Session" already creates a session
  and shows the chat input
  (`features/chat-first-ui.feature:36-41`). The empty-session-row
  accumulation is a minor wart, not a friction. Sat=5: works
  acceptably.
* **J002-Job-6 (sat 1)** — `agent/lib/chat/handleChat.ts:75`
  destructures `project_id` from the request body with no validation
  against the JWT. Cross-tenant project pollution is possible by a
  malformed client. Sat=1: zero current enforcement.
* **J002-Job-7 (sat 4)** — `resolve_dataset` works
  (`agent/lib/chat/tools.ts:13-22`) but the FE state for "currently
  resolved dataset" is scattered. Sat=4: the agent-side mechanism is
  solid; the FE-side persistence is shaky.
* **J002-Job-8 (sat 5)** — J-001's `expired_token` side-state ships
  the FREEZE/THAW infrastructure. J-002 inherits it; the cost is one
  handler. Sat=5: substrate is in place.

## Implications for slice prioritization

The four "under-served" jobs (J002-Job-1, J002-Job-2, J002-Job-4,
J002-Job-6) shape the carpaccio sequencing in `story-map.md`:

* **Slice 1 (Walking skeleton)** targets J002-Job-1 + J002-Job-3 —
  the foundation (`active_scope.project_id` resolves correctly on
  sign-in + deep-link).
* **Slice 2 (Session list + resume)** targets J002-Job-4 — restores
  dataset context on session resume.
* **Slice 4 (Project switching + agent contract)** targets
  J002-Job-2 + J002-Job-6 — atomic switching AND the agent
  enforcement landing for the first time.

The lower-scored jobs (J002-Job-5 + J002-Job-8) drive Slices 3
(new session lifecycle) and 6 (FREEZE/THAW) respectively, both
deliberately lower priority because the substrate has already done
most of the work.

`prioritization.md` carries the full slice-ordering rationale.
