# Walking Skeleton — J-002 (`project-and-chat-session-management`)

> **Wave**: DISTILL
> **Date**: 2026-05-13
> **Owner**: nw-acceptance-designer
> **Strategy**: C — real local adapters (compose stack) + skip-when-unavailable
> **Tagged scenario**: `@walking_skeleton`
> **Test**: `tests/acceptance/project-and-chat-session-management/test_us201_first_time_lands_in_no_projects_empty_state.py::test_first_sign_in_foregrounds_the_no_projects_welcome_panel`
> **Gherkin SSOT**: `docs/feature/project-and-chat-session-management/distill/features/us-201-first-time-in-org-lands-in-no-projects-empty-state.feature` — Scenario `@happy_path @walking_skeleton`

## Purpose

The walking-skeleton scenario is **MR-1's GREEN gate**. It threads every
layer of J-002 end-to-end from the user-facing driving port
(`reverse-proxy:5173`) through to the projection's `state` field. It
proves the entire substrate stack composes correctly before any
milestone scenario is allowed to enter the queue.

## What it covers

A first-time-in-org Maya (persona `maya-first-time` from the J-001
fixture set) completes J-001 and is auto-spawned into J-002. The
orchestrator's `j001_ready` broadcast hook fires; J-002's machine
enters `resolving_initial_scope`; the `resolveInitialScope` invoke runs
against the real backend (`list_projects` returns empty); the projection
settles in `no_projects_empty_state`; the FE root loader reads the
projection; the SSR'd HTML for `/` contains the welcome panel.

### Layers exercised

1. **Browser** (test acting as) → GET `/` to `reverse-proxy:5173`.
2. **nginx (`reverse-proxy`)** — routes non-`/api/*`, non-`/worker/*`,
   non-`/assets/*` to `web-ssr` (per ADR-034).
3. **`web-ssr` Hono RRv7 SSR handler** — invokes `root.tsx`'s loader
   (NEW per DWD-4).
4. **`uiStateClient.getJ002Projection`** (NEW per DWD-4) — outbound
   fetch through `auth-proxy:1042` with Bearer + `X-Active-Scope` header
   (the latter empty on first call; populated post-resolution).
5. **`auth-proxy`** — JWT verification, identity-header injection
   (`X-Org-Id`, `X-User-Id`, `X-Trace-Id`), forward to `ui-state:1043`.
6. **`ui-state` Hono tier** — `GET /ui-state/flow/project-and-chat-session-management/projection?flow_id=...`
   route handler reads the projection from Redis Streams via
   `FlowEventLog` (capability-presence dispatch per ADR-018).
7. **`orchestrator`** — registered the J-002 machine via `MachineRegistry`
   (DWD-8) AND fired the `j001_ready` broadcast hook (DWD-6) AND spawned
   the J-002 actor; the J-002 actor's `resolveInitialScope` invoke
   has settled.
8. **`backend` FastAPI** — `list_projects(user=maya)` returned an empty
   list (the real backend; the test fixture seeded zero projects for
   this persona).
9. **`Redis`** — `XADD`'d the `j002_resolution_started` and
   `no_projects_displayed` events; `XRANGE` returns them to the
   projection-builder.
10. **`buildProjection`** + **`EVENT_HANDLERS`** — fold the events into
    the projection envelope; J-002's `context.org_id` matches J-001's
    `active_scope.org_id` (asserted by the Praxis F-5 property test
    separately).
11. **`root.tsx` SSR'd response** — the HTML body contains the
    welcome panel copy "Welcome to Acme Data, Maya! Let's get started
    by creating your first project." rendered server-side. No
    "Loading..." placeholder is in the body.

The test asserts:

- HTTP status 200 on GET `/`.
- Content-Type `text/html`.
- The body contains the welcome copy on FIRST paint (no client-side
  fetch required).
- The body does NOT contain a project chip with any name.
- The body does NOT contain the suggestion chips "Upload CSV" or
  "Browse Projects" (those are reserved for the no-sessions empty-state
  sub-shape per US-203, not the no-projects empty-state per US-201).
