# ChatApp coordinator machine

`ChatApp` is the XState v5 **parent coordinator** that cycles a user through
`onboarding → project-context → chat`. It is
the declarative replacement for the imperative `FlowOrchestrator`'s coordination
role and the first faithful implementation of ADR-028's "one root orchestrator
actor mediating parent-ignorant children" (see
[ADR-044](../../../../docs/decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md)).

> **Status: Phase 4 — LIVE. The orchestrator is deleted (ADR-044 complete).**
> ChatApp is now the live ui-state coordinator. The composition root
> ([`../../../index.ts`](../../../index.ts)) builds one ChatApp actor per principal
> (registry + bounded settle + snapshot persistence) and mounts a single router
> factory ([`router.ts`](./router.ts)) under every wire path; each mount derives
> its own machine's `FlowProjection` from the shared snapshot via
> [`projection/derive-projection.ts`](./projection/derive-projection.ts) — byte-stable
> (ADR-027), proven by the golden contract tests. The hybrid persistence (ADR-044
> §2) is live: `getPersistedSnapshot()` via the
> [`ChatAppSnapshotStore`](../../persistence/chatapp-snapshot-store.ts) is the
> state-of-record (hot-restart recovery); the append-only event log is RETAINED but
> demoted to SSE/audit + projection bookkeeping. The `FlowOrchestrator`,
> `orchestrator-harvester`, `wait-for-settled-state`, the per-machine strategies +
> routers, `FlowActorRegistry`/`FrozenState`, and the children's `FREEZE`/`THAW`
> handlers were deleted; there is **no** `/freeze` + `/thaw` (ADR-043 — auth-proxy
> owns the token lifecycle). The Phase-1 FAKE-children statechart tests
> ([`machine.test.ts`](./machine.test.ts)), the Phase-2 integration tests
> ([`integration.test.ts`](./integration.test.ts)), the Phase-3 snapshot +
> derive-projection contract tests, and the rewired app tests
> ([`../../../index.test.ts`](../../../index.test.ts)) all pass.

## Single lifecycle region

The machine has one active state at a time — the forward cycle:

```
ChatApp
  onboarding ─(isUserReady)─► engaged.project_context
                             ─(advanceToChat)─► engaged.chat
             └(isUserRejected)─► user_rejected
```

- **`lifecycle`** is the forward cycle. `engaged` is a compound state that owns
  the project-context child for **both** `project_context` and `chat`, so it
  stays live for project switching after entering chat; session-chat is invoked
  on `chat` only.
- Inbound user intents route to whichever child owns the current phase via a
  top-level `user_intent` handler (`forwardIntentToActiveChild`).

**No connectivity / freeze-reauth region.** An earlier design (ADR-044) carried a
parallel `connectivity` (`live ⇄ frozen`) overlay that held user intents while
frozen and replayed them on reauth. It was **retired** ([ADR-043](../../../../docs/decisions/adr-043-retire-ui-state-token-lifecycle-modeling.md),
resolving ADR-044 §5 Open Question #2 toward removal): auth-proxy owns the token
lifecycle ([ADR-016](../../../../docs/decisions/adr-016-auth-proxy-in-test-stack.md)), so
ui-state is never a token-management participant — a backend-401 is an ordinary
upstream error, not a ui-state "reauth" event.

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

Each slot has its own actor-logic type — `ChatAppOnboardingLogic`,
`ChatAppProjectContextLogic`, `ChatAppSessionChatLogic` — that the swap site
casts the provided machine to. The casts are runtime no-ops (XState's `provide`
is type-invariant in a child's context), and the parent reads child readiness
through the `onSnapshot` snapshot views in `setup/types.ts`, not the placeholder
types.

### Input / deps threading (Phase 2)

The children's DI styles differ, and `createChatApp` honors both. Each child
slot pins its own **per-slot input contract** so the parent's three
`invoke.input` mappers are type-checked against the right slot — there is no
single permissive superset where one mapper could accidentally return another
slot's fields. The onboarding slot uses `SessionOnboardingInput` directly (the
real onboarding machine publishes it from `../session-onboarding/index.ts` and
chat-app re-exports it from `setup/types.ts`); the other two slots declare local
`ProjectContextInput` / `SessionChatInput` interfaces in `setup/types.ts`.

The parent machine's own `types.input` is `SessionOnboardingInput` — the
parent's only cold-start path bootstraps into the onboarding phase, so the
parent's begin envelope IS the onboarding child's input.

- **session-onboarding** is config/input-driven — no construction deps. Its
  WorkOS/backend URLs + `fetch` port + re-verify Bearer arrive per-instance on
  `SessionOnboardingInput` (`config` / `deps` / `bearer_token`), seeded
  write-once into `ChatAppContext` and projected into the child by the
  **onboarding invoke `input:` mapper**.
- **project-context** + **session-chat** inject their resolver actors at
  construction (`ChatAppDeps.projectContext` / `.sessionChat`). Their invoke
  `input:` mappers (typed against `ProjectContextInput` / `SessionChatInput`)
  carry only the static `request_id` / `principal_id`; the dynamic org/project
  arrive via the `auth_ready` / `project_ready` hand-offs.

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
    ├── types.ts      context / events / hand-offs / snapshot views / OnboardingResult / per-slot child inputs
    ├── guards.ts     onSnapshot predicates (isUserReady, isUserRejected, advanceToChat, …)
    └── actors.ts     placeholder children (the DI seam) + per-slot logic aliases
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
