// Test helpers for the ui-state suites.
//
// ZERO EGRESS (CDO-S5 / ADR-048 §4): the onboarding + project-context machines
// are report-driven and invoke NO actors, so the former mock-`fetch`
// (`makeMockFetch`) + egress `makeTestConfig` (workosUrl/backendUrl) helpers that
// anchored the now-deleted resolvers were retired here at step 05-02. The begin
// envelope no longer carries a load-bearing `config`/`deps`; tests seed identity
// via `OnboardingInput.user` and drive transitions with client-reported outcome
// events.

import type { Config } from "../../config.ts";

/**
 * Build a Redis-only test Config (the in-memory / noop event-log mode — no
 * REDIS_URL). The only field the zero-egress ui-state tier carries.
 */
export function makeTestConfig(): Config {
  return { redisUrl: undefined };
}