- The first-paint latency is <300ms p95 (test runs N=50 iterations and
  asserts the 95th percentile).

## Litmus test (Dim 9d)

> "If I deleted the real `reverse-proxy` adapter, would the WS still
> pass?"

**No.** The scenario POSTs through `reverse-proxy:5173` and asserts on
SSR'd HTML. Removing nginx fails the test for the right reason (wiring).

> "If I deleted the real `auth-proxy` adapter, would the WS still pass?"

**No.** Without auth-proxy, `web-ssr`'s loader's outbound fetch to
`ui-state` fails the JWT verification preconditions.

> "If I replaced Redis with an InMemory fake, would the WS still pass?"

**No.** The projection's `active_scope.org_id` flows from J-001's
projection (which is in Redis Streams); the FREEZE/THAW substrate uses
Redis Streams. The walking-skeleton scenario itself doesn't trigger
FREEZE but it READS from the J-001 projection — which IS in Redis.

> "If I deleted the J-002 `j001_ready` broadcast hook from the
> orchestrator, would the WS still pass?"

**No.** Without the hook, J-002 doesn't auto-spawn — `getJ002Projection`
returns a 404 or a stale projection from before the J-002 machine was
spawned.

These four "No" answers confirm the walking-skeleton has the right
shape: it exercises every load-bearing layer that DELIVER must wire up
for J-002 to work in production.

## Why this one scenario (not multiple)

Per the nw-distill skill: **exactly one walking-skeleton scenario per
feature**, marked `@walking_skeleton`. Multiple WSes diffuse the
"first-GREEN gate" signal — having one means MR-1's GREEN bar is
unambiguous: either the WS passes or it doesn't.

The other 17 MR-1 scenarios (US-201's remaining 4, US-202's 5, US-204's
6, the 2 ICs) are *milestone* scenarios that layer on top. They share
the WS's substrate but exercise specific behaviors (project creation,
last-used resolution, cross-tenant deep-link, etc.). All 18 must be
GREEN for MR-1 to merge.

## DELIVER hand-off

MR-1 DELIVER's first task (per `roadmap.json` step 1):

1. Land the J-002 machine file with the 5 Slice-1 states (+
   `error_recoverable`).
2. Land the orchestrator `MachineRegistry` refactor + `j001_ready`
   broadcast hook.
3. Land the projection `EVENT_HANDLERS` extension for the Slice-1
   events.
4. Land the 4 Slice-1 RRv7 route loaders (`root.tsx`,
   `project-detail.tsx`, `projects.tsx`, plus the `uiStateClient`
   extensions).
5. Run `cd tests/acceptance/project-and-chat-session-management &&
   uv run --no-project pytest -k test_first_sign_in_foregrounds` AND
   ensure it goes from SKIPPED to PASSED.
6. Un-skip the remaining 17 MR-1 scenarios; ensure they go GREEN.
7. Submit via `gt mq submit` from the rig workspace.

The walking-skeleton GREEN is the single-scenario gate; the MR's full
GREEN is the 18-scenario gate.

## Strategy-C declared adapters

Per DD-2 in `wave-decisions.md` — refer there for the full adapter
coverage table. The walking-skeleton specifically exercises:

| Adapter | Mode |
|---|---|
| `reverse-proxy` nginx | real (compose) |
| `web-ssr` Hono SSR + `root.tsx` loader | real (compose) |
| `auth-proxy` | real (compose) |
| `ui-state` Hono tier | real (compose) |
| `FlowOrchestrator` + `MachineRegistry` | real (in `ui-state` process) |
| J-002 machine | real (in `ui-state` process) |
| `EVENT_HANDLERS` projection extension | real |
| `FlowEventLog` (Redis Streams) | real (compose) |
| Backend FastAPI `list_projects` | real (compose) |
| Backend Postgres / SQLite | real (compose) |
| `WorkOS` | faked (in-process Hono server from J-001 fixture) |

The fake WorkOS is the SOLE non-real adapter, inherited from J-001's
DELIVER. Everything else is real.
