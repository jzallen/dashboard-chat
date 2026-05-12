# ADR-032: Service Tier Renaming — `frontend`/`frontend-remix`/`flow-state` → `reverse-proxy`/`ui-presentation`/`ui-state`

**Status:** Accepted (ratified 2026-05-12)
**Date:** 2026-05-12
**Originating wave:** ad-hoc review (out-of-band of the user-flow-state-machines feature waves)
**Companion artifacts:**
- Sibling ADRs (this thread): ADR-027 (flow-state tier and framework), ADR-030 (flow-state topology and scaling), ADR-031 (frontend-tier transition — Remix alongside nginx)
- Reference critique: `docs/research/review-topology-complexity-2026-05-12.md` Finding #4 (component-justification table for the three tiers)

## Context

ADR-027 introduced the `flow-state` tier as a dedicated Hono service. ADR-031 introduced the `frontend-remix` tier as a separate compose service running alongside the existing `frontend` (nginx + Vue SPA) container during a strangler-fig migration. Today the topology has three service names that mix **what the service does** (`flow-state` — kind of) with **the framework that runs in it** (`-remix`) with **a generic label** (`frontend`).

The names have grown misleading on inspection:

1. **`frontend`** is no longer primarily a frontend asset host. Per ADR-031 it does four reverse-proxy routing rules (`/api/*` → auth-proxy, `/worker/*` → agent direct, `/api/channels/:id/presentation-state` → agent direct, `/health` → auth-proxy), gzip, static-asset caching, late-binding DNS resolution, and SPA static-serving. The proxying surface area exceeds the static-serving surface area; post-migration it'll be **only** reverse-proxy and the name will be entirely vestigial.
2. **`frontend-remix`** bakes the framework choice (Remix) into the service name. ADR-027 §"Decision outcome" explicitly cites reversibility as a chosen property — Remix-to-Next.js port is "1-2 weeks". A name like `frontend-remix` makes that port require a service rename too, defeating the reversibility goal at the topology layer.
3. **`flow-state`** is closer to descriptive but still framework-leaning: it implies "user-flow state" specifically, when the role is broader — the service is the canonical store + projection authority for any flow's UI-relevant state. It also doesn't pair with `frontend-remix` at the topology level; the two tiers' shared concern (the UI) is invisible from the names.

A role-based scheme that survives framework choices and the strangler-fig completion is the right shape.

## Decision drivers

- **Role over framework.** Names should describe what a service is responsible for, not which tool it's currently built with. Survives library/version churn (Remix → Next.js, Vue SPA retirement, etc.).
- **Pair coherence.** The two UI-adjacent tiers (HTML rendering + state authority) should pair visibly. A reader scanning `docker-compose.yml` should see "these two are about the UI" without needing to know the framework history.
- **Strangler-fig survival.** Once the Vue SPA is retired and nginx becomes pure reverse-proxy, the `frontend` name will be actively misleading. Renaming once now (or post Slice 3) avoids a perpetual debt of "this container's name doesn't match what it does."
- **Migration cost is non-trivial but bounded.** Compose service names, container names, image names, Bazel labels, ADR cross-references, the `flow:` Redis key prefix, the on-disk `flow-state/` and `frontend-remix/` directories, env variables (`AUTH_PROXY_URL` is fine; `FRONTEND_REMIX_*` would change), and CI references all need coordinated update. A single PR can do all of it; spreading it across many changes risks half-renamed state.
- **Timing: post Slice 3, not now.** The user-flow-state-machines feature is mid-DELIVER. Slice 2 just shipped; Slice 3 is the architecturally meatiest piece (US-005 orchestrator-actor freeze + replay). Renaming while crew workers are committing against the current names introduces unnecessary merge conflict surface. Single rename PR after Slice 3 lands.

## Considered options

1. **Keep current names.** Zero migration cost. Accepts that `frontend` will be wrong post-migration and that `frontend-remix` couples the topology to the framework.

2. **Rename now, mid-migration.** Maximum clarity right away. Conflicts with in-flight Slice 2/3 work; crew workers' commits reference current names; ADRs 027/030/031 would diverge from compose. Three weeks of merge friction.

3. **Rename post Slice 3.** Single coordinated PR after the user-flow feature is fully shipped. ~2 weeks of misleading names persist; one clean cutover ends them.

4. **Rename only `frontend` (defer the other two).** Cheapest correction of the most-misleading name. Leaves the framework-coupled `frontend-remix` in place. Half-measure; misses the pairing benefit.

5. **Rename everything to single-word names** (`proxy`, `view`, `state`). More terse but `view` and `state` are too generic for a polyglot monorepo with many other "view" and "state" surfaces.

## Decision outcome

**Option 3 — rename post Slice 3, with the role-based scheme.**

