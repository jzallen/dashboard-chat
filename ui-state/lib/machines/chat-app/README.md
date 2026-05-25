# ChatApp coordinator machine

`ChatApp` is the XState v5 **parent coordinator** that cycles a user through
`onboarding → project-context → chat` and overlays a freeze/reauth region. It is
the declarative replacement for the imperative `FlowOrchestrator`'s coordination
role and the first faithful implementation of ADR-028's "one root orchestrator
actor mediating parent-ignorant children" (see
[ADR-044](../../../../docs/decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md)).

> **Status: Phase 3 — hybrid persistence reconciled (in isolation).** On top of
> Phase 2's real-children wiring, ChatApp now has (1) a byte-stable **derived-view
> projection mapper** ([`projection/derive-projection.ts`](./projection/derive-projection.ts))
> that reproduces the per-machine ADR-027 `FlowProjection` from a ChatApp snapshot
> — proven byte-identical to the `buildProjection` log fold by golden contract
> tests — and (2) **snapshot restart recovery** ([`snapshot.ts`](./snapshot.ts) +
> [`../../persistence/chatapp-snapshot-store.ts`](../../persistence/chatapp-snapshot-store.ts))
> making `getPersistedSnapshot()` the internal state-of-record (R3 self-heal
> reproduced on the real wired actor). Still **no** HTTP/Redis boundaries: none of
> this is wired into `ui-state/index.ts`/HTTP routing, the `/projection` endpoints,
> or `orchestrator.projectionFor`; the append-only event log stays load-bearing on
> the live path; ChatApp runs ALONGSIDE the orchestrator (still the live
> coordinator). Phase 1's FAKE-children statechart tests
> ([`machine.test.ts`](./machine.test.ts) + [`fakes.ts`](./fakes.ts)) and Phase 2's
> integration tests ([`integration.test.ts`](./integration.test.ts)) still pass
> unchanged. Phase 4 swaps the composition root + deletes the orchestrator.

## Two parallel regions

The machine is `type: "parallel"` — it is in one state in **each** region at once:

```
ChatApp (parallel)
├── lifecycle
│   onboarding ─(child→ready)─► engaged.project_context
│                              ─(child→project_selected)─► engaged.chat
│              └(child→session_rejected)─► rejected
│
└── connectivity            (orthogonal — applies in ANY lifecycle phase)
    live ─(TOKEN_EXPIRED)─► frozen ─(REAUTH_OK)─► live   (+ replay held intents)
                            frozen ─(REAUTH_FAILED)─► live + lifecycle→rejected
```

- **`lifecycle`** is the forward cycle. `engaged` is a compound state that owns
  the project-context child for **both** `project_context` and `chat`, so it
  stays live for project switching after entering chat; session-chat is invoked
  on `chat` only.
- **`connectivity`** is the freeze overlay. Because it is a *parallel region*,
  freeze pauses intent-forwarding in place regardless of the lifecycle phase —
  no per-child `FREEZE` broadcast, no per-child history bookkeeping. While
  `frozen`, inbound user intents are **held** in a parent buffer
  (`context.held_events`) and replayed **in order** on `REAUTH_OK`.

`TOKEN_EXPIRED` is modeled as a parent event any phase can raise; in Phase 2 a
child raises it via `sendParent` on a 401. `REAUTH_OK` / `REAUTH_FAILED` are the
injectable reauth **outcomes** — no real WorkOS is wired in Phase 1.

## Coordination (children stay parent-ignorant — ADR-028)

No child references another. The parent **watches** each child via `onSnapshot`
and advances on the child's own state value; hand-offs are parent `entry` actions
that `sendTo` the next child — the declarative form of the orchestrator's
`authReady→begin` / `projectReady` pump callbacks:

