# ADR-045: Collapse the Three Per-Machine Read Projections into One Composite chat-app Read Surface

**Status:** Proposed (DESIGN, propose-mode — options presented with a recommendation; awaiting user ratification before DELIVER). Passed the nw-design gate review (nw-solution-architect-reviewer, 2026-05-29): all three blocking design items — composite mount mechanism (CRITICAL-1), composite mapper/SSE seam + `sequence_id` semantics (CRITICAL-2/HIGH-2), and auth-proxy sniffer shape-detection (HIGH-3) — confirmed RESOLVED in specification, no new issues. The reviewer's residual code-correspondence checks (sniffer ternary in `auth-proxy/app.ts`, the new mapper/type/router) are **DELIVER-wave work**, itemized in the phased plan (MR-A…MR-G); this is a DESIGN-only artifact and intentionally lands no code.
**Date:** 2026-05-29
**Originating wave:** DESIGN — resolves the read-side question left open by ADR-044
**Author:** Morgan (nw-solution-architect), propose-mode; grounded in `docs/research/xstate-react-backend-integration.md` (Nova, RESEARCH)
**Scope:** Application architecture — the published read interface of the `ui-state` container + a phased, in-repo migration. No container-topology delta (ADR-030/033/034 unchanged).

**Resolves:** **ADR-044 §5 Open Question #3** — *"Unify the external projection wire (one ChatApp projection instead of per-machine) — a follow-on FE + auth-proxy story, not required for the pivot."* This ADR marks OQ#3 **RESOLVED** (see §9).

**Relationship to prior ADRs:**
- **ADR-027** (per-machine `FlowProjection` wire contract) — the frozen 7-field envelope is **preserved verbatim as the value of each `machines[*]` slice** of the composite. The composite is a strict superset around the existing contract, not a replacement of it. The collapse is the FE+auth-proxy ripple ADR-027 §"Negative" and its delta-encoding OQ#3 anticipated.
- **ADR-030** (single-replica, in-process actors; `flow_id = <machine>:<principal_id>`) — **unchanged.** The composite reads the same single per-principal actor in the same process; identity is the same derived `X-User-Id`. No topology, scaling, or `flow_id` delta.
- **ADR-040** (hexagonal transport; canonical-name registry + migration-safe alias map; "flows addressed by verified identity, not client `flow_id`") — the migration strategy here **reuses ADR-040's additive-mount-then-retire mechanism**; the terminal cleanup is sequenced alongside ADR-040 **LEAF-6** (alias-map removal). Identity stays header-derived (no client `flow_id`, no `:principal` path param).
- **ADR-044** (ChatApp coordinator; hybrid snapshot + audit-log persistence; derived-view projection) — this is the **read-side completion** of ADR-044. The write side is already unified (§4); only the read projections are collapsed. The byte-stable derived-view mapper (`deriveProjection`) is **reused**, not replaced.

---

## Context

Today one per-principal `ChatApp` actor (ADR-044) already serves **all writes** through a single registry, but it publishes **three independent read projections**, each at its own wire path with its own SSE stream (ADR-027 frozen contract):

| Wire machine name (alias) | Child slice | Read path |
|---|---|---|
| `login-and-org-setup` (`session-onboarding`) | `onboarding` | `GET /ui-state/flow/login-and-org-setup/projection` (+ `/stream`) |
| `project-and-chat-session-management` (`project-context`) | `project-context` | `GET /ui-state/flow/project-and-chat-session-management/projection` (+ `/stream`) |
| `session-chat` | `session-chat` | `GET /ui-state/flow/session-chat/projection` (+ `/stream`) |

Each path returns the ADR-027 `FlowProjection` (`flow_id`, `state`, `context`, `active_scope`, `sequence_id`, `last_event_at`, `request_id`), derived byte-stable from the single actor's snapshot via `deriveProjection(view, wireMachine, bookkeeping)` (`ui-state/lib/machines/chat-app/projection/derive-projection.ts`).

The surveyor research (`docs/research/xstate-react-backend-integration.md`, Verdict + Fit Analysis) concludes the write side is **already** the idiomatic single-actor shape, and the only genuinely-open decision is whether to **collapse the three READ projections into one composite chat-app surface**. Its payoff is **FE/ops simplification — notably fewer SSE streams under MDN's documented HTTP/1.1 6-connection cap** (Finding 6) and fewer loader round-trips — **not a correctness fix** (Finding: this is "sound but optional").

