# org-onboarding — DISTILL wave decisions

Decisions made during DISTILL (DWD-N). Upstream decisions D1–D6 (the feature inputs) live
in `../design/delta-and-decisions.md`.

## DWD-1 — Walking Skeleton strategy: C (real local / `@real_io`)

**Decision:** the acceptance suite uses **real adapters end to end** — the local compose
stack (backend + ui-state + Redis + auth-proxy) reached over real HTTP through the
user-facing ingress. No in-memory doubles.

**Why:** the feature's dependencies are a real DB (`organizations`/`projects` rows,
`created_by` linkage), real ui-state machine settling, and real auth-proxy identity
injection. The onboarding correctness this feature delivers (empty-org → onboarding →
app entry) only exists at the integration seam; in-memory doubles would model away the
exact wiring (DEV_NO_ORG DB resolution, the 404→needs_org derivation) under test.

**Decision-tree path:** feature has costly/stateful external dependencies but they are
**local container services** (no paid APIs, no LLM in this slice) → Strategy C.

**Tagging:** every scenario is `@real_io @needs_compose_stack`. The single
`@walking_skeleton` scenario is the full happy path (org-less principal → org → default
project → app entry).

**What the doubles cannot model (N/A):** no doubles are used. The trade-off accepted is
that the suite **skips** when the stack is down (it never runs in a no-stack CI/gate),
which is acceptable because acceptance suites are run locally/by the agent before DELIVER,
not by the refinery queue (CLAUDE.md).

## DWD-2 — Seam: API-level (ui-state `/state` + backend `/api`), not a browser spec

**Decision:** drive the journey at the **HTTP API seam** (mint dev JWT → `session_begin` →
`org_form_submitted` → `create_project_submitted`, asserting region states + app-DB side
effects), not via a Playwright browser spec.

**Why:** the API seam is the most honest port that still proves the cross-service wiring
(auth-proxy → ui-state → backend) where TBU defects hide, while staying fast and free of
browser/SSR-asset flakiness. A browser spec would add the `ui/` render layer but also the
docker-stack + asset-hash fragility noted in project memory, for little additional
onboarding-correctness signal. The `ui/` render behaviour (route gate, form) is covered by
non-gated vitest scaffolds named in the roadmap (S3/S4).

## DWD-3 — Scaffolding: none required (HTTP-level tests, no production-module imports)

**Decision:** Mandate 7 RED-ready scaffolds are **not** created.

**Why:** the acceptance tests import only `httpx` + the suite's own `driver.py` — they make
**no imports of unimplemented production modules**, so there is no `ImportError`/BROKEN
risk. They are RED (assertion failures) when the stack is up and the feature is unbuilt,
and SKIPPED when the stack is down — never BROKEN. Backend RED scaffolds are deliberately
kept OUT of the gated path (no RED files under `backend/`); the only backend test change
(updating the auto-create assertion) is a DELIVER action in S1 so the gate stays green
during DISTILL.

## DWD-4 — One-at-a-time mapping via slice markers, not auto-skip

**Decision:** non-skeleton scenarios are tagged with their DELIVER slice marker
(`s1_backend` / `s3_ui_onboarding` / `s4_ui_default_project`) and a `pending` marker, but
are **not** auto-skipped. They run RED together.

**Why:** for an HTTP acceptance suite that DELIVER runs as a whole to verify progress,
all-RED-together is the honest signal and the slice markers preserve traceability
(`pytest -m s1_backend` selects the slice's scenarios). The crafter un-RED's them by
landing slices, not by toggling skips.