| Trigger (child snapshot) | Parent transition | Hand-off forwarded |
|---|---|---|
| onboarding → `ready` | → `engaged.project_context` | `auth_ready{org_id,user}` → project-context |
| project-context → `project_selected` (first) | → `engaged.chat` | `project_ready{project…}` → session-chat |
| project-context → `project_selected` (new id) | stay in `chat` | re-`project_ready` → session-chat |

First-selection vs. switch is discriminated purely on context
(`last_forwarded_project_id`), so the guards stay pure functions of
`(context, event)`.

## Dependency-injected children

The three children are **logical actors** declared in `setup({ actors })` with
minimal placeholders (`setup/actors.ts`) and swapped via
`machine.provide({ actors })`:

- **Phase 1** provides FAKE children (test fixtures defined inline in
  [`machine.test.ts`](./machine.test.ts)) over the bare `createChatAppMachine()`.
- **Phase 2** provides the real `session-onboarding` / `project-context` /
  `session-chat` machines through the composition root `createChatApp(deps)`
  ([`index.ts`](./index.ts)).

XState's `provide` is type-invariant in a child's context, so the swap site casts
the provided machine to `ChatAppChildLogic` (a runtime no-op — the parent reads
child readiness through the `onSnapshot` snapshot views in `setup/types.ts`, not
the placeholder types).

### Input / deps threading (Phase 2)

The children's DI styles differ, and `createChatApp` honors both:

- **session-onboarding** is config/input-driven — no construction deps. Its
  WorkOS/backend URLs + `fetch` port + re-verify Bearer arrive per-instance on
  `ChatAppInput` (`config` / `deps` / `bearer_token` / `force_reissue_failures`),
  seeded write-once into `ChatAppContext` and projected into the child by the
  **onboarding invoke `input:` mapper**.
- **project-context** + **session-chat** inject their resolver actors at
  construction (`ChatAppDeps.projectContext` / `.sessionChat`). Their invoke
  `input:` mappers carry only the static `request_id` / `principal_id`; the
  dynamic org/project arrive via the `auth_ready` / `project_ready` hand-offs.

## Layout

```
chat-app/
├── machine.ts          the statechart + the inline actions (writers + forwarders + onboarding-outcome retention)
├── index.ts            barrel + composition root (createChatApp + createChatAppMachine + contract types)
├── snapshot.ts         Phase-3 restart recovery seam (persist/rehydrate + R3 settled-state guard)
├── machine.test.ts     Phase-1 pure statechart unit tests (inline fake children + createChatAppWithFakes)
├── integration.test.ts Phase-2 in-process integration tests (real children, mocked ports)
├── snapshot.test.ts    Phase-3 snapshot round-trip + R3 self-heal on the real wired actor
├── README.md
├── projection/         Phase-3 derived-view projection (the ADR-027 wire contract, derived)
│   ├── derive-projection.ts             deriveProjection mapper + wire-name aliases + bookkeeping
│   ├── derive-projection.test.ts        pure unit tests (hand-built snapshot views)
│   └── derive-projection.contract.test.ts  R1 golden byte-identity vs buildProjection
└── setup/
    ├── types.ts      context / events / input / hand-offs / snapshot views / OnboardingResult
    ├── guards.ts     onSnapshot predicates (childReachedReady, advanceToChat, …)
    └── actors.ts     placeholder children (the DI seam) + ChatAppChildLogic
```

Phase-3 persistence companion: [`../../persistence/chatapp-snapshot-store.ts`](../../persistence/chatapp-snapshot-store.ts)
(the snapshot store port + Redis/noop adapters, mirroring `redis.ts`).

> The actions are **inline** in `machine.ts` (not extracted under `setup/`):
> they mix context writers (`assign`) with parent→child forwarders
> (`enqueueActions`/`sendTo`), and a pre-built mixed bundle is not assignable to
> `setup({ actions })`. Inlining lets `setup` infer each action's actor/event
> generics — which is also where the `sendTo` targets are type-checked.

## Running the tests

```bash
cd ui-state && npx vitest run lib/machines/chat-app/machine.test.ts
```
