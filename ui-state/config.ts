import { z } from "zod";

/**
 * Runtime configuration for the ui-state service, validated from the
 * environment at startup. Required values have NO inline defaults — the
 * environment (compose / shell / a `.env` loaded via `node --env-file`) is the
 * single source of truth, and a missing or malformed variable fails fast here
 * (zod names the offending field) rather than silently falling back.
 */
const envSchema = z.object({
  /** Fake-WorkOS (dev) / WorkOS userinfo endpoint — from `FAKE_WORKOS_URL`. */
  workosUrl: z.string().url(),
  /** Backend the ui-state tier calls on behalf of a principal — from `BACKEND_URL`. */
  backendUrl: z.string().url(),
});

/**
 * Identity headers the ui-state tier presents to the backend when acting on
 * behalf of a flow's principal. This is a DEV FIXTURE (the AUTH_MODE=dev user);
 * in production a service-to-service M2M token replaces it (see auth-proxy).
 */
const DEV_USER_HEADERS_FIXTURE: Record<string, string> = {
  "x-user-id": "dev-user-001",
  "x-org-id": "dev-org-001",
  "x-user-email": "dev@localhost",
};

export interface Config extends z.infer<typeof envSchema> {
  /** Dev-user identity fixture (see DEV_USER_HEADERS_FIXTURE). */
  devUserHeadersFixture: Record<string, string>;
}

/**
 * Parse + validate the environment into a typed Config. Throws (fail-fast at
 * startup) when a required variable is missing or malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse({
    workosUrl: env.FAKE_WORKOS_URL,
    backendUrl: env.BACKEND_URL,
  });
  return { ...parsed, devUserHeadersFixture: DEV_USER_HEADERS_FIXTURE };
}
