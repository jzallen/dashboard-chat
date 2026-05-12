# ADR-033: Source-Tree and Topology Layer Naming Separation — revert `reverse-proxy/` → `frontend/`

**Status:** Accepted (2026-05-12)
**Date:** 2026-05-12
**Originating wave:** ad-hoc review (post-implementation of ADR-032)
**Companion artifacts:**
- Parent: [ADR-032](adr-032-service-tier-renaming.md) (partially superseded by this ADR)
- Sibling ADRs: ADR-027 (flow-state tier and framework), ADR-030 (flow-state topology and scaling), ADR-031 (frontend-tier transition — Remix alongside nginx)
- Reviewer: nw-solution-architect (foreground critique, 2026-05-12)

## Context

ADR-032 ratified renames at three layers simultaneously:

1. **Docker-compose service names** (topology layer) — `frontend` → `reverse-proxy`, `frontend-remix` → `ui-presentation`, `flow-state` → `ui-state`.
2. **OCI image tags / container names** (topology layer) — `dashboard-chat/frontend:bazel` → `dashboard-chat/reverse-proxy:bazel`, etc.
3. **Top-level source-tree directory names** (source-tree layer) — `frontend/` → `reverse-proxy/`, `frontend-remix/` → `ui-presentation/`, `flow-state/` → `ui-state/`.

Plus knock-on renames (npm package names, Redis key prefix `flow:` → `ui-state:`, tsconfig path aliases, BUILD.bazel labels, CLAUDE.md references, ADR cross-references).

The rename landed on `main` as commits `6988de3..8070d01` in a single atomic MR (`refactor/service-tier-rename`) on 2026-05-12.

Within hours of merge, on-task inspection by the project overseer surfaced a conflation: ADR-032's rationale (§"Decision drivers") is **entirely** topology-layer reasoning — "role over framework," "pair coherence" of UI-adjacent tiers, "strangler-fig survival" of the post-Vue retirement nginx role. Those drivers correctly produce `reverse-proxy`, `ui-presentation`, `ui-state` as topology-layer names. But ADR-032 treated the **source-tree directory rename as a mechanical consequence** of the topology rename rather than as an independent decision.

Under independent analysis, the source-tree rename for `frontend/` → `reverse-proxy/` is wrong: a directory whose content is "60+ React `.tsx` files + Vite config + Tailwind setup + TanStack Query/Table hooks + 7 vitest configs + a `package.json` with `react@18`, `react-router-dom@7`" is a React SPA. The directory's content is **the SPA**, of which the 64-line `nginx.conf` is a small deployment-concern subordinate. Naming the source-tree directory `reverse-proxy/` describes the *deployment vehicle* rather than the *source body* — it is, structurally, the same kind of mislabel as calling `backend/` "fastapi-api" or `agent/` "sse-streamer."

## Decision drivers

