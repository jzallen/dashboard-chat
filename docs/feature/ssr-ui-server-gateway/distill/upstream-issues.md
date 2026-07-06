# DISTILL upstream issues — ssr-ui-server-gateway

Findings where DISTILL work revealed a gap/contradiction in a prior wave's SSOT.

## UI-1 — DISCUSS "reactive reads stay client-side" superseded by ADR-034 amendment

**Prior-wave source (DISCUSS):**
- `discuss/open-questions.md` §"Non-questions" — *"Reactive reads stay in the client
  `DataCatalog`; only cold/initial/static-after-load reads move to server loaders."*
- `discuss/wave-decisions.md` §"Constraints Established" — *"Reactive reads (live
  assistant-transform reflection) MUST stay in the client `DataCatalog`."*

**Newer authority (supersedes):**
- `docs/decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md` §"Amendment
  (2026-06-25)" — *"Derivation stays server-side in the loader; there is no client-side graph
  state and no client-side delta-merge… The project-level 'keep optimistic commits
  client-side + action revalidation' lean recorded during DISCUSS is superseded by this
  stance and should be reconciled to point here."*

**Reconciliation:** Not a live contradiction to block on — the ADR amendment (2026-06-25) is
the later wave decision and explicitly supersedes the DISCUSS lean. The DISCUSS text was
correct at capture time (SSE was staged last precisely because the direct path worked); the
amendment changes the *end-state*, which DC-119 now delivers.

**Action (owned by DC-119 Task D):** annotate the three DISCUSS artifacts above as superseded
and repoint the Linear "Catalog Behind BFF Gateway" project description bullet #1 at the
amendment. Do **not** silently rewrite history — add a dated supersession note that links the
amendment.

**Status:** closed — the three DISCUSS artifacts carry dated supersession notes
pointing at ADR-034 §"Amendment (2026-06-25)"; the Linear "Catalog Behind BFF
Gateway" project description bullet #1 is repointed at the amendment.