Two evidence points (verified by reading the live code) shape the design:

1. **The FE genuinely needs more than one phase at once.** `frontend/app/root.tsx` reads *both* `login-and-org-setup` (for `org_id` + `user.first_name`) **and** `project-and-chat-session-management` (for `project_flow_state` + `active_scope`) in a **single loader**; `frontend/app/routes/sessions.tsx` reads `project-and-chat-session-management` **and** `session-chat` together. A composite that exposes only "the active phase" would force these loaders back to two calls — defeating the purpose.
2. **No live consumer reads the ui-state `/projection/stream` SSE.** A repo sweep finds the FE's `@/stream` machinery points at the **agent's** chat SSE (`/api/stream/*`), not ui-state. The three per-machine projection streams are **exposed but unconsumed** — so SSE consolidation carries near-zero migration burden; it is pure deletion of unused surface.

---

## The decisions to make

This ADR resolves four sub-decisions (research §"Concrete Recommended API Shape" + OQ#7). Each is presented propose-mode: options, trade-offs, recommendation.

### Decision A — Composite projection shape

> **Does the FE need all three phases simultaneously, or only the active one?** Evidence (Context #1): it needs **≥2 simultaneously** in two existing loaders. So a single-active-view shape is insufficient.

| Option | Shape | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A1 — Discriminated union (active phase + its view)** | `{ phase, active_scope, view: FlowProjection }` where `view` is only the active child's slice | Smallest payload; matches a "one screen at a time" mental model | **Insufficient** — `root.tsx` + `sessions.tsx` read two slices in one loader; this forces them back to a 2nd call. Loses the not-yet-and-already-passed phases the FE composes for first paint | ❌ Rejected (fails the proven requirement) |
| **A2 — Nested map of all three slices** (research-proposed) | `{ phase, active_scope, request_id, machines: { "<wire-name>": FlowProjection, … } }` where each value is **today's exact ADR-027 envelope** | FE picks whichever slice(s) it needs from one response; **each slice is byte-identical to the current per-machine projection** ⇒ equivalence gate is trivial and the existing contract-tested mapper is reused verbatim; lowest migration risk; auth-proxy sniffer repoints to `machines["login-and-org-setup"].state` mechanically | Slightly larger payload (all three slices always present); two redundant top-level conveniences (`active_scope`, `request_id`) duplicate per-slice fields | ✅ **RECOMMENDED** |
| **A3 — Flattened superset** | One flat `context` merging all three machines' fields | Smallest field-access ergonomics if there were no collisions | **Lossy by collision**: the three contexts share field names with *different* values (`org.name` populated in onboarding, null in project-context; `user.email` onboarding-only; per-machine `underlying_cause_tag`/`state`). Flattening forces arbitrary collision resolution and **destroys the per-machine `state` the auth-proxy KPI sniffer reads** | ❌ Rejected (lossy + breaks a consumer) |

**Recommendation: A2 — nested map.** It is the only option that (a) satisfies the proven multi-phase read requirement, (b) keeps each slice **byte-identical** to the frozen ADR-027 envelope so the equivalence gate reduces to `composite.machines[m] === deriveProjection(view, m, bk)` for each `m` (an ADR-040 LEAF-5-style falsifiable artifact), and (c) lets the composite mapper **call the existing `deriveProjection` three times** rather than introduce a parallel derivation (Reuse Analysis below).

**Resulting response schema:**

```ts
// ui-state/lib/domain/composite-projection.ts (NEW)
import type { ActiveScope } from "./active-scope.ts";
import type { FlowProjection } from "./flow-projection.ts";

/** The phase of the lifecycle region, derived from the parent ChatApp value. */
type ChatAppPhase = "onboarding" | "project_context" | "chat" | "rejected";

export interface CompositeChatAppProjection {
  /** Coarse lifecycle phase — a convenience for routing/first-paint dispatch. */
  phase: ChatAppPhase;
  /** The single authoritative active_scope (deepest-resolved child wins) — the
   *  same value the FE reads today from the project/session projection. */
  active_scope: ActiveScope;
  /** Current request's id (honors X-Request-Id), echoed at top level. */
  request_id: string;
  /** Each wire machine's projection — the ADR-027 envelope, byte-identical to
   *  today's per-machine read. Keyed by the *canonical* wire name (the FE migrates
   *  off the legacy aliases as part of this collapse; aliases keep resolving on the
   *  legacy paths until the cleanup LEAF). */
  machines: {
    "login-and-org-setup": FlowProjection;
    "project-and-chat-session-management": FlowProjection;
    "session-chat": FlowProjection;
  };
}
```

**Example payload** (`GET /ui-state/flow/chat-app/projection`, a user who has finished onboarding and selected a project, chat not yet entered):

```json
{
  "phase": "project_context",
  "active_scope": { "org_id": "org-001", "project_id": "proj-7", "resource_type": null, "resource_id": null },
  "request_id": "7f3c-…",
  "machines": {
    "login-and-org-setup": {
      "flow_id": "login-and-org-setup:user-001",
      "state": "ready",
      "context": { "org": { "id": "org-001", "name": "Acme" }, "user": { "email": "z@acme.io", "display_name": "Z A", "first_name": "Z" }, "underlying_cause_tag": null, "org_validation_error": null },
      "active_scope": { "org_id": "org-001", "project_id": null, "resource_type": null, "resource_id": null },
      "sequence_id": 3, "last_event_at": "2026-05-29T12:00:00.000Z", "request_id": "7f3c-…"
    },
    "project-and-chat-session-management": {
      "flow_id": "project-and-chat-session-management:user-001",
      "state": "project_selected",
      "context": { "org": { "id": "org-001", "name": null }, "user": { "email": null, "display_name": null, "first_name": "Z" }, "project": { "id": "proj-7", "name": "Sales" } },
      "active_scope": { "org_id": "org-001", "project_id": "proj-7", "resource_type": null, "resource_id": null },
      "sequence_id": 5, "last_event_at": "2026-05-29T12:00:04.000Z", "request_id": "7f3c-…"
    },
    "session-chat": {
      "flow_id": "session-chat:user-001",
      "state": "verifying",
      "context": { "org": { "id": null, "name": null }, "project": { "id": null, "name": null }, "session_list": [], "session_id": null, "transcript": [] },
      "active_scope": { "org_id": "", "project_id": null, "resource_type": null, "resource_id": null },
      "sequence_id": 0, "last_event_at": "", "request_id": ""
    }
  }
}
```

Each `machines[m]` value is exactly what `GET /ui-state/flow/<m>/projection` returns today — the composite is a lossless envelope around three unchanged slices.

> **Note on `phase` / top-level `active_scope`** — these are conveniences derived inside the mapper (phase from the parent lifecycle value; active_scope = the existing per-slice `active_scope` of the deepest-resolved child, identical to what `root.tsx` reads today). They carry no new state-of-record; a consumer can ignore them and read `machines[*]` directly. They exist so the common "which screen + what scope" first-paint dispatch is a single field read.

### Decision B — The endpoint

| Concern | Decision | Rationale |
|---|---|---|
| **Path** | `GET /ui-state/flow/chat-app/projection` (+ `/projection/stream`) | Stays under the existing `/flow/` path prefix, so auth-proxy's `/ui-state/*` prefix rule and nginx's `/ui-state/` proxy route it with **zero routing change** (ADR-030 §1 path-prefix-only). (Surveyor floated `/ui-state/chat-app/*`; `/flow/chat-app/*` is preferred for prefix consistency. Either is covered by the rule.) |
| **Mount mechanism** | A **separate `buildCompositeRouter(runtime)` factory**, mounted via its own `app.route("/flow/chat-app", buildCompositeRouter(runtime))` — **NOT** an entry in the per-machine `WIRE_PATHS` loop | `WIRE_PATHS` feeds `buildChatAppRouter(runtime, wireMachine)`, and `wireMachine` is passed to `deriveProjection`/`childIdForWireMachine`, which only resolve the three child slices (a `"chat-app"` value would throw `UnknownWireMachineError`). "chat-app" is a **parent-level fold of all three children**, not a child slice — so it needs its own factory (no `wireMachine` param), sharing the same `runtime`. (See "Composite mapper + SSE seam" below.) |
| **Identity source** | Header-derived `X-User-Id` only | Unchanged from ADR-040 amendment — no `:principal` path param, no body identity, no client `flow_id`. The composite reads the same per-principal actor the writes already target. |
| **Request = event** | The **write side is already unified** (§4) — `/begin`, `/event`, `/open-deep-link` all hit one actor. This ADR scopes the change to the **READ side**. A composite `POST /flow/chat-app/event` is **optional** (see Decision B-write below). |
| **Response = derived composite** | Always the derived `CompositeChatAppProjection`, **never** `getPersistedSnapshot()` | Research Findings 2/5: the raw snapshot is XState-internal + version-coupled and would break the wire on any machine refactor and break the auth-proxy literal-state sniffer. Server-authoritative (Finding 7). |
| **SSE consolidation** | **One** `GET /flow/chat-app/projection/stream` replacing three | Research Finding 6 (HTTP/1.1 6-connection cap). First frame = current composite; re-derive on each retained-log event. **No FE migration burden** — the three per-machine streams have no live consumer (Context #2), so this is consolidation + deletion, not a cutover. The stream subscribes to all three canonical child bookkeeping logs (union) and re-derives the composite on any. |

**Decision B-write (write-surface symmetry) — optional, recommend defer.** Two sub-options:
- **B-write-1 (recommended):** Keep writes on the existing per-machine event paths during/after the collapse (they already converge on one actor — no behavioral difference). Add a composite `POST /flow/chat-app/event` **only if** the FE wants a single base path. Lower scope; the onboarding closed-ACL stays exactly where it is.
- **B-write-2:** Expose `POST /flow/chat-app/{begin,event,open-deep-link}` on the composite mount now, dispatching the onboarding closed-ACL **by event type** (not by wire) and forwarding the rest verbatim. Cleaner single surface, but adds a type-dispatched ACL and is not required by any consumer today.

**Recommendation: B-write-1.** Collapse the *reads* (the actual OQ#3); leave writes on convergent paths; treat a composite write surface as a documented, low-risk follow-on if a consumer asks.

#### Composite mapper + SSE seam (implementation contract for DELIVER)

This subsection pins the seams a later DELIVER must honor, so MR-A/MR-B are unambiguous.

**Mapper signature (read).** A new pure wrapper in `derive-projection.ts`:

```ts
export function deriveCompositeProjection(
  view: ChatAppSnapshotView,
  bookkeepingByChild: Record<ChatAppChildId, ProjectionBookkeeping>,
): CompositeChatAppProjection {
  const machines = {
    "login-and-org-setup":               deriveProjection(view, "login-and-org-setup", bookkeepingByChild["onboarding"]),
    "project-and-chat-session-management": deriveProjection(view, "project-and-chat-session-management", bookkeepingByChild["project-context"]),
    "session-chat":                      deriveProjection(view, "session-chat", bookkeepingByChild["session-chat"]),
  };
  return {
    phase: derivePhase(view),                       // see below
    active_scope: machines["project-and-chat-session-management"].active_scope.org_id
      ? machines["project-and-chat-session-management"].active_scope
      : machines["login-and-org-setup"].active_scope, // deepest-resolved child wins; identical to root.tsx's read today
    request_id: currentRequestId,                   // from the requestId middleware (not folded from logs)
    machines,
  };
}
```

Each `machines[m]` is **literally the existing `deriveProjection` output** — so byte-equivalence is true by construction and the equivalence gate (MR-A) is mechanical.

**`phase` derivation (convenience, NOT contract).** `derivePhase(view)` maps the **parent lifecycle value** (ADR-044 single-region `lifecycle`): `onboarding → "onboarding"`, `engaged.project_context → "project_context"`, `engaged.chat → "chat"`, `rejected → "rejected"`. `phase` is a routing/first-paint convenience only. **Consumers MUST dispatch on `machines[m].state`, not on `phase`, during coexistence** (the FE already does — `root.tsx` reads `machines["project-and-chat-session-management"].state`, i.e. today's `project_flow_state`). If a future consumer needs `phase` as a contract, pin it with its own contract test then (Open Question #2).

**Bookkeeping / `sequence_id` semantics.** There is **no synthetic composite log and no top-level `sequence_id`.** Each `machines[m]` keeps its own `sequence_id`/`last_event_at`/`request_id` sourced from that child's existing bookkeeping log (`bookkeepingFromLog`, reused unchanged) — byte-identical to its per-machine read. The top level carries only `request_id` (the current request). This deliberately avoids inventing a cross-child monotonic counter (which would have no well-defined meaning across three independent logs).

**SSE seam.** The single `GET /flow/chat-app/projection/stream` subscribes to the **union** of the three canonical child bookkeeping logs (`onboarding`/`project-context`/`session-chat`); the first frame is the current composite, and **any** child-log event triggers a re-derive + emit of the full composite. The SSE `id:`/`since` cursor resume is **best-effort and non-load-bearing today** — there is no live consumer of the per-machine streams (Context #2), so the consolidated stream inherits no resume-semantics obligation; if a consumer later needs cursor resume across the union, that is specified then (composes with the delta-encoding Open Question #3). This is consolidation of unused surface, not a behavior cutover.

### Decision C — Migration strategy

| Option | Mechanism | Pros | Cons | Verdict |
|---|---|---|---|---|
| **C1 — Additive coexistence (ADR-040 alias style)** | Mount the composite **alongside** the three per-machine reads; migrate FE loaders one route at a time; repoint the auth-proxy sniffer with a fallback; migrate acceptance; then a terminal cleanup LEAF retires the per-machine reads + streams (sequenced with ADR-040 LEAF-6) | **Zero 404 window**; each surface migrates independently and reversibly; the composite read ships **near-zero-risk** (pure additive, reuses the tested mapper, behind the equivalence gate); matches the repo's established grain (ADR-040 LEAF series, ADR-044 byte-stable derived view) | A transitional dual read-surface exists for a few MRs; one small cleanup LEAF at the end | ✅ **RECOMMENDED** |
| **C2 — Clean break** | Switch ui-state + FE (6 files) + auth-proxy sniffer + ~13 acceptance specs in one coordinated MR | Simpler end state immediately; no alias cruft; viable since the FE is in-repo with no external consumer | One big-bang MR touching four surfaces is exactly the coordination risk ADR-040's alias mechanism exists to retire; harder to review/revert; the equivalence gate protects ui-state but not the cross-surface cutover | ❌ Rejected (higher coordination risk for no durable benefit; the additive path reaches the same end state) |

**Recommendation: C1 — additive coexistence.** The composite read is a *pure additive* surface (each slice reuses the contract-tested `deriveProjection`), so it lands behind the equivalence gate with negligible risk; consumers then migrate at their own pace; a single cleanup LEAF (co-sequenced with ADR-040 LEAF-6) deletes the old read paths and the three unused SSE streams. The clean break's only advantage — "no alias cruft" — is reached anyway by the cleanup LEAF, without the big-bang.

**`flow_id` / persisted-state backward-compat (either option):** **Nothing migrates.** The composite reads the **same** single per-principal actor, the **same** `getPersistedSnapshot()` record (`ui-state:chatapp:{principal}:snapshot`), and the **same** per-child bookkeeping logs. Each `machines[m].flow_id` stays `{m}:{principal}` verbatim (alias kept in the key, matching `FlowId.of`). The composite endpoint introduces **no new persisted key** and is **read-only** over existing state. Snapshots remain ephemeral/flush-on-deploy (ADR-027 amendment), so there is no durable-shape migration to manage.

### Decision D — What stays frozen

- The **ADR-027 7-field `FlowProjection` envelope** — preserved as the value of each `machines[*]` slice, byte-for-byte.
- The **write side** — `/begin`, `/event`, `/open-deep-link`, the onboarding closed-ACL, `forwardToActor`, `switching_project_intent → PROJECT_SWITCH`. Unchanged.
- **Identity derivation** (`X-User-Id`), **single-replica topology** (ADR-030), **hybrid persistence** + the **R3 settled-snapshot guard** (ADR-044 §2), and the **per-child bookkeeping logs** (SSE/audit substrate). Unchanged.
- The three per-machine read paths + streams stay live **through coexistence**, retired only in the terminal cleanup LEAF.

---

## Reuse Analysis (mandatory — DESIGN hard gate)

| Existing component | File | Overlap | Decision | Justification |
|---|---|---|---|---|
| `deriveProjection(view, wireMachine, bk)` | `ui-state/lib/machines/chat-app/projection/derive-projection.ts` | Per-machine slice derivation | **EXTEND (compose)** | The composite mapper **calls `deriveProjection` three times** (once per canonical wire name) and wraps the results — it does **not** re-derive. This makes the equivalence gate `composite.machines[m] === deriveProjection(view, m, bk)` true by construction. New code ≈ a thin wrapper + `phase`/top-`active_scope` derivation (~30–50 LOC), not a parallel mapper. |
| `buildChatAppRouter(runtime, wireMachine)` | `ui-state/lib/machines/chat-app/router.ts` | Wire transport, actor lookup, settle/persist/bookkeeping helpers | **EXTEND** | A composite router reuses the same `ChatAppRuntime` (one registry, one event log, one snapshot store), the same `getActor`/`emptyView`/`readBookkeeping` helpers, and the same SSE substrate. The composite read handler is a sibling of `projectionResponse` that folds three derivations. No new actor, no new persistence. |
| `ChatAppActorRegistry` / snapshot store / event log | `router.ts`, `lib/persistence/*` | Per-principal actor + state | **REUSE (unchanged)** | The composite reads the same single actor; zero change. |
| `FlowProjection` | `ui-state/lib/domain/flow-projection.ts` | Slice envelope | **REUSE** | Becomes the value type of `machines[*]`. New `CompositeChatAppProjection` type wraps it; the existing type is untouched. |
| auth-proxy KPI sniffer | `auth-proxy/app.ts` `emitKpiEventsForResponse` | Reads `body.state` / `body.context.underlying_cause_tag` | **EXTEND** | Repoint to `body.machines["login-and-org-setup"].state` with a fallback to top-level `body.state`, so it reads correctly against **both** the composite and the legacy per-machine response during coexistence. |

**Zero unjustified CREATE NEW.** The only new artifacts are a wrapper mapper, a composite router handler, and one DTO type — all thin compositions of existing, contract-tested components.

---

## Blast radius (per-surface change list)

**ui-state** (the owner; read-side only):
- `lib/domain/composite-projection.ts` — **NEW** `CompositeChatAppProjection` type (Decision A2).
- `lib/machines/chat-app/projection/derive-projection.ts` — **ADD** `deriveCompositeProjection(view, bookkeepingByChild)` composing the three existing `deriveProjection` calls + `derivePhase` + top-`active_scope` (see "Composite mapper + SSE seam"). Existing per-machine function untouched.
- `lib/machines/chat-app/router.ts` — **ADD** a `buildCompositeRouter(runtime)` factory exposing `GET /projection` (composite read) + one `GET /projection/stream` (union-subscribed SSE); reuse `getActor`/`readBookkeeping`/`emptyView`/`requestIdMiddleware`. Per-machine `buildChatAppRouter` and all writes untouched.
- `index.ts` — **ADD** a dedicated mount `app.route("/flow/chat-app", buildCompositeRouter(runtime))`, wired to the **same** `ChatAppRuntime`. This is **separate from** the `WIRE_PATHS` loop (which stays per-machine — "chat-app" is not a child slice; see Decision B "Mount mechanism").
- **NEW contract/equivalence test** `derive-composite-projection.contract.test.ts` — the binding gate (see Phased Plan MR-A).

**frontend** (consumers that change):
- `app/lib/ui-state-client.ts` — **ADD** `getComposite()` (and optionally a single `getCompositeStream()`); existing `getProjection(machine)` retained through coexistence.
- `app/root.tsx` — migrate the **two** `getProjection` calls (login + project) → **one** `getComposite()` (the headline win).
- `app/routes/sessions.tsx` — migrate the **two** reads (project + session) → one composite read.
- `app/routes/projects.tsx` — migrate the single project read.
- `app/routes/chat.tsx` — migrate the single session-chat read.
- `app/routes/_test-loader-probe.tsx` — migrate the probe read.
- `app/lib/ui-state-client.test.ts` — update/extend for the composite method.

**auth-proxy:**
- **Route table: NO CHANGE** — `app.all("/ui-state/*")` already proxies the composite path (path-prefix-only, ADR-030).
- `app.ts` `emitKpiEventsForResponse` — **shape-detect, then read**: `const onb = body.machines ? body.machines["login-and-org-setup"] : body;` then read `onb.state` / `onb.context?.underlying_cause_tag`. The `body.machines` presence check distinguishes the composite envelope (new) from the legacy per-machine `FlowProjection` (top-level `state`) — so the sniffer fires `ready_reached` / `auth_recoverable_error_shown` correctly against **both** shapes throughout coexistence. `app.test.ts` — add a composite-envelope case asserting both KPI events fire from `machines["login-and-org-setup"]`, alongside the existing per-machine case.

**acceptance:**
- `tests/acceptance/user-flow-state-machines/` — JS harness `steps/ui-state-client.ts` (reads `login-and-org-setup`) + 3 feature step files; migrate to the composite read (or keep on per-machine until the cleanup LEAF).
- `tests/acceptance/project-and-chat-session-management/` — `driver.py` `get_j002_projection` (reads `project-and-chat-session-management`) + the `us201…us210` specs; same choice.
- The `?flow_id=` query these harnesses still append is already stripped/ignored server-side (ADR-040 amendment) — no behavioral dependency.

**Stays frozen:** the write paths, the ADR-027 slice envelope, identity derivation, topology, persistence, the R3 guard, and the per-machine read paths (until cleanup).

---

## Phased DELIVER plan (carpaccio slices; equivalence test is the gate)

Each MR is independently mergeable through the refinery queue; the equivalence gate (MR-A) is authored **first** and rides under the whole sequence (ADR-040 LEAF-5 precedent).

| MR | Slice | Gate / acceptance |
|---|---|---|
| **MR-A** *(gate-first)* | Author `deriveCompositeProjection` + **equivalence contract test**. **Baseline = the current live read path:** ADR-044 Phase 4 has already landed (orchestrator deleted; `deriveProjection(snapshot, …)` is the live per-machine read — *not* `buildProjection`), so the gate asserts `composite.machines[m]` is **byte-equivalent** to `deriveProjection(view, m, bk)` for all three `m`, over every J-001/J-002 state-history scenario already in `derive-projection.contract.test.ts` (login→project→chat, needs_org, error_recoverable+cause, project_selected, switching_project, session_active, session_rejected). Also assert `phase` matches the parent lifecycle value and top-`active_scope` matches the deepest-resolved child. Pure function; no wiring. | The contract test is green and becomes the regression gate for every later MR (ADR-040 LEAF-5-style falsifiable artifact). |
| **MR-B** | Mount `GET /flow/chat-app/projection` + one `/projection/stream` (additive; reuses runtime + the MR-A mapper). Per-machine paths untouched. | ui-state integration test: composite read returns the three slices equal to the three per-machine reads for the same actor; one SSE stream emits a fresh composite on each child log event. |
| **MR-C** | FE: add `getComposite()` to `ui-state-client` (+ unit test); migrate `root.tsx` (2 reads → 1). | Existing `root.tsx` loader tests pass against the composite; the walking-skeleton first-paint scenario (`no_projects` dispatch) still observes `phase`/`machines[project].state`. |
| **MR-D** | FE: migrate `sessions.tsx` (2 reads → 1), `projects.tsx`, `chat.tsx`, `_test-loader-probe.tsx`. | Per-route loader tests pass; no remaining `getProjection(<machine>)` call in app routes **or app-internal hooks/libs** (the audit spans `frontend/app/**`, not just `routes/`). |

> **Coexistence note (MR-C…MR-F).** While the FE migrates route-by-route, the FE consumes **both** surfaces (e.g. after MR-C, `root.tsx` reads the composite while `sessions.tsx` still reads per-machine until MR-D). This is the expected, bounded cost of zero-404 coexistence — the "one fewer SSE stream / one round-trip" benefit is **partial** until MR-D completes the loaders and **fully realized at MR-G** when the per-machine read paths + streams are deleted. Each route migrates in its own commit gated by that route's loader test; the harness migration (MR-F) is the last consumer before cleanup.
| **MR-E** | auth-proxy: repoint KPI sniffer to `machines["login-and-org-setup"].state` with top-level fallback; add composite-envelope test. | `auth-proxy/app.test.ts` asserts `ready_reached` / `auth_recoverable_error_shown` fire from **both** the composite and a legacy per-machine response. |
| **MR-F** | acceptance: migrate the JS harness (3 features) + py driver (`us201`–`us210`) to the composite read. | Both acceptance suites green against the composite. |
| **MR-G** *(cleanup LEAF — gated on C–F merged)* | Retire the three per-machine `/projection` + `/projection/stream` read paths and their call sites; co-sequence with **ADR-040 LEAF-6** (alias-map removal). Writes, bookkeeping logs, and the snapshot store stay. Retire the equivalence test with the old paths. | No consumer references a per-machine read path; full suite + acceptance green; one fewer SSE stream per tab. |

Sequencing rationale: gate before surface (MR-A→B), reads migrate consumer-by-consumer (MR-C→F) with zero 404 window, deletion last (MR-G) once nothing reads the old surface — the ADR-040 LEAF discipline.

---

## Consequences

**Positive**
- One loader round-trip + one SSE stream replace up to three (research Finding 6 — relieves the HTTP/1.1 6-connection pressure; `root.tsx`/`sessions.tsx` collapse 2 reads → 1).
- The published read interface becomes a single, discoverable surface while each slice stays byte-identical to the frozen ADR-027 contract — migration risk is bounded by a mechanical equivalence gate.
- Reuses the contract-tested `deriveProjection` + existing runtime; no new actor, persistence, or topology.
- Resolves ADR-044 §5 OQ#3 with a reversible, in-grain migration.

**Costs / risks**
- A transitional dual read-surface exists across MR-B…MR-G (the explicit, bounded cost of zero-404 coexistence).
- The composite payload always carries all three slices (larger than a single per-machine read, smaller than the up-to-three round-trips it replaces) — acceptable for loader reads; the slices are small and the FE already fetched ≥2 of them. For the consolidated **SSE** stream, full-composite re-derivation on each child event is more bytes per frame than a single per-machine frame would be — non-load-bearing today (no live stream consumer), but if a future SSE consumer makes this loud, delta encoding (`?since=`, Open Question #3) is the documented path.
- The auth-proxy sniffer's dual-shape read (composite + fallback) is a small transitional branch, removed when MR-G lands (or left as a harmless fallback).
- **Unmodeled-event silence (research Finding 4 / OQ#1) and idempotency of retried POSTs (Finding 8 / OQ#3) are NOT addressed here** — they are write-side concerns, out of scope for a read-side collapse, and remain open against the write surface.

---

## §9 — ADR-044 §5 Open Question #3: RESOLVED

> ADR-044 §5 OQ#3: *"Unify the external projection wire (one ChatApp projection instead of per-machine) — a follow-on FE + auth-proxy story, not required for the pivot."*

**RESOLVED — adopt a composite chat-app read projection (Decision A2: nested `machines` map) exposed at `GET /ui-state/flow/chat-app/projection` (+ one SSE stream), migrated via additive coexistence (Decision C1) with a cleanup LEAF co-sequenced with ADR-040 LEAF-6.** The write side requires no change (already unified). The collapse is a sound, optional FE/ops simplification — sequenced as the phased DELIVER plan above, gated by a byte-equivalence contract test.

---

## Open questions (deferred)

1. **Composite write surface (Decision B-write).** Whether to add `POST /flow/chat-app/{begin,event,open-deep-link}` with a type-dispatched onboarding ACL is deferred until a consumer wants a single base path; writes already converge on one actor, so this is ergonomics, not correctness.
2. **`phase` vocabulary stability.** `phase` is a derived convenience; if a future consumer treats it as a contract (not just routing dispatch), pin it with its own contract test. Today no consumer depends on it.
3. **Delta encoding (ADR-027 OQ#3, the *other* one).** The composite still ships full state per response. `?since=sequence_id` deltas remain deferred until payload size is loud — orthogonal to this collapse.

## References

- `docs/research/xstate-react-backend-integration.md` — evidence base (Verdict; Findings 2/5/6; Fit Analysis "What a SINGLE chat-app endpoint would CHANGE"; OQ#4/#7).
- ADR-027 (frozen `FlowProjection` wire), ADR-030 (single-replica topology + `flow_id`), ADR-040 (hexagonal transport + alias migration mechanism + identity-derivation amendment), ADR-044 (ChatApp coordinator + hybrid persistence + §5 OQ#3).
- Live code: `ui-state/index.ts` (`WIRE_PATHS`), `ui-state/lib/machines/chat-app/router.ts`, `ui-state/lib/machines/chat-app/projection/derive-projection.ts`, `ui-state/lib/machines/chat-app/snapshot.ts`, `ui-state/lib/domain/flow-projection.ts`; `frontend/app/root.tsx`, `frontend/app/routes/{projects,sessions,chat,_test-loader-probe}.tsx`, `frontend/app/lib/ui-state-client.ts`; `auth-proxy/app.ts` (`/ui-state/*` proxy + `emitKpiEventsForResponse`).
</content>
</invoke>
