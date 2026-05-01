/**
 * Redis-backed PresentationStateLog (Epic F.3 / ADR-015).
 *
 * Implements the same PresentationStateLog contract as
 * InProcessPresentationStateLog, but stores directives in Redis so multiple
 * agent replicas can append from one process and `GET
 * /api/channels/{id}/presentation-state` on a different replica returns the
 * complete log. The in-process variant is single-replica only because each
 * worker holds its own Map; the Redis variant restores cross-replica
 * consistency for the read endpoint.
 *
 * Storage layout (per channel):
 *
 *   presentation:directives:{channelId}     Redis List of JSON-encoded
 *                                           UiDirective records, oldest-first.
 *                                           Append via RPUSH; read via
 *                                           LRANGE 0 -1.
 *   presentation:last-event-at:{channelId}  ISO-8601 timestamp of the most
 *                                           recent append. Stored as a plain
 *                                           string, written via SET on each
 *                                           append.
 *
 * Splitting timestamp into its own key keeps `append` to fixed-size Redis
 * commands (no read-modify-write of a hash containing the full directive
 * array). `get` issues both reads in a single pipeline so the round-trip cost
 * is one RTT.
 *
 * Compaction policy (resolves ADR-015 OQ #5): cap at last N directives via
 * LTRIM immediately after each RPUSH. Picked over "collapse equivalent
 * directives" because:
 *   - Order matters to applyDirective. A filter_directive followed by
 *     filters_cleared followed by another filter_directive cannot be
 *     collapsed without misrepresenting the user-visible state.
 *   - Cross-language consistency. F.2's RedisThreadPersister uses the same
 *     "cap at last N" model (XADD MAXLEN ~).
 *   - Implementation simplicity. LTRIM is O(N) on the trimmed end and
 *     requires zero application-side merge logic; collapse would need to
 *     scan-and-rewrite the list on every append.
 *
 * Cap defaults to 1000 entries. Override via PRESENTATION_STATE_MAXLEN (set
 * to 0 to disable trimming entirely; not recommended outside dev).
 */

import type { UiDirective } from "@dashboard-chat/shared-chat/events";
import type { Redis } from "ioredis";

import {
  type PresentationStateLog,
  type PresentationStateLogEntry,
} from "./presentationState";

const DIRECTIVES_KEY_PREFIX = "presentation:directives:";
const LAST_EVENT_AT_KEY_PREFIX = "presentation:last-event-at:";

export function directivesKey(channelId: string): string {
  return `${DIRECTIVES_KEY_PREFIX}${channelId}`;
}

export function lastEventAtKey(channelId: string): string {
  return `${LAST_EVENT_AT_KEY_PREFIX}${channelId}`;
}

export interface RedisPresentationStateLogOptions {
  /**
   * Cap on the per-channel directive list. After each RPUSH, the list is
   * trimmed to the most recent `maxLen` entries via LTRIM -maxLen -1. Leave
   * undefined or set to 0 for unbounded growth (dev-only).
   */
  maxLen?: number;
  /**
   * Clock injection for deterministic testing. Production callers leave this
   * unset; defaults to `() => new Date()`.
   */
  now?: () => Date;
}

export class RedisPresentationStateLog implements PresentationStateLog {
  private readonly client: Redis;
  private readonly maxLen: number | undefined;
  private readonly now: () => Date;

  constructor(client: Redis, options: RedisPresentationStateLogOptions = {}) {
    this.client = client;
    this.maxLen = options.maxLen && options.maxLen > 0 ? options.maxLen : undefined;
    this.now = options.now ?? (() => new Date());
  }

  async append(channelId: string, directive: UiDirective): Promise<void> {
    if (!channelId) return;
    const dirKey = directivesKey(channelId);
    const tsKey = lastEventAtKey(channelId);
    const ts = this.now().toISOString();
    const encoded = JSON.stringify(directive);

    // Pipeline append + trim + timestamp so the round-trip cost is one RTT.
    // Strict transactional semantics aren't required: concurrent appenders
    // interleaving RPUSH still produce a well-defined Redis-serialized order,
    // and LTRIM on a list at-or-below maxLen is idempotent.
    const pipeline = this.client.pipeline();
    pipeline.rpush(dirKey, encoded);
    if (this.maxLen !== undefined) {
      pipeline.ltrim(dirKey, -this.maxLen, -1);
    }
    pipeline.set(tsKey, ts);
    await pipeline.exec();
  }

  async get(channelId: string): Promise<PresentationStateLogEntry> {
    const dirKey = directivesKey(channelId);
    const tsKey = lastEventAtKey(channelId);

    const pipeline = this.client.pipeline();
    pipeline.lrange(dirKey, 0, -1);
    pipeline.get(tsKey);
    const results = await pipeline.exec();

    // pipeline.exec returns null on a connection error; surface as an empty
    // entry rather than throwing, matching the InProcess log's behavior for
    // unknown channels.
    if (!results) {
      return { channel_id: channelId, directives: [], last_event_at: "" };
    }

    const [lrangeErr, lrangeRaw] = results[0] ?? [null, null];
    const [getErr, getRaw] = results[1] ?? [null, null];
    if (lrangeErr) throw lrangeErr;
    if (getErr) throw getErr;

    const items = (lrangeRaw as string[] | null) ?? [];
    const directives = items.map((s) => JSON.parse(s) as UiDirective);
    const lastEventAt = (getRaw as string | null) ?? "";
    return {
      channel_id: channelId,
      directives,
      last_event_at: lastEventAt,
    };
  }
}
