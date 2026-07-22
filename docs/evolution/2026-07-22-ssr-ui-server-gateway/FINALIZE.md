# Finalize — `ssr-ui-server-gateway`

> **Disposition**: **SHIPPED — standalone evolution entry.** The SSR ui-server
> (backend-for-frontend) gateway landed on `main` incrementally across the
> `catalog-behind-bff` project's **Releases 1–6** (PRs #5, #6, #9, #31, #32, #35,
> #40, #41 plus the DC-104 rename #25 and the DC-193 infra repoint #63), then was
> hardened by the Chat/Assistant design-review passes (DC-159 #42, DC-160 #46/#50,
> DC-162 #52, DC-155 #53). This document archives the DISCUSS/DISTILL wave
> artifacts and records the durable end-state, what was deliberately deferred, and
> the lessons.
>
> **Feature shipped**: incrementally, ~2026-06 through 2026-07 (all slices merged on `main`).
> **Wave path**: DISCUSS (capture-only) → DESIGN *(deferred — no full DESIGN wave; each slice's design was supplied by a per-slice architect plan + dispatch prompt, riding pre-ratified ADR-033/034)* → DISTILL (4 slices) → DELIVER (Releases 1–6) → FINALIZE.
> **`main` HEAD at archive**: `6e7998ea`.
> **Archived artifacts**: this directory (`discuss/`, `distill/`) is the verbatim feature-workspace snapshot, moved here via `git mv` from `docs/feature/ssr-ui-server-gateway/` so blame and rename history survive. (There is no `design/` or `deliver/` subtree — DESIGN was deferred and DELIVER was tracked in the `catalog-behind-bff` Linear releases, not a local `deliver/` folder.)

---

## 1. Summary

`ssr-ui-server-gateway` gives the `ui/` client **one point of integration** — its own
React Router v7 server-side runtime (the **ui-server**, `/ui-server/*` resource routes
and server loaders/actions) — which brokers the downstream backend/agent surfaces
server-side instead of the browser fanning out to `/api`, `/worker`, and `/ui-state`
directly. This is the standard **Backend-for-Frontend** shape (RRv7 loaders/actions +
resource routes), named `ui-server` to mirror `ui-state` (the unspelled `bff` initialism
was dropped in DC-104, [`distill/wave-decisions.md`](distill/wave-decisions.md)).

The migration ran as a **strangler fig** through the `DataCatalog` `dataSource` seam
([`discuss/idea-capture.md`](discuss/idea-capture.md) §"Progressive migration"): each
slice repointed one read/mutation/stream at a ui-server route without rewriting the
components that read from the catalog. It shipped as independently-landable slices:

| Slice | What shipped | Landed |
|---|---|---|
| S1 | Server-side authenticated `/api` client — the shared cookie→Bearer hop through auth-proxy | #5 (`2f9c6966`) |
| S2 | Org-global reads (`projects`, `orgs/me`) move to a server loader (DC-9) | #6 (`dbbd0b12`) |
| S3 | Project-scoped catalog reads → `/project/:projectId` server loader (DC-10) | #9 (`1ca0aefd`) |
| — | Catalog **mutations** through ui-server RRv7 actions + the `/ui-server/chat` SSE relay and chat-wire acceptance test (Release 3) | #31 (`b6e49344`) |
| S6 | Upload + source-creation saga behind the ui-server (DC-13) | #32 (`f8172aeb`) |
| S7 | Onboarding driver behind the gateway (DC-14) | #35 (`5580918c`) |
| slice-4 / DC-119 | Converge the bespoke client write-through onto RRv7 actions; **SSE becomes a pure `revalidator.revalidate()` trigger** (ADR-034 amendment) | #40 (`5dcb2967`) |
| S8 | Retire `backendClient`; assert the single boundary (DC-15) | #41 (`1b042b92`) |
| DC-104 | Rename `ui/` "bff" routes → "ui-server" | #25 (`254b2afb`) |
| DC-193 | Repoint the `web-ssr` + `reverse-proxy` container images from `frontend/` → `ui/` | #63 (`6e7998ea`) |

## 2. Durable end-state (live on `main`)

- **The ui-server is the client's single integration point.** `ui/` reads cold/initial
  data through server loaders and executes mutations through RRv7 actions/resource
  routes under `ui/app/routes/ui-server/*` (`dataset-update`, `dataset-archive`,
  `dataset-restore`, `health`, `chat`, upload/source-creation). `backendClient` is
  retired (S8) and the single-boundary invariant is asserted in tests.
- **Chat SSE relay** — `/ui-server/chat` is an un-buffered passthrough (DWD-3): the
  action pipes the agent upstream's `ReadableStream` back to the client; frame parsing
  stays client-side. The live `AssistantOverlay` path is wired to it (the `setTimeout`
  mock is removed); a `transform_applied` domain event triggers
  `useRevalidator().revalidate()` — proven by
  [`ui/app/__acceptance__/ssr-ui-server-chat-wire.test.tsx`](../../../ui/app/__acceptance__/ssr-ui-server-chat-wire.test.tsx)
  (real overlay + real broker; the agent upstream is the sole stubbed port).
- **Idiomatic RRv7 data lifecycle** — per **ADR-034 §"Amendment (2026-06-25)"** (#28),
  derivation stays server-side in the loader; there is no client-side graph state or
  delta-merge. SSE is a revalidation *trigger* (`revalidator.revalidate()`), not a
  client re-render path. DC-119 deleted the last bespoke client write-through machinery.
- **Ratifies ADR-033** (source-tree topology / runtime-role decoupling) and **ADR-034**
  (frontend coexistence via RRv7 framework mode, incl. the 2026-06-25 amendment).
- **Container wiring** — DC-193 repointed the `web-ssr` + `reverse-proxy` images off the
  retired `frontend/` tree onto `ui/`, closing the "production `ui/` web-ssr image"
  deferred item from slice-1.

## 3. Verification at archive (2026-07-22)

Re-checked against `main` (`6e7998ea`):

- `ui/app/routes/ui-server/` present with `chat`, `dataset-update/archive/restore`,
  `health` routes + their router tests; `ui/app/lib/ui-server-client.ts` present —
  **ui-server boundary confirmed merged**.
- `ui/app/__acceptance__/ssr-ui-server-chat-wire.test.tsx` present and asserts the
  `useRevalidator().revalidate()` trigger on `transform_applied` (slice-4 end state),
  not the old `catalog.revalidateScope()` — **DC-119 convergence confirmed**.
- `docs/decisions/adr-034-...md` §Amendment (2026-06-25) present — **authority confirmed**.

Each slice's own gate (`cd ui && npx vitest run` green, plus `./tools/test/test.sh`)
was enforced at its merge per the DISTILL gate caveat; the acceptance suite is not
re-run here (this is a docs-only archive of already-CI-gated, merged work).

## 4. Upstream issue — reconciled

**UI-1 (closed).** DISCUSS recorded "reactive reads stay in the client `DataCatalog`"
([`discuss/open-questions.md`](discuss/open-questions.md) §Non-questions;
[`discuss/wave-decisions.md`](discuss/wave-decisions.md) §Constraints). ADR-034
§Amendment (2026-06-25) supersedes this (server-side loader derivation; SSE as a
revalidation trigger). Reconciled in DC-119 Task D: the three DISCUSS artifacts carry
dated supersession notes pointing at the amendment, and the Linear project description
bullet was repointed. Full record:
[`distill/upstream-issues.md`](distill/upstream-issues.md).

## 5. Deferred / carried-forward items

- **M2M on-behalf-of — DEFERRED (DWD-2).** The ui-server currently **forwards the
  inbound user credential** (cookie + `authorization`) to auth-proxy, mirroring the
  `ui-state-client` precedent. The captured Phase-4 end-state — the ui-server holding
  service creds, minting M2M, and downstream services dropping browser-JWT trust to
  accept only the ui-server (the "security win banked at the END",
  [`discuss/idea-capture.md`](discuss/idea-capture.md) §Phase 4) — is **not yet
  delivered**. It remains the natural home for the `auth-proxy/lib/m2m.ts`
  identity-attribution TODO.
- **`TerminalAssistant` mock** still scripted (DWD-4 scoped mock-replacement to
  `AssistantOverlay.runScript` only).
- **Post-transform per-node preview hydrate**
  (`GET /api/datasets/{id}?include_preview=true`) — the skeleton proves revalidation is
  *triggered*, not a visible preview-row change.
- **Adopting `@dashboard-chat/shared-chat` zod schema in `ui/`** (DWD-5) — the ported
  SSE reader still carries a minimal local event type to keep the slices thin.
- **Catalog store surface** (OI-3) — whether `subscribe`/`getSnapshot`/
  `useSyncExternalStore` can shrink to loader-seeded reads after write-through removal
  was flagged for re-evaluation; a `use-sync-external-store-shim.d.ts` still ships.

## 6. Lessons

- **A dataSource seam makes strangler-fig migration a repoint, not a rewrite.** Because
  components read from the `DataCatalog` and the transport lived behind its `dataSource`
  abstraction, each slice was "repoint this read/mutation at a ui-server route" — small,
  independently shippable, independently reversible. The indirection *was* the migration
  harness.
- **Sequence the stream relay last, but the priority path first.** SSE-through-hops is
  where the hot-path risk concentrates, so full-collapse SSE migrated last — yet the
  chat SSE relay was tackled *early* as slice-1 because the live assistant-transform path
  was the near-term priority the capture itself flagged. "Hard, last" (end-state collapse)
  and "priority, first" (near-term value) are not in tension when scoped as separate slices.
- **Roadmap `status` fields go stale; git is the source of truth.** The slice-3/slice-4
  roadmap JSON still reads `pending` though the code shipped. Trust merged PRs + the tree,
  not the doc's status field — same caveat the `auth-proxy-mints-user-tokens` finalize made.
- **Defer the security bank honestly.** Forwarding the user credential now and deferring
  M2M-on-behalf-of to a later, explicitly-named phase kept every slice thin and shippable;
  the cost is that the "downstream trusts one caller" win is captured as intent, not yet
  banked — recorded here so it is not mistaken for done.

## 7. References

- Architecture ratified: [ADR-033](../../decisions/adr-033-source-tree-topology-separation.md)
  (source-tree topology), [ADR-034](../../decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md)
  (RRv7 framework-mode coexistence, incl. the 2026-06-25 amendment adopted in #28 `62952609`).
- This feature's artifacts: [`discuss/`](discuss/) (idea-capture, acceptance-criteria,
  JTBD, journey, wave-decisions, open-questions),
  [`distill/`](distill/) (per-slice roadmaps + notes, walking-skeleton, wave-decisions,
  upstream-issues).
- Key `main` commits: `2f9c6966` (S1), `dbbd0b12` (S2), `1ca0aefd` (S3), `b6e49344`
  (Release 3 mutations + chat relay), `f8172aeb` (S6), `5580918c` (S7), `5dcb2967`
  (DC-119 slice-4), `1b042b92` (S8), `254b2afb` (DC-104 rename), `6e7998ea` (DC-193
  infra repoint). Hardening: `b972ca6e` (DC-159), `89230642`/`da658cb5` (DC-160),
  `8056fdc6` (DC-162), `a372f7dc` (DC-155).
- Linear: DC-169 (this finalize), parent DC-163 (nwave cleanup); `catalog-behind-bff`
  Releases 1–6.
