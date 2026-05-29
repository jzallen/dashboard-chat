# Spike R3 — XState invoked-child snapshot rehydration

**Status:** DONE — R3 risk **retired** (hypothesis disproven; persistence phase de-risked)
**Date:** 2026-05-25
**Owner:** ui-state / ChatApp coordinator
**XState version under test:** `5.31.1` (ui-state lockfile)
**Experiment:** `ui-state/lib/machines/chat-app/spikes/r3-invoked-child-rehydration.spike.test.ts` (4 passing experiments)
**Drives:** Phase 3 (hybrid persistence) of the ChatApp pivot — see
`../design/chatapp-coordinator-review.md` §4 + R3, and ADR-044.

---

## The question

The hybrid-persistence plan (review §4) makes the ChatApp actor's
`getPersistedSnapshot()` the **state-of-record for hot restart** — replacing
per-`flow_id` lazy log rehydration. ChatApp **invokes** its child machines, and
a child can sit in a transient state that itself **invokes a `fromPromise`**
(e.g. session-onboarding `verifying`/`resuming_session` → WorkOS re-verify;
project-context `creating`; session-chat `resuming`).

The review flagged R3 as **HIGH — SPIKE THIS FIRST**, repeating the common
XState lore:

> "`getPersistedSnapshot()` includes invoked children's snapshots, and
> `createActor(machine, {snapshot})` rehydrates them — BUT **in-flight invoked
> promises are NOT resumed**; a child mid-`resuming_session` rehydrates into
> `resuming_session` with no running promise."

If true, a process restart while *any* child was mid-invoke would wedge that flow
forever, and Phase 3 would need recovery scaffolding (re-enter transient states
on rehydrate, a "kick" event, etc.).

## The finding — the lore is FALSE on 5.31.1

Rehydrating a snapshot taken **mid-invoke re-fires the in-flight invoke
automatically.** The promise creator runs a second time and the flow **self-heals**
once the fresh promise settles — no `reenter`, no kick, no recovery code. This
holds **through a JSON round-trip** (the real `getPersistedSnapshot() → JSON →
Redis → JSON → createActor({snapshot})` path), not just the in-memory object.

Faithful reproduction (ChatApp's exact shape — `parent --invoke--> child machine
--(verifying)--invoke--> fromPromise`):

| Exp | Setup | Result |
|---|---|---|
| **E1** | persist while child mid-`verifying`, kill, `createActor({snapshot})` | child restored to `verifying` **and** invoke re-fires (creator runs 2×, fresh deferred pending) |
| **E2** | continue E1, resolve the re-fired promise | child advances to `ready` with the resolved output — **no manual recovery** |
| **E3** | same as E1/E2 but snapshot is `JSON.parse(JSON.stringify(...))` first | identical self-heal — survives serialization |
| **E4** (control) | child reaches `ready` **before** snapshot | restores to `ready`, creator runs only 1× (settled actors are not re-invoked) |

The empirical model:
- A **settled** invoked actor (promise resolved before snapshot) persists its
  result and restores intact — no re-run.
- An **in-flight** invoked actor persists as `active`/pending; on rehydration
  XState re-runs the creator (the promise restarts from scratch).

So the original concern is inverted: the hazard is **not** "the invoke won't
resume" — it's that the invoke **does** resume, i.e. it can run **twice** (once
live, once on rehydrate).

## What this means for Phase 3

**R3 is not a blocker.** Hot restart from `getPersistedSnapshot()` is correct for
in-flight children with **no recovery scaffolding** — drop the planned
re-enter/kick mechanism. Two constraints replace it:

1. **Snapshot at settled states (primary control).** The orchestrator already
   persists at *settled* control states (`waitForSettledState`), where no invoke
   is in-flight. Carry that discipline into ChatApp's snapshot trigger and the
   re-fire is **moot for the canonical path** — a transient `create*` state is
   never the persisted state, so it can never double-fire on restart. This is the
   recommended primary mitigation: it costs nothing (it's today's behavior) and
   makes the re-fire purely a safety net.

2. **Idempotency as defense-in-depth (for write invokes).** If a snapshot is
   *ever* taken mid-transient (e.g. a future write-through-on-every-microstep
   model, or a crash mid-transition), the re-fire re-issues the invoke. Audit of
   every child invoke:

   | Invoke | Kind | Re-fire safe? |
   |---|---|---|
   | `loadSession` (onboarding) | WorkOS re-verify | ✅ read-only |
   | `createOrgAndReissue` (onboarding) | POST /api/orgs + reissue | ✅ idempotent by design (ADR-029) |
   | `resolveInitialScope` (project-context) | read scope | ✅ read-only |
   | `switchProject` (project-context) | set active project | ✅ idempotent (set X twice == set X) |
   | `createProject` (project-context) | POST create project | ⚠️ **non-idempotent** |
   | `loadSessionList` (session-chat) | read list | ✅ read-only |
   | `resumeSession` (session-chat) | attach to session | ✅ idempotent |
   | `switchDatasetContext` (session-chat) | set context | ✅ idempotent |
   | `createSessionEagerly` (session-chat) | create chat session | ⚠️ **non-idempotent** |

   Only `createProject` and `createSessionEagerly` could duplicate a resource on
   re-fire. With mitigation (1) they are never persisted mid-flight, so this is
   latent — but Phase 3 should either (a) confirm the snapshot trigger excludes
   their transient states, or (b) give them an idempotency key, matching
   `createOrgAndReissue`'s existing pattern. **Recommendation: (a) is sufficient;
   (b) is cheap insurance if write-through snapshotting is ever adopted.**

## Decision-ready outcome

- Remove "re-enter transient states / kick on rehydrate" from the Phase 3 plan.
- Phase 3 snapshot trigger = **settled control states only** (inherits the
  orchestrator's `waitForSettledState` discipline).
- File the `createProject` / `createSessionEagerly` idempotency note against
  Phase 3; no action needed now under mitigation (1).
- Keep the spike test as a **living guard**: it will fail if an XState upgrade
  ever changes the re-fire behavior the persistence design now relies on.
