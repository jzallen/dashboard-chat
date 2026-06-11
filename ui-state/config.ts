import { z } from "zod";

/**
 * Runtime configuration for the ui-state service, validated from the
 * environment at startup. After the CDO-S5 zero-egress cleanup (ADR-048 §4) the
 * ui-state tier holds NO live network egress, so its startup config shrinks to
 * REDIS ONLY — the former `workosUrl` (FAKE_WORKOS_URL) + `backendUrl`
 * (BACKEND_URL) variables fed the deleted onboarding/project-context egress
 * resolvers and are gone. The container now boots WITHOUT those env vars set
 * (step 05-06 removes them from compose). A missing/malformed REDIS_URL is the
 * only fail-fast surface; an ABSENT REDIS_URL is the explicit in-memory mode.
 */
const envSchema = z.object({
  /** Redis backing for the flow event log — from `REDIS_URL`. Absent ⇒ the
   *  in-memory (noop) event log; this is an explicit mode, not a missing var. */
  redisUrl: z.string().optional(),
  /** Sliding TTL (seconds) applied to every persisted ui-state key (snapshot +
   *  per-flow event logs) — from `FLOW_TTL_SECONDS`. Each write refreshes it, and
   *  the client keep-alive (`POST /state/keepalive`, debounce-driven by the idle
   *  tracker) bumps it during active-but-idle use. When the window lapses the keys
   *  expire and the next read re-derives the anonymous (`login`) document — so an
   *  abandoned session resets to login. Optional here; the persistence adapters
   *  apply the default (1800s / 30m) when it is unset — comfortably above the idle
   *  tracker's 5-min keep-alive cadence, and ≈ its 20m+10m idle→logout window. */
  flowTtlSeconds: z.coerce.number().int().positive().optional(),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Parse + validate the environment into a typed Config. Redis-only: the sole
 * field is the optional `redisUrl`, so this never throws on the zero-egress
 * deployment (no required network URLs remain).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse({
    redisUrl: env.REDIS_URL,
    flowTtlSeconds: env.FLOW_TTL_SECONDS,
  });
}
