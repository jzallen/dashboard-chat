# Upstream Issues — DISTILL — `user-flow-state-machines`

> **Wave**: DISTILL
> **Date**: 2026-05-11
> **Acceptance Designer**: Quinn

Items raised by DISTILL that need attention in adjacent waves. None
block the acceptance suite shipping; each is annotated with the wave
that owns the resolution.

---

## REC-1 — `kpi-contracts.yaml` is missing

**Severity**: LOW (soft gate per skill)
**Owner**: DEVOPS (platform-architect)
**Where**: `docs/product/kpi-contracts.yaml` (to be created)

`discuss/outcome-kpis.md` enumerates K1-K5 with measurement plans, but
no machine-readable contract exists for what events the flow-state
tier MUST emit. `@kpi`-tagged scenarios in this suite currently
assert the *name* of the event the tier emits (e.g.
`welcome_page_rendered`), not its shape against a pinned schema.

DEVOPS should:

1. Create `docs/product/kpi-contracts.yaml` covering the 7 FE events
   and 2 auth-proxy events from `outcome-kpis.md §Handoff to DEVOPS`.
2. Pin each event's payload shape (Zod schema or JSON Schema).
3. Re-run DISTILL's `@kpi` scenarios with shape assertions enabled.

---

## UI-1 — `POST /api/auth/reissue` presence unverified

**Severity**: HIGH (blocks Slice 1 step 2 — US-002 happy path)
**Owner**: DELIVER (software-crafter spike) OR DESIGN re-amend
**Where**: `backend/app/routers/auth.py` (read; if absent, add)

`design/handoff §O1` notes this endpoint may not exist; recommends a
10-minute spike to confirm. The acceptance scenarios assume the
endpoint is callable idempotently with `{ org_id }` and returns a
JWT carrying the `org_id` claim.

If the endpoint is absent:
1. Backend adds it as a small leaf delta (no new ADR — the contract
   is already specified in ADR-029's invariant 4).
2. The slice 1 step 2 ticket (per `roadmap.json`) carries this work.

The walking skeleton (slice 1 step 1) is NOT affected — Maya reaches
`authenticated_no_org`, not `ready`.

---

## UI-2 — `frontend-remix` deferred until Slice 2

**Severity**: MEDIUM
**Owner**: DELIVER (slice 2 ticket)
**Where**: `roadmap.json` step 4 / 5

The compose stack includes `frontend-remix` per ADR-031, but Slice 1's
walking skeleton drives the flow-state tier directly via the TS
harness over HTTP through auth-proxy — no browser, no Remix loader
executed. This is correct for the walking skeleton (it answers "can a
new user accomplish org setup via the server-owned flow?"), but it
means `frontend-remix` is not adapter-integration-tested until Slice 2.

Slice 2 step 4 (US-003 recoverable error UX) is the first scenario
that requires the browser to render from the Remix loader. Slice 3
step 6 (US-005 cross-flow FREEZE banner) requires Playwright to
verify the non-blocking banner appears within 100ms — DISTILL writes
the scenarios in Gherkin but flags that DELIVER may need to add a
Playwright driver alongside Cucumber for those scenarios.

---

## UI-3 — Option D vs Option B FE framework ratification pending

**Severity**: LOW (test contract is framework-agnostic)
**Owner**: User (DESIGN ratification)

Per `design/handoff-design-to-distill.md`, the acceptance tests are
framework-agnostic — they drive the four-piece contract on the
flow-state tier, which is identical under both Option D (Remix
loaders) and Option B (ScopeProvider). DISTILL ships against either
choice. Resolution does not block this wave.

---

## UI-4 — DEVOPS `environments.yaml` is absent

**Severity**: LOW (Dim 8 Check B)
**Owner**: DEVOPS (platform-architect)

Per `nw-ad-critique-dimensions` Dim 8b, env-to-scenario mapping uses
default environments (`clean`, `with-pre-commit`, `with-stale-config`)
when DEVOPS has not produced `environments.yaml`. DWD-7 documents the
defaults used. When DEVOPS lands, DISTILL re-runs the mapping check.