- **Two layers, two correct answers.** Source-tree names should describe the body of source they contain. Topology names should describe the runtime role of the container. Both layers' names being correct is the cheapest honest design.
- **Onboarding cost.** A contributor looking for the React SPA grepping for `frontend/` after ADR-032 finds nothing. Running `ls reverse-proxy/src/ui/components/` shows 60+ React component `.tsx` files. This is a stub-your-toe-on-the-onboarding-curve cost paid in perpetuity. The directory name is actively misleading.
- **The two layers don't need to track 1:1.** `docker-compose` supports decoupling via `build.context:` (or, when using Bazel-built images, simply pointing `image:` at a tag that the Bazel target produces from any source-tree path). The `reverse-proxy` compose service can be the runtime identity; the `frontend/` source-tree path can produce the OCI image consumed by that service.
- **Cost asymmetry.** Reverting one directory rename touches ~150–250 files (about one-third of ADR-032's forward migration). Living with the source-tree mislabel forever has higher cumulative cost.
- **ADR-031 strangler-fig survival.** The Remix migration in `ui-presentation/` is preserved (no rename there). The Vue SPA retirement (ADR-031 §4) will eventually retire `frontend/` entirely; at that point `frontend/` becomes empty and a follow-on ADR decides whether the nginx config absorbs into `ui-presentation/` or goes to a leaf `ingress/nginx/` dir.

## Considered options

The architect's analysis (foreground critique, 2026-05-12) generated five options:

1. **Partial revert, keep topology names.** Rename `reverse-proxy/` → `frontend/`. Compose service name `reverse-proxy` stays. `ui-presentation/` and `ui-state/` stay.
2. **One umbrella `frontend/` with three subdirs.** `frontend/spa/`, `frontend/remix/`, `frontend/state/`. Single mental category at the top level.
3. **Partial revert + move `ui-state/` to peer with backends.** Revert `reverse-proxy/`; move `ui-state/` to `services/ui-state/` or peer-level (it's a Hono+Redis BFF, structurally a backend).
4. **Status quo (ADR-032 stands).** Topology-role names at every layer. Accept the misleading source-tree name.
5. **Full domain-stratum reorganization.** Top-level dirs by stratum (`web/`, `bff/`, `services/`, `ingress/`). High blast radius; conflicts with vocabulary established across ADRs 001–032.

## Decision outcome

**Option 1 — partial revert.**

- `reverse-proxy/` directory → `frontend/` (source-tree).
- Compose service name `reverse-proxy` → unchanged (topology).
- OCI image tag `dashboard-chat/reverse-proxy:bazel` → unchanged (topology).
- Container name `dashboard-reverse-proxy` → unchanged (topology).
- Bazel target path `//reverse-proxy:image_tar` → `//frontend:image_tar` (the target lives in the renamed source directory).
- npm package name `dashboard-chat-reverse-proxy` → `dashboard-chat-frontend` (aligns with directory name; package is internal-only, no external consumers).
- npm workspaces array entry `"reverse-proxy"` → `"frontend"`.
- `ui-presentation/` directory → unchanged. Scaffold-only today; ADR-031 strangler-fig lands real Remix there.
- `ui-state/` directory → unchanged. Architecturally a backend-for-frontend service; CLAUDE.md amended to call out its sibling-of-`agent`/`auth-proxy` nature.
- Redis key prefix `ui-state:` → unchanged. Data-plane identifier; ADR-032 changed it to align with the topology service name; that alignment still holds since `ui-state` remains both the source-tree directory and the compose service name.

### Why not Option 2 (umbrella `frontend/{spa,remix,state}`)

The umbrella forces `ui-state/` into a "frontend" category it doesn't structurally belong in. `ui-state/index.ts` is a Hono node server; `ui-state/lib/` contains XState actors, Redis persistence adapters, an orchestrator, and active-scope resolvers. It is the canonical state authority for UI flows but it does not render UIs. Calling it a frontend service is the same mislabel ADR-032 made in reverse — naming it for its consumer rather than its layer. The umbrella does not survive that inspection.

### Why not Option 3 (move `ui-state/` to peer with backends)

Defensible. The architect noted: "if we're correcting source-tree honesty, `ui-state/` is more a BFF than a UI." A `git mv ui-state services/ui-state` (or peer-level with `agent/`/`auth-proxy/`) makes the architectural statement explicit. Two reasons for not doing this in this ADR: (a) blast radius — moving `ui-state/` adds another ~50–100 file touches on top of the `reverse-proxy/`→`frontend/` revert, with the same compose/Bazel/import cascade; (b) the consumer-surface naming has a defensible read — `ui-state/` is named for the surface it exposes to UIs, the same way `auth-proxy/` is named for the surface it proxies authentication for. The CLAUDE.md amendment (this ADR §"Source-tree clarifications") notes the sibling-with-agent/auth-proxy nature without forcing the move. Open question — see §"Open questions" below.

### Why not Option 4 (status quo)

The misleading directory name has unbounded cumulative cost (every new contributor, every grep, every code review). One-time partial revert is cheaper.

### Why not Option 5 (full stratum reorganization)

Disrupts the in-flight Remix migration (ADR-031), churns ADRs 001–032 vocabulary, and conflicts with the Conway's Law fit of a small team. Out of proportion to the problem identified.

## Source-tree clarifications baked into this ADR

CLAUDE.md (top-level architecture section) is amended in this MR to add a one-paragraph preamble distinguishing source-tree from topology layers, then describes each service in source-tree terms with the topology mapping called out where it differs:

- **Frontend** (`frontend/`) — React 18 SPA + Vite + nginx config. Deployed as the `reverse-proxy` compose service.
- **UI-State** (`ui-state/`) — Hono + Redis BFF; architecturally a sibling of `agent/` and `auth-proxy/`. Named for its consumer surface.
- **UI-Presentation** (`ui-presentation/`) — Remix v2 SSR; scaffold today.

## Scope of the rename MR

- **Single atomic MR** (branch: `refactor/source-tree-honesty`).
- **`git mv reverse-proxy frontend`** — preserves history via rename detection.
- **Edited in place** (rough file count: ~25–40 files):
  - `package.json` (root): workspaces array, scripts, npm package name in `frontend/package.json`.
  - `BUILD.bazel` (root + `frontend/BUILD.bazel`): target labels (`//reverse-proxy:image_tar` → `//frontend:image_tar`; the `image_tag = "dashboard-chat/reverse-proxy:bazel"` line stays since that's the compose-facing OCI tag).
  - `eslint.config.js`: glob patterns.
  - `frontend/lint_test.sh`: eslint path.
  - `e2e/run-e2e.sh`: bazel-bin path + `bazel run` target.
  - `.github/workflows/ci.yml`: job name `test-reverse-proxy` → `test-frontend`, bazel test target, disk-cache key.
  - `agent/tsconfig.json`: path alias `@/raqb`.
  - `tools/test/test.sh`: `--ui` selector points at `frontend/`.
  - CLAUDE.md: architecture section + Quick Commands.
  - Code comments referencing the source path (`frontend/src/lib/http/config.ts`, `shared/chat/applyDirective.ts`, several test files).
  - This ADR + amendment to ADR-032.

- **NOT changed:**
  - `docker-compose.yml` service name `reverse-proxy`.
  - `docker-compose.yml` container name `dashboard-reverse-proxy`.
  - `docker-compose.yml` image reference `dashboard-chat/reverse-proxy:bazel`.
  - `frontend/BUILD.bazel:337` `image_tag = "dashboard-chat/reverse-proxy:bazel"`.
  - `frontend/BUILD.bazel:373` `repo_tags = ["dashboard-chat/reverse-proxy:bazel"]`.
  - Historical archives under `docs/evolution/` and `docs/feature/<finalized>/`. Per the historical-accuracy principle ADR-032 set out for ADR cross-references: archives reflect what was true at archive time; we do not retroactively rewrite history to match the latest rename.
  - `.serena/memories/` (local agent memory).

## Consequences

### Positive

- Source-tree honesty: `frontend/` contains the React SPA. Greppable, onboardable, accurate.
- Two layers' names independently correct: contributors browsing the repo see "what's in this directory" honestly named; contributors reading `docker-compose ps` see "what does this container do" honestly named.
- Reversibility property held: a future ADR can re-merge the layers if the divergence proves more confusing than helpful. Cost ≈ same as the forward revert.
- The Bazel image-tag convention (`dashboard-chat/reverse-proxy:bazel`) becomes a single point where the two layers are bridged, with a clear comment in `frontend/BUILD.bazel` explaining the layer crossing.

### Negative

- One additional naming-divergence to remember: the `frontend/` source dir produces the `reverse-proxy` compose service. Mitigated by CLAUDE.md preamble + ADR-033 reference in CLAUDE.md.
- ADR-032 reads as "Implemented" then "partially superseded" within hours, which is faster than ADRs typically iterate. This is honest documentation of the actual decision sequence rather than a sign of process failure; recording the iteration is more valuable than hiding it.
- Historical refs in `.serena/memories/`, `docs/feature/<finalized>/`, and `docs/evolution/` retain `reverse-proxy/` as the source-tree name during a brief window (2026-05-12 morning to 2026-05-12 afternoon). The historical-accuracy principle says this is correct.

### Neutral

- Conway's Law fit for a small team: the team-of-one (and AI workers) is responsible for both source-tree organization and topology decisions. The two-layer split adds one mental model (the divergence), but the divergence itself encodes the layer separation explicitly.
- Future evolution: if the Vue SPA retires per ADR-031 and `frontend/` becomes empty, a follow-on ADR decides whether nginx config absorbs into `ui-presentation/` or migrates to a leaf `ingress/nginx/` directory.

## Reversibility

A second MR git-mv's `frontend/` → `reverse-proxy/` if the divergence proves to cause more confusion than honest naming resolves. Cost ≈ same as this revert. No data-plane migrations (the Redis key prefix `ui-state:` and image tags are decoupled from this decision).

## Open questions

1. **Should `ui-state/` move to a peer position with `agent/`, `auth-proxy/`, `backend/`?** This ADR keeps `ui-state/` where it is with a CLAUDE.md qualifier noting its BFF nature. A reasonable counter-argument is that the source-tree-honesty principle this ADR establishes argues for moving `ui-state/` too. Deferred to a follow-on decision if onboarding pain emerges from the consumer-surface naming. The architect's preference was to be conservative: smaller diff today, correct later if pain emerges.

2. **Should `agent/` be renamed?** The name `agent/` describes the chat-tool dispatcher (Hono + Groq SSE streaming). It does not describe an AI agent in the multi-agent-system sense. The name has historical baggage but does not currently mislead in the way `reverse-proxy/` did. Out of scope for this ADR; flagged for future consideration.

3. **Will the docker-compose `build.context` field need to be added?** The current `reverse-proxy` service in compose uses `image: dashboard-chat/reverse-proxy:bazel` (a pre-built Bazel image), no `build:` block. The Bazel BUILD target at `//frontend:image_tar` produces the image; compose consumes it by tag. No `build.context` change needed. If the override-compose pattern is later applied here (as it is for `auth-proxy` in `docker-compose.override.yml`), the `build:` directive at that point should point at `./frontend`.

## Method note

ADR-032 made a topology-layer decision; ADR-033 makes the corresponding source-tree-layer decision and explicitly identifies the layer separation as the durable design principle. Future renames should ask: "is this a topology question or a source-tree question?" — and decide each layer independently. ADR-033 ratifies that pattern.

This is small for an ADR but addresses a durable architectural pattern (the layer separation) that the codebase will benefit from having named.

## Implementation log

- 2026-05-12 morning: ADR-032 ratified + implemented in single MR (commits `6988de3..8070d01` on `main`).
- 2026-05-12 afternoon: project overseer surfaced the conflation; nw-solution-architect critique produced this ADR's option space + recommendation.
- 2026-05-12 afternoon: ADR-033 implementation MR on branch `refactor/source-tree-honesty`. See merge commit footer once landed via the gastown headless merge queue.
