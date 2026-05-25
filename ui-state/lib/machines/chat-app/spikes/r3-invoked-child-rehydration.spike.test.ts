// R3 SPIKE — XState v5 invoked-child snapshot rehydration (in-flight invoke).
//
// QUESTION (review §4 / R3, "SPIKE THIS FIRST"): the hybrid persistence plan
// makes the ChatApp actor's `getPersistedSnapshot()` the state-of-record for
// hot restart. ChatApp INVOKES child machines; a child (e.g. session-onboarding)
// sits in `verifying`/`resuming_session` INVOKING a `fromPromise` (WorkOS
// re-verify). The review claimed (HYPOTHESIS, taken from XState lore):
//
//   "getPersistedSnapshot() includes invoked children's snapshots, and
//    createActor(machine, {snapshot}) rehydrates them — BUT in-flight invoked
//    promises are NOT resumed; a child mid-resuming_session rehydrates into
//    resuming_session with no running promise."
//
// FINDING (this spike, xstate 5.31.1): the hypothesis is FALSE on our version.
// Rehydrating a snapshot taken mid-invoke RE-FIRES the in-flight invoke
// automatically — the promise creator runs again and the flow self-heals once
// the (fresh) promise settles. No `reenter`/kick recovery is required. The only
// design constraint this imposes is IDEMPOTENCY: a child invoke can run twice
// (once live, once on rehydrate), so every invoked side effect must be safe to
// repeat. See E1/E2 below; E3 is the settled-child control.
//
// Faithful minimal reproduction of ChatApp's shape:
//   parent  --invoke-->  child machine  --(verifying)--invoke-->  fromPromise
//
// Run: cd ui-state && npx vitest run lib/machines/chat-app/spikes
//
// This file is a THROWAWAY experiment kept as a documented artifact; it is not
// part of the chat-app machine's behavioral suite.

import { describe, it, expect, beforeEach } from "vitest";
import { assign, createActor, fromPromise, sendTo, setup } from "xstate";

// A promise we resolve by hand, so the invoke stays pending at snapshot time.
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// --- the experiment's instrumentation --------------------------------------
// `loadSession` records how many times the promise CREATOR actually runs and
// hands back a fresh deferred each time. If rehydration re-fires the invoke,
// the count goes up; if not, it stays put (and the deferred is never created
// again, i.e. nothing is awaiting anything → wedged).
let invokeCount = 0;
let lastDeferred: Deferred<string> | null = null;

beforeEach(() => {
  invokeCount = 0;
  lastDeferred = null;
});

// child machine: idle --START--> verifying (invokes loadSession) --done--> ready
// `verifying` also carries the candidate RECOVERY hook tested in E2: a
// self-targeted REHYDRATE_KICK with reenter:true.
const child = setup({
  types: {} as { context: { result: string | null } },
  actors: {
    loadSession: fromPromise<string, void>(() => {
      invokeCount += 1;
      lastDeferred = defer<string>();
      return lastDeferred.promise;
    }),
  },
}).createMachine({
  id: "child",
  initial: "idle",
  context: { result: null },
  states: {
    idle: { on: { START: "verifying" } },
    verifying: {
      invoke: {
        src: "loadSession",
        onDone: {
          target: "ready",
          actions: assign({ result: ({ event }) => event.output }),
        },
        onError: "rejected",
      },
    },
    ready: {},
    rejected: {},
  },
});

// parent machine: invokes the child, forwards control events to it — the exact
// ChatApp "parent invokes child" relationship.
const parent = setup({
  actors: { child },
}).createMachine({
  id: "parent",
  initial: "running",
  states: {
    running: {
      invoke: { src: "child", id: "child" },
      on: {
        START_CHILD: { actions: sendTo("child", { type: "START" }) },
      },
    },
  },
});

const childValueOf = (actor: ReturnType<typeof createActor>) =>
  (actor.getSnapshot().children as any).child?.getSnapshot().value;

describe("R3 — invoked-child rehydration from a persisted snapshot", () => {
  it("E1: rehydrates the child's STATE *and* re-fires its in-flight invoke", async () => {
    const live = createActor(parent).start();
    live.send({ type: "START_CHILD" });
    await flush();

    // Pre-snapshot: child mid-invoke, promise creator ran exactly once.
    expect(childValueOf(live)).toBe("verifying");
    expect(invokeCount).toBe(1);

    // Persist mid-flight, then kill the process (abandon the pending promise).
    const persisted = live.getPersistedSnapshot();
    live.stop();

    // Rehydrate on a "fresh process".
    const restored = createActor(parent, { snapshot: persisted }).start();
    await flush();

    // The child's STATE VALUE is faithfully restored...
    expect(childValueOf(restored)).toBe("verifying");

    // ...AND, contrary to the R3 hypothesis, the invoke RE-FIRES: the creator
    // ran a SECOND time and there is a fresh, live deferred awaiting a result.
    expect(invokeCount).toBe(2);
    expect(lastDeferred).not.toBeNull();

    restored.stop();
  });

  it("E2: the rehydrated flow SELF-HEALS — settling the re-fired invoke advances it, no kick", async () => {
    const live = createActor(parent).start();
    live.send({ type: "START_CHILD" });
    await flush();
    const persisted = live.getPersistedSnapshot();
    live.stop();

    const restored = createActor(parent, { snapshot: persisted }).start();
    await flush();
    // The invoke already re-fired on rehydration (E1). No manual recovery.
    expect(invokeCount).toBe(2);

    // Settling the FRESH (post-rehydrate) promise drives the child to `ready`
    // exactly as if the process had never died.
    lastDeferred!.resolve("verified-user");
    await flush();

    expect(childValueOf(restored)).toBe("ready");
    expect((restored.getSnapshot().children as any).child.getSnapshot().context.result).toBe(
      "verified-user",
    );

    restored.stop();
  });

  it("E3: the re-fire survives a JSON round-trip (the real Redis persistence path)", async () => {
    // The hot-restart path is getPersistedSnapshot() -> JSON -> Redis -> JSON
    // -> createActor({snapshot}). E1/E2 passed the in-memory object directly;
    // this asserts the same self-heal through actual serialization.
    const live = createActor(parent).start();
    live.send({ type: "START_CHILD" });
    await flush();
    expect(childValueOf(live)).toBe("verifying");

    const wireBytes = JSON.stringify(live.getPersistedSnapshot());
    live.stop();

    const fromWire = JSON.parse(wireBytes);
    const restored = createActor(parent, { snapshot: fromWire }).start();
    await flush();

    expect(childValueOf(restored)).toBe("verifying");
    expect(invokeCount).toBe(2); // re-fired after deserialization, too

    lastDeferred!.resolve("verified-user");
    await flush();
    expect(childValueOf(restored)).toBe("ready");

    restored.stop();
  });

  it("E4: a child that had SETTLED before the snapshot rehydrates intact (control)", async () => {
    const live = createActor(parent).start();
    live.send({ type: "START_CHILD" });
    await flush();
    // Let the invoke complete BEFORE snapshotting.
    lastDeferred!.resolve("verified-user");
    await flush();
    expect(childValueOf(live)).toBe("ready");

    const persisted = live.getPersistedSnapshot();
    live.stop();

    const restored = createActor(parent, { snapshot: persisted }).start();
    await flush();

    // A settled child needs no invoke to resume — it restores cleanly and the
    // creator is never re-run.
    expect(childValueOf(restored)).toBe("ready");
    expect(invokeCount).toBe(1);

    restored.stop();
  });
});
