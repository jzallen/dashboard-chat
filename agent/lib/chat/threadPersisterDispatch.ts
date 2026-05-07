/**
 * Capability-presence dispatch for `ThreadEventPersister` (Epic F.2 — ADR-018 (supersedes ADR-017)).
 *
 * Mirrors the Python-side
 * `backend/app/use_cases/session/event_replay_dispatch.py`. The matching
 * Stream.io persister on the agent side is a deferred leaf — until it lands,
 * the only non-noop option is Redis.
 *
 * Forbidden: branching on `NODE_ENV` / `APP_ENV` / etc. The presence of the
 * connection variable is the single source of truth (ADR-018 (supersedes ADR-017)).
 */

import { Redis } from "ioredis";

import { RedisThreadPersister } from "./redisThreadPersister";
import { noopThreadPersister, type ThreadEventPersister } from "./threadPersister";

export type PersisterKind = "redis" | "noop";

export interface PersisterDispatchEnv {
  REDIS_URL?: string;
  REDIS_STREAM_MAXLEN?: string;
}

export interface SelectedPersister {
  persister: ThreadEventPersister;
  kind: PersisterKind;
}

export function selectThreadPersister(env: PersisterDispatchEnv): SelectedPersister {
  if (env.REDIS_URL && env.REDIS_URL.length > 0) {
    const client = new Redis(env.REDIS_URL, {
      // Re-establish silently across short Redis blips; outage longer than
      // the retry window surfaces as a thrown error (caught best-effort by
      // wrapWithTurnDoneAndPersist).
      maxRetriesPerRequest: 1,
      // Defer the TCP connect until first command — keeps construction
      // side-effect-free so `selectThreadPersister` is safe to call from
      // unit tests without a live Redis.
      lazyConnect: true,
    });
    const maxLen = env.REDIS_STREAM_MAXLEN ? Number(env.REDIS_STREAM_MAXLEN) : undefined;
    const options = maxLen && Number.isFinite(maxLen) && maxLen > 0 ? { maxLen } : {};
    return { persister: new RedisThreadPersister(client, options), kind: "redis" };
  }
  return { persister: noopThreadPersister, kind: "noop" };
}
