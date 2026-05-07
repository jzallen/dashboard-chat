/**
 * Capability-presence dispatch for PresentationStateLog (Epic F.3 / ADR-015).
 *
 * Mirrors `threadPersisterDispatch.ts` (ADR-018 (supersedes ADR-017)): the presence of REDIS_URL
 * picks the Redis-backed log; absence falls back to InProcessPresentationStateLog
 * for dev-single-replica use only. The two dispatch helpers share the same
 * env shape on purpose — the agent's chat handler and the
 * presentation-state route both share a single log instance per process, and
 * we want both adapters keyed on the same capability variable so a deployment
 * can't end up with one half durable and the other half ephemeral.
 *
 * Forbidden: branching on NODE_ENV / APP_ENV / ENV (ADR-018 (supersedes ADR-017)).
 */

import { Redis } from "ioredis";

import {
  inProcessPresentationStateLog,
  type PresentationStateLog,
} from "./presentationState";
import { RedisPresentationStateLog } from "./redisPresentationState";

export type PresentationStateLogKind = "redis" | "in-process";

export interface PresentationStateDispatchEnv {
  REDIS_URL?: string;
  PRESENTATION_STATE_MAXLEN?: string;
}

export interface SelectedPresentationStateLog {
  log: PresentationStateLog;
  kind: PresentationStateLogKind;
}

const DEFAULT_MAXLEN = 1000;

function parseMaxLen(raw: string | undefined): number | undefined {
  if (raw === undefined) return DEFAULT_MAXLEN;
  const trimmed = raw.trim();
  if (trimmed === "") return DEFAULT_MAXLEN;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAXLEN;
  // Explicit `0` disables trimming.
  return n === 0 ? undefined : Math.floor(n);
}

export function selectPresentationStateLog(
  env: PresentationStateDispatchEnv,
): SelectedPresentationStateLog {
  if (env.REDIS_URL && env.REDIS_URL.length > 0) {
    const client = new Redis(env.REDIS_URL, {
      // Match selectThreadPersister's connection policy so a Redis blip
      // produces the same observable behavior across both side channels.
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    const maxLen = parseMaxLen(env.PRESENTATION_STATE_MAXLEN);
    const options = maxLen !== undefined ? { maxLen } : {};
    return {
      log: new RedisPresentationStateLog(client, options),
      kind: "redis",
    };
  }
  return { log: inProcessPresentationStateLog, kind: "in-process" };
}
