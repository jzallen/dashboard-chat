/**
 * jsonapi — the single definition of the JSON:API envelope→flat transform for the
 * `/ui-server` boundary. A backend resource response is a JSON:API envelope
 * (`{ data: { type, id, attributes } }`, or `{ data: [ … ] }` for a collection);
 * the SPA-facing contract is the flat `{ id, ...attributes }` shape. This module
 * owns that unwrap so it lives in exactly one place rather than being copied into
 * each transport.
 *
 * Ownership across the two `/ui-server` legs:
 *  - READ leg — {@link brokerGet} (in `ui-server-client.ts`) applies
 *    {@link unwrapEnvelope} server-side, so `/ui-server/*` GET responses reach the
 *    browser already flat and the browser transport ({@link gatewayGet}) passes
 *    them through untouched.
 *  - WRITE leg — the broker forwards POST bodies byte-intact (a create's
 *    server-assigned id lives under `data`), so the onboarding write adapter calls
 *    {@link unwrapEnvelope} itself on the 2xx create snapshot.
 *
 * Pure and dependency-free on purpose: it is imported by both the server-side
 * broker and the browser-side onboarding adapter, so it must pull no runtime-
 * specific code into either bundle.
 */

/** Flatten a JSON:API resource `{ type, id, attributes }` into `{ id, ...attributes }`.
 *  A value without an `attributes` key is not a resource object and is returned as-is. */
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
 * Flatten a JSON:API envelope (`{ data: … }`) to its unwrapped payload — a single
 * `{ id, ...attributes }`, or a list mapped the same way. A value that is not an
 * envelope (no `data` key) is returned unchanged, so the transform is safe to apply
 * to an already-flat or non-JSON:API body.
 */
export function unwrapEnvelope(json: unknown): unknown {
  if (json && typeof json === "object" && "data" in (json as object)) {
    const data = (json as { data: unknown }).data;
    return Array.isArray(data) ? data.map(unwrapResource) : unwrapResource(data);
  }
  return json;
}
