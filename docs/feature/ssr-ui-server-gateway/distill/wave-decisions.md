# DISTILL Decisions — ssr-ui-server-gateway (Slice 1: live assistant chat wire)

> Outside-In walking skeleton for the FIRST slice of the SSR-as-ui-server progression:
> connect the `ui/` assistant to the live `agent/` rails through a React Router v7
> **server-side resource route** (`/ui-server/chat`), removing the `setTimeout` mock for
> the primary `AssistantOverlay` path. Target tree is **`ui/`** (the new app), NOT
> `frontend/` (retiring). `frontend/` is reference-only.

## Reconciliation (pre-scenario gate)

Read DISCUSS SSOT: `discuss/idea-capture.md`, `discuss/acceptance-criteria.feature`,
`discuss/wave-decisions.md`, `discuss/jtbd-job-stories.md`,
`discuss/journey-ssr-ui-server-gateway-visual.md`, `discuss/open-questions.md`.

- `+ discuss/idea-capture.md`
- `+ discuss/acceptance-criteria.feature`
- `+ discuss/wave-decisions.md`
- `+ discuss/open-questions.md`
- `- docs/product/journeys/*` (not found — no SSOT product dir; brownfield feature)
- `- docs/product/architecture/brief.md` (not found)
- `- discuss/user-stories.md` / `story-map.md` (not found — capture-only DISCUSS)
- `- design/wave-decisions.md` (not found — DESIGN was deferred; the architect
  plan + the dispatching prompt supply the slice design instead)

**Reconciliation result: 0 contradictions.** The DISCUSS capture frames the SSE
relay as Phase 3 ("hardest, last") because the *direct path already works* and the
risk is hot-path scaling at full migration. This slice deliberately tackles the
**chat SSE relay FIRST** — not as the end-state collapse, but as the near-term
priority the capture itself flags (idea-capture.md §"Honest costs / risks": "it is
exactly the assistant-transform path that is the near-term priority"; §Phase-0
NOTE: Phase 0 "unblocks the M2M-clean live-transform skeleton"). We do the
**user-credential-forward** variant now and **defer M2M on-behalf-of** — consistent
with the capture's staging (security banked last, Phase 4). No DISCUSS decision is
violated; we are sequencing within the captured intent, not against it.

## Key Decisions

> **Naming — `ui-server` (formerly `bff`).** The `ui/` server-side resource routes
> that broker the live agent rails are named **`ui-server`** (`/ui-server/*`),
> mirroring `ui-state`. They were originally labelled `bff`; the route prefix,
> filenames, feature slug (`ssr-ui-server-gateway`), and acceptance test were
> renamed to drop the unspelled initialism. Older git history and closed issues may
> still say `bff` — same concept. This is purely a domain-language change; the
> generic "backend-for-frontend" pattern term used elsewhere for `ui-state` and the
> auth-proxy OAuth2 flow is unrelated and unchanged.

- **[DWD-1] Server runtime for `ui/` is enabled (`ssr:false → ssr:true`).**
  Server-side loaders/resource-routes cannot exist while `ssr:false`. This is the
  approved first step (architect decision A, supplied by the dispatching prompt).
  Minimum SSR-safety fixes are made so the app shell + chat path render under SSR;
  broad residual CSR→SSR migration is explicitly out of scope and escalated if
  systemic.

- **[DWD-2] Auth = forward the inbound user credential** (both `cookie` AND
  `authorization` headers) from the resource route to auth-proxy. M2M
  on-behalf-of is DEFERRED. Mirrors the `frontend/app/lib/ui-state-client.ts`
  precedent (forward the user Bearer; auth-proxy injects `X-User-Id`/`X-Org-Id`).

- **[DWD-3] SSE relay is an un-buffered passthrough.** `/ui-server/chat` action calls
  agent `/worker/chat` via auth-proxy server-side and returns
  `new Response(upstream.body, { status, headers })`. The server does NOT read or
  parse the SSE body; frame parsing stays CLIENT-SIDE.

- **[DWD-4] Mock-replacement scope = `AssistantOverlay.runScript` ONLY.**
  `TerminalAssistant` stays mocked this slice (deferred follow-up).

- **[DWD-5] No new dependencies.** The acceptance test uses `vi.stubGlobal("fetch")`
  (NOT MSW — absent from the monorepo) and the ported SSE reader is self-contained
  with a minimal local event type (NOT a new `@dashboard-chat/shared-chat`
  dependency on `ui/`). This keeps the slice thin and avoids lockfile /
  workspace-consistency churn. Adopting the shared zod event schema in `ui/` is a
  named follow-up.

- **[DWD-6] Walking-skeleton test strategy = Strategy B-equivalent (real local +
  faked costly external).** The thinnest faithful proof is a **`ui/` vitest
  integration test**, NOT a Python `tests/acceptance/<feature>/` e2e suite. The
  vitest test exercises the REAL client component (`AssistantOverlay`, mock removed)
  AND the REAL server-side resource-route `action` (the ui-server broker hop) in one
  process; the SOLE mock is the true downstream port — auth-proxy's `/worker/chat`
  agent upstream — stubbed via `fetch`. This is port-to-port (client driving port →
  server broker → mocked downstream port) and makes TBU defects structurally
  impossible without standing up four containers. A Python e2e suite would require a
  live `vite dev` + auth-proxy + agent + backend stack and is heavier than faithful.

  Placement: under `ui/app/` (vitest `include: app/**/*.test.{ts,tsx}`) at
  `ui/app/__acceptance__/ssr-ui-server-chat-wire.test.tsx`. Tagged conceptually
  `@walking_skeleton @real-io` (real component + real broker; faked agent port).

  **What the fake CANNOT model** (honest limits): real SSE backpressure across an
  actual HTTP hop, auth-proxy header injection, agent Groq tool-calling latency, and
  real `transform_applied` persistence. Those are validated manually in the `ui/`
  `vite dev` loop (architect decision) and deferred to later phases.

