/**
 * Redis-backed `ThreadEventPersister` (Epic F.2 — ADR-018 (supersedes ADR-017)).
 *
 * Writes DomainEvents to a Redis Stream keyed by the channel id (the
 * session's `stream_thread_id`). The Python-side `RedisSessionEventReader`
 * reads from the same key with `XRANGE` / strictly-after cursor semantics.
 *
 * Stream key naming MUST match the Python side
 * (`backend/app/use_cases/session/redis_session_event_reader.py:stream_key`).
 * Each stream entry has a single field `data` whose value is the JSON-encoded
 * event. The Redis stream entry id is the cursor downstream consumers see
 * via the read endpoint.
 *
 * Best-effort by contract (`threadPersister.ts:ThreadEventPersister`): a
 * Redis outage MUST NOT block `turn_done` from being emitted on the SSE
 * stream. The caller (`handleChat.ts:wrapWithTurnDoneAndPersist`) catches
 * thrown errors and logs them.
 */

import type { Redis } from "ioredis";

import type { ChatEvent } from "./events";
import { type ThreadEventPersister } from "./threadPersister";

/**
 * Compose the Redis stream key for a session's event log. Mirrors the
 * Python-side `stream_key` helper — keep in sync.
 */
export function streamKey(channelId: string): string {
  return `session:events:${channelId}`;
}

export const EVENT_FIELD = "data";

export interface RedisThreadPersisterOptions {
  /**
   * Optional ceiling on stream length. When set, `XADD MAXLEN ~ <cap>` trims
   * the stream to (approximately) the most recent `cap` entries on each
   * write. Replay consumers tolerate gaps; this protects long-lived sessions
   * from unbounded growth. Leave undefined for unbounded streams.
   */
  maxLen?: number;
}

export class RedisThreadPersister implements ThreadEventPersister {
  private readonly client: Redis;
  private readonly maxLen: number | undefined;

  constructor(client: Redis, options: RedisThreadPersisterOptions = {}) {
    this.client = client;
    this.maxLen = options.maxLen;
  }

  async persist(channelId: string, events: ChatEvent[]): Promise<void> {
    if (events.length === 0 || !channelId) {
      return;
    }
    const key = streamKey(channelId);
    // Sequential XADD calls — Redis assigns the entry id (`*`), so retries
    // cause duplicates rather than corrupted entries (per ADR-018 (supersedes ADR-017)
    // idempotent-write contract). Sequential rather than pipelined because
    // tight pipelining can collide ms-resolution ids in some mock backends
    // (and a typical batch size is <10 events: pipeline savings are noise).
    for (const event of events) {
      const args: (string | number)[] = [key];
      if (this.maxLen !== undefined) {
        args.push("MAXLEN", "~", this.maxLen);
      }
      args.push("*", EVENT_FIELD, JSON.stringify(event));
      await this.client.xadd(...(args as [string, ...(string | number)[]]));
    }
  }
}
