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
 * why it delegates to {@link gatewayGet} / {@link gatewayPost} on the rewritten
 * path rather than re-implementing the error mapping.
 *
 * This is the gateway replacement for the `/api`-direct `defaultClient` in
 * routes/onboarding.tsx.
 */
import { gatewayGet, gatewayPost } from "./gateway-client";
import type { OnboardingClient } from "./onboarding-driver";

/** The auth-proxy `/api` prefix the driver hands us, swapped for the same-origin
 *  `/ui-server` broker prefix so the call lands on the SSR route. */
const API_PREFIX = "/api";
const UI_SERVER_PREFIX = "/ui-server";

/** Swap the driver's backend `/api/*` path for the same-origin `/ui-server/*`
 *  broker. The driver only ever passes its `/api`-prefixed route constants
 *  (`/api/orgs/me`, `/api/orgs`, `/api/projects`). A path that does not start with
 *  the `/api` prefix is a contract violation — rejected loudly rather than sliced
 *  into a silently garbled URL. */
function toUiServerPath(apiPath: string): string {
  if (!apiPath.startsWith(API_PREFIX)) {
    throw new Error(
      `onboarding-client: expected an "${API_PREFIX}" path, got "${apiPath}"`,
    );
  }
  return `${UI_SERVER_PREFIX}${apiPath.slice(API_PREFIX.length)}`;
}

/** Flatten a JSON:API resource `{ type, id, attributes }` into `{ id, ...attributes }`. */
function unwrapResource(item: unknown): unknown {
  if (
    item &&
    typeof item === "object" &&
    "attributes" in (item as Record<string, unknown>)
  ) {
    const record = item as Record<string, unknown>;
    return { id: record.id, ...(record.attributes as object) };
  }
  return item;
}

/**
 * Flatten a JSON:API envelope (`{ data: … }`) to the unwrapped payload — a single
 * `{ id, ...attributes }`, or a list mapped the same way. {@link gatewayGet}
 * already does this for the read legs; {@link gatewayPost} returns the raw body,
 * so the write legs flatten here too — the driver reads a flat `{ id, name }`
 * snapshot off a 2xx create.
 */
function unwrapEnvelope(json: unknown): unknown {
  if (json && typeof json === "object" && "data" in (json as object)) {
    const data = (json as { data: unknown }).data;
    return Array.isArray(data) ? data.map(unwrapResource) : unwrapResource(data);
  }
  return json;
}

export const onboardingClient: OnboardingClient = {
  get: (path) => gatewayGet(toUiServerPath(path)),
  post: async (path, body) =>
    unwrapEnvelope(await gatewayPost(toUiServerPath(path), body)),
};
