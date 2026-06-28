/**
 * onboarding-client — the same-origin HTTP adapter that fulfils the
 * {@link OnboardingClient} port by routing the driver's read/write legs through
 * the `/ui-server/*` resource routes instead of calling the backend `/api/*`
 * browser-direct.
 *
 * The pure onboarding driver is port-injected and UNCHANGED: it still hands this
 * adapter the backend-shaped path (`/api/orgs/me`, `/api/orgs`, `/api/projects`).
 * This adapter swaps the `/api` prefix for `/ui-server` so the call lands on the
 * SSR broker (which forwards through auth-proxy), while preserving the exact
 * contract the driver depends on — the catalog backendClient semantics: a 2xx
 * returns the unwrapped JSON:API payload; a non-2xx throws
 * {@link ApiError}(status, body); a network/timeout throws a plain Error. That is
 * why it delegates to {@link apiGet} on the rewritten path rather than
 * re-implementing the unwrap + error mapping.
 *
 * This is the gateway replacement for the `/api`-direct `defaultClient` in
 * routes/onboarding.tsx.
 */
import { apiGet } from "../catalog/dataSources/backendClient";
import type { OnboardingClient } from "./onboarding-driver";

/** The auth-proxy `/api` prefix the driver hands us, swapped for the same-origin
 *  `/ui-server` broker prefix so the call lands on the SSR route. */
const API_PREFIX = "/api";
const UI_SERVER_PREFIX = "/ui-server";

function toUiServerPath(apiPath: string): string {
  return apiPath.startsWith(API_PREFIX)
    ? `${UI_SERVER_PREFIX}${apiPath.slice(API_PREFIX.length)}`
    : apiPath;
}

export const onboardingClient: OnboardingClient = {
  get: (path) => apiGet(toUiServerPath(path)),
  post: (path, body) => {
    throw new Error(
      `onboardingClient.post(${path}, ${JSON.stringify(body)}) not implemented`,
    );
  },
};
