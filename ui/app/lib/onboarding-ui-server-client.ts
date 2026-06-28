/**
 * onboarding-ui-server-client — the same-origin HTTP adapter that fulfils the
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
 * why it delegates to {@link apiGet} / {@link apiPost} on the rewritten path
 * rather than re-implementing the unwrap + error mapping.
 *
 * This is the gateway replacement for the `/api`-direct `defaultClient` in
 * routes/onboarding.tsx.
 */
import type { OnboardingClient } from "./onboarding-driver";

export const onboardingUiServerClient: OnboardingClient = {
  get: (_path) => {
    throw new Error("not implemented");
  },
  post: (_path, _body) => {
    throw new Error("not implemented");
  },
};
