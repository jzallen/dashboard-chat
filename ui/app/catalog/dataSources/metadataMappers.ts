/**
 * metadataMappers — the PURE org-global boundary mappers, shared by the browser
 * {@link metadataApiSource} (via `apiGet`, which envelope-unwraps for it) and the
 * server-side app-shell `loader` (via `apiFetch`, which returns the RAW upstream
 * Response — so the loader unwraps the JSON:API envelope itself with
 * {@link unwrapList}/{@link unwrapSingle} here).
 *
 * No React, no HTTP, no auth imports — just `snake_case` backend resource → the
 * catalog's `camelCase` DTO. Kept free of side effects so both the client source
 * and the BFF loader map identically off one definition (no drift).
 */
import type { OrgMember, OrgSettings, ProjectSummary } from "../models";

/** A project resource as the backend returns it (post envelope-unwrap). */
export interface BackendProject {
  id: string;
  name: string;
  description?: string | null;
  datasets?: unknown[];
}

/**
 * The org-settings resource as the backend returns it (post envelope-unwrap):
 * snake_case attributes, flat alongside the resource `id`. Mapped to the
 * camelCase {@link OrgSettings} by {@link toOrgSettings}.
 */
export interface BackendOrg {
  id: string;
  name: string;
  slug: string;
  region: string;
  plan: string;
  seats: number;
  used_seats: number;
  created_at: string;
  members: OrgMember[];
  defaults: { engine: string; materialization: string; model_prefix: string };
}

/**
 * Map a backend project to the catalog's project-list DTO. `models` is 0 (not yet
 * backed by the API); `datasets` is the count of attached datasets.
 */
export function toProjectSummary(project: BackendProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    desc: project.description ?? "",
    datasets: project.datasets?.length ?? 0,
    models: 0,
  };
}

/** Map the backend org payload (snake_case) to the catalog's {@link OrgSettings}. */
export function toOrgSettings(org: BackendOrg): OrgSettings {
  return {
    name: org.name,
    slug: org.slug,
    region: org.region,
    plan: org.plan,
    seats: org.seats,
    usedSeats: org.used_seats,
    created: org.created_at,
    members: org.members,
    defaults: {
      engine: org.defaults.engine,
      materialization: org.defaults.materialization,
      modelPrefix: org.defaults.model_prefix,
    },
  };
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

/** The `data` member of a JSON:API envelope, or the value itself when unwrapped. */
function envelopeData(json: unknown): unknown {
  return json && typeof json === "object" && "data" in json
    ? (json as { data: unknown }).data
    : json;
}

/**
 * Unwrap a JSON:API LIST body (`{ data: [{ type, id, attributes }] }`) to flat
 * resources. Mirrors the browser `apiGet` unwrap so the server loader maps the
 * raw `apiFetch` Response identically. A non-array `data` yields `[]`.
 */
export function unwrapList<T>(json: unknown): T[] {
  const data = envelopeData(json);
  return (Array.isArray(data) ? data.map(unwrapResource) : []) as T[];
}

/**
 * Unwrap a JSON:API SINGLE body (`{ data: { type, id, attributes } }`) to a flat
 * resource. Mirrors the browser `apiGet` unwrap for the server loader.
 */
export function unwrapSingle<T>(json: unknown): T {
  return unwrapResource(envelopeData(json)) as T;
}
