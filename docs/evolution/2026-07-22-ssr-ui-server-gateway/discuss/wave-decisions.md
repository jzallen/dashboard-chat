# DISCUSS Decisions — ssr-ui-server-gateway

> **Mode: CAPTURE-ONLY.** This DISCUSS wave preserved a brainstormed architecture
> direction into faithful idea-preservation artifacts. It deliberately produced
> NO DESIGN-wave outputs (no ADRs, no C4, no application/system architecture, no
> API/endpoint/state-machine design, no sequence diagrams, no technology
> selection beyond what the brainstorm stated). A separate architect plans the
> first slice.

## Key Decisions

- **[D1] Capture, do not design.** The user was thinking out loud about an
  architecture direction (SSR server as a single-integration-point ui-server) and
  wanted it checkpointed so it is not lost. Scope held to preservation. (see:
  [`idea-capture.md`](./idea-capture.md))
- **[D2] Idea preserved verbatim-in-substance.** `idea-capture.md` reproduces the
  brainstorm — background, core idea, feasibility verdict, honest costs/risks,
  the Phase 0→4 strangler-fig migration, safety mechanics, and the
  which-data-goes-where principle — organized only lightly with headings, no
  editorializing. (see: [`idea-capture.md`](./idea-capture.md))
- **[D3] Genuinely-undecided points recorded as open questions, not invented
  answers.** SSE relay mechanics, ui-state collapse, on-behalf-of scoping,
  latency budget, auth-proxy's end-state role, preview hydrate, flip mechanism,
  and ui-server credential handling are all left for DESIGN. (see:
  [`open-questions.md`](./open-questions.md))
- **[D4] Decided points flagged to prevent re-litigation.** Reactive reads stay
  client-side; SSE last; security banked last; Phase 0 is the shared
  prerequisite; a slice is a repoint not a rewrite. (see: Non-questions in
  [`open-questions.md`](./open-questions.md))

## Requirements Summary

- **Primary jobs/user needs:** one stable client integration surface (the SSR
  server as a ui-server); downstream services trusting one M2M caller instead of
  browser-forwarded JWTs; real data on first paint; collapsing the 4-fetch
  lineage waterfall into one response; migrating one read/mutation/stream at a
  time with independent rollback; a Phase-0 seam that simultaneously de-risks the
  ui-server and unblocks the live assistant-transform skeleton. (see:
  [`jtbd-job-stories.md`](./jtbd-job-stories.md))
- **Walking skeleton scope:** Phase 0 — stand up the ui-server seam for ONE downstream
  read (illustratively `/ui-server/orgs/me`) via M2M + on-behalf-of, zero blast radius,
  direct path untouched. Not designed here; named as the captured starting point.
- **Feature type:** cross-cutting (frontend SSR/ui-server + auth/identity + downstream
  service trust), captured at the architecture-direction level.

## Constraints Established (from the brainstorm, not invented)

> **Superseded (2026-06-25).** The first constraint below ("reactive reads MUST
> stay in the client `DataCatalog`") is superseded by
> [ADR-034 §"Amendment (2026-06-25)"](../../../decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md):
> derivation stays server-side in the loader and SSE is a revalidation *trigger*,
> with no client-side graph state. Preserved as captured; not rewritten.

- Reactive reads (live assistant-transform reflection) MUST stay in the client
  `DataCatalog`; only cold/initial/static-after-load reads move to server
  loaders.
- The SSR node server moves onto the hot path for everything once migration
  completes; SSE relay is the hard, last part and concentrates the hot-path risk.
- The old direct path stays alive until each ui-server slice is proven; every slice is
  independently shippable and reversible (carpaccio, merge-queue cadence).
- The `DataCatalog` `dataSource` abstraction is the strangler-fig harness — a
  slice is a repoint, not a component rewrite.
- The security tightening (downstream dropping browser-JWT trust) is banked at
  the END (Phase 4), after every path is proven.

## Upstream Changes

- None. No DISCOVER/DIVERGE artifacts existed for this feature; nothing was
  back-propagated. This wave bootstrapped the feature's DISCUSS SSOT.

## Artifacts produced

| Artifact | Path |
|----------|------|
| Idea capture (committed FIRST) | [`idea-capture.md`](./idea-capture.md) |
| JTBD job stories | [`jtbd-job-stories.md`](./jtbd-job-stories.md) |
| Architecture-journey sketch (Phase 0→4) | [`journey-ssr-ui-server-gateway-visual.md`](./journey-ssr-ui-server-gateway-visual.md) |
| Given-When-Then acceptance criteria | [`acceptance-criteria.feature`](./acceptance-criteria.feature) |
| Open questions | [`open-questions.md`](./open-questions.md) |
| This summary | `wave-decisions.md` |

## Next Wave

DESIGN (architect) — to plan the first slice (Phase 0 seam) and answer the open
questions. No DESIGN artifacts were produced in this capture-only wave.