## Gate caveat (carried into DELIVER)

`tools/test/test.sh --auto` maps `ui/` changes to the `--backend` gate, so the
refinery will **NOT** run `ui/` vitest. Local `cd ui && npx vitest run` green is
MANDATORY and on the crafter before `gt mq submit`.

## Deferred / escalated (surfaced at submit)

- `TerminalAssistant` mock (still scripted).
- Post-transform per-node preview hydrate
  (`GET /api/datasets/{id}?include_preview=true`) — known follow-up; the skeleton
  proves revalidation is *triggered*, not a visible preview-row change.
- M2M on-behalf-of (DWD-2).
- Production `ui/` web-ssr image + nginx containerization.
- Residual SSR-safety hardening beyond the chat path (if systemic).
- Adopting `@dashboard-chat/shared-chat` zod schema in `ui/` (DWD-5).

---

# DISTILL Decisions — slice-4: catalog write-through convergence (DC-119)

> The end-state counterpart to slice-1. Slice-1 stood up the `/ui-server/chat` SSE relay and
> added `catalog.revalidateScope()` as the reflection seam. Slice-4 **converges that seam and
> the remaining write surface onto RRv7 idioms** and deletes the bespoke write-through, per
> **ADR-034 §"Amendment (2026-06-25)"**. Roadmap:
> [`slice-4-catalog-write-through-convergence-roadmap.json`](./slice-4-catalog-write-through-convergence-roadmap.json).
> Notes: [`slice-4-catalog-write-through-convergence-notes.md`](./slice-4-catalog-write-through-convergence-notes.md).

## Reconciliation (pre-scenario gate)

**Result: 1 contradiction, resolved by newer authority — not blocking.** DISCUSS
(`open-questions.md` §Non-questions; `discuss/wave-decisions.md` §Constraints) records
"reactive reads stay client-side"; ADR-034 §Amendment (2026-06-25) supersedes it
(server-side loader derivation, no client graph state). The reconciliation action is in
DC-119 scope (Task D). Logged in
[`upstream-issues.md`](./upstream-issues.md) as UI-1.

## Key Decisions

- **[DWD-7] Dead-code deletion, not repointing.** The S5 `/api` write ports
  (`renameModel` / `setModelName` / `toggleAuditEntry`) are **deleted** — DC-12 already moved
  their call sites to `useFetcher`. They are not repointed at `/ui-server`.

- **[DWD-8] Archive/restore convergence reuses existing routes.** `POST
  /ui-server/datasets/:id/archive|restore` and the `metadataApiSource` archive/restore ports
  already target `/ui-server` (built in S4). Only the *call sites* move onto `useFetcher`
  (`Upload/hooks.ts`, `ColdStorage/hooks.ts`); the bespoke `client.ts` archive/restore +
  optimistic Cold-Storage machinery are then deleted. The "just-archived stays visible"
  affordance is preserved **loader-side**, replacing the `preserveCold` client flag.

- **[DWD-9] SSE trigger = `revalidator.revalidate()` by default.** Replaces
  `catalog.revalidateScope()`. Scoped `fetcher.load()` is the measured fallback for
  high-frequency `row_*` events only (ADR-034 stance). The captured-pid fence is replaced by
  RRv7 loader re-runs keyed on `:projectId` — proven via a router-navigation test, not assumed.

- **[DWD-10] Walking-skeleton: none (refactor).** Per methodology a WS is features-only.
  The single acceptance seam is the **existing** `ui/app/__acceptance__/ssr-ui-server-chat-wire.test.tsx`,
  **re-pointed** in Task C to assert the `revalidator` trigger rather than
  `catalog.revalidateScope`. Test strategy otherwise inherits DWD-6 (real component + real
  broker; `/api` port stubbed via `fetch`).

- **[DWD-11] One story, four task sub-issues.** DC-119 is one story → one story branch → one
  PR into `catalog-behind-bff/release-6`. Tasks A→B→C are sequential (shared `client.ts`);
  Task D is independent. The tasks land as commits, not separate PRs (linear-cyrus branching).

## Open items (carried into DELIVER)

- **OI-1** source-node rename is local-only (no backend/`/ui-server`) — keep a narrowed,
  decoupled source-local rename or remove; decide during Task A/B.
- **OI-2** trigger granularity (whole-loader vs scoped `fetcher.load`) — measured in Task C.
- **OI-3** whether the catalog store still needs `subscribe`/`getSnapshot`/`useSyncExternalStore`
  after write-through removal — re-evaluate at the end of Task C.

## Gate caveat (carried)

Same as slice-1: `tools/test/test.sh --auto` routes `ui/` to `--backend`, so
`cd ui && npx vitest run` green is MANDATORY on the crafter before submit.