| Today | After rename | Why |
|---|---|---|
| `frontend` | `reverse-proxy` | Captures the post-migration role accurately; describes what the service does today (proxy + cache + static) without committing to "frontend assets" semantics it's losing. |
| `frontend-remix` | `ui-presentation` | Describes the role (server-rendering UI presentation layer). Survives Remix → Next.js port without a rename. Pairs with `ui-state`. |
| `flow-state` | `ui-state` | Describes the role (canonical state authority for UI flows). Pairs with `ui-presentation` to make "the UI tier" legible. Loses some flow-specificity but the service was never flow-only by design (J-002–J-007 are coming). |

### Scope of the rename PR

The rename PR touches:

- **Compose:** `docker-compose.yml` service names, container_name directives, depends_on links.
- **Bazel:** image labels (`//frontend:image_tar` → `//reverse-proxy:image_tar`, etc.), BUILD.bazel package names.
- **On-disk directories:** `frontend/`, `frontend-remix/`, `flow-state/` → `reverse-proxy/`, `ui-presentation/`, `ui-state/`. Git mv preserves history.
- **Code references:** imports, env-var defaults, fetch URLs targeting compose-internal hostnames.
- **Redis key prefix:** `flow:` → `ui-state:` (substrate operation; see ADR-030 §"Redis blast radius" — this widens the key-prefix list during the cutover by one. Handle with a one-shot migration that copies live keys under the new prefix, freezes writers under the old prefix, drops old prefix in a second deploy.).
- **ADRs:** 027, 030, 031 get back-references noting the renamed service names with a "(formerly: <old name>)" parenthetical. The original ADR text is not rewritten — historical accuracy is preserved.
- **Documentation:** CLAUDE.md, feature-state architecture docs, this ADR, the topology review (`docs/research/review-topology-complexity-2026-05-12.md`) — annotate or amend.
- **Crew workspaces:** any in-flight crew clones at PR-merge time need to be rebased or recreated. Coordinate via a freeze window: no new `gt crew add` between the rename PR's merge and a 30-minute settling period.

### What the rename does NOT change

- Hono framework choice for `ui-state` (formerly `flow-state`).
- Remix framework choice for `ui-presentation` (formerly `frontend-remix`).
- nginx role / config inside `reverse-proxy` (formerly `frontend`); just the container/service name.
- The Redis key shape under the renamed prefix (only the prefix string changes).
- Service responsibilities, ports, env-var contents, or any architectural property.

### Triggering condition

Execute the rename PR only after **all of**:

- Slice 3 (Step 6 / US-005 expired-token freeze) ships to `origin/main` via the refinery.
- No in-flight crew DELIVER waves on the user-flow-state-machines feature.
- The four follow-up items from `docs/research/review-topology-complexity-2026-05-12.md` (ADR-030 capacity assumptions, auth-proxy multi-upstream story, Redis-HA bead, rebuttal table) have been actioned **or explicitly deferred** — they reference current names and would re-divergence the docs if landed after the rename without coordination.

## Consequences

### Positive

- Topology becomes legible at a glance from `docker compose ps`: "what does each thing do?" is answerable without grep.
- Framework choices become re-pluggable without service-name changes. Future ADR-like decisions (e.g., "switch Remix to TanStack Start") don't cascade into ops.
- The Vue SPA retirement no longer leaves a vestigial `frontend` name. Whenever the SPA is removed, `reverse-proxy` is already the right name.

### Negative

- One coordinated PR has many touch points (compose, Bazel, dirs, code, ADRs, Redis prefix). Higher review burden than a typical change.
- Redis key prefix migration requires a two-deploy dance (write to both, drain old, drop old) — handled by ADR-030's substrate but adds one cutover sequence.
- Historical greppability for `flow-state` is preserved in ADRs but loses live-code grep matches after the rename. Document the rename in CLAUDE.md so future contributors searching for `flow-state` find the pointer.

### Neutral

- All three current names were ratified by prior ADRs (027, 031) as DESIGN-wave decisions. Renaming them post-implementation is consistent with treating architectural decisions as revisable when their downstream consequences (here: clarity at the topology layer) become visible after delivery.
- The names `ui-presentation` and `ui-state` overlap conceptually with the `presentation-state:` Redis prefix owned by the agent (ADR-015). Worth a sentence in the rename PR's commit message naming the distinction: the agent's `presentation-state:` is a chat-directive log (what the chat backend told the UI to render); `ui-state`'s `ui-state:` (formerly `flow:`) is a canonical state-machine log (what step of which flow the user is in). Different ownership, different log shape, different consumer.

## Reversibility

The rename is straightforward to revert if it turns out to cause more confusion than it resolves: a second PR git-mv's the directories back, flips the compose names, and runs the Redis-key migration in reverse. Cost ≈ same as the forward rename. The Redis cutover is the only stateful migration; everything else is name-substitution.

## Method note

This ADR is rated as an architectural decision proper (per ADR-027/030/031 conventions) rather than a chore because it specifies what each service tier IS responsible for, with names as the carrier. The naming itself is the surface change; the substantive content is the role-based partitioning of UI presentation vs UI state vs reverse-proxy concerns — which was implicit in 027/031 but never named at the topology level.
