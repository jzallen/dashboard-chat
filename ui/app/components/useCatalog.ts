/**
 * The catalog composition point — this is where the app decides which
 * CatalogSource backs the catalog. Today it pairs the bundled `fixtureSource`
 * with `createDataCatalog`; swap that one argument for an HTTP source to point
 * the whole app at the backend, with nothing else changing.
 *
 * useCatalog — subscribe a React component to the catalog's mutations. The
 * catalog owns the rename/archive/restore/live-add working state and bumps a
 * version counter after every mutation; this hook bridges that store into React
 * via useSyncExternalStore so any consumer re-renders when the catalog changes.
 *
 * Returns the opaque store version — read lineage data off the `catalog`
 * methods (getNode, getNodesByLayer, parentsOf, …), and use the returned version
 * as a memo/effect dependency to recompute after a mutation. The catalog's
 * internal LineageGraph is never exposed.
 */
import { useSyncExternalStore } from "react";

import { getToken } from "../auth/tokenStorage";
import {
  type CatalogSource,
  createDataCatalog,
  type DataCatalog,
  fixtureSource,
  metadataApiSource,
  type PartialCatalogSource,
} from "../catalog";

/**
 * The application catalog — a live ESM binding, assigned by {@link initCatalog}
 * before the app mounts. The catalog composes the backend `metadataApiSource`
 * (primary, project reads) over the bundled `fixtureSource` (complete fallback),
 * so the app renders instantly on fixtures and the project picker updates to real
 * backend projects a beat later. No module-scope code reads `catalog`, so the
 * deferred assignment is safe.
 */
export let catalog: DataCatalog;

/**
 * The currently scoped project id (the `/project/:projectId` path segment). The
 * backend source reads it via the injected `getProjectId` getter, so the catalog
 * stays router-free. {@link selectProject} sets it and re-scopes the catalog; the
 * `/project/:projectId` layout loader is the single caller. `undefined` before
 * the first paint (the source falls back to the first project until then).
 */
let scopedProjectId: string | undefined;

/**
 * Construct and install the application catalog. The root clientLoader awaits this
 * before the route tree renders, so `catalog` is set before any component reads it.
 * Token + scoped-project getters are injected, keeping the catalog auth- and
 * router-decoupled.
 */
export async function initCatalog(): Promise<void> {
  // Idempotent: the catalog is a one-time session bootstrap. Reassigning it
  // mid-session would rebuild from the fixture seed and drop the live scope,
  // working state, and subscriptions — so a second call is a no-op.
  if (catalog) return;
  catalog = await createDataCatalog(
    metadataApiSource({ getToken, getProjectId: () => scopedProjectId }),
    fixtureSource,
  );
}

/**
 * Re-scope the session catalog to a project: set the module-level scoped pid
 * (so the backend source's next reads target it) THEN delegate to the catalog's
 * own re-scope command. Called by the `/project/:projectId` layout clientLoader
 * on every project change. The single `catalog` instance is preserved so the
 * persistent chrome's subscriptions stay valid.
 */
export function selectProject(projectId: string): Promise<void> {
  scopedProjectId = projectId;
  return catalog.selectProject(projectId);
}

/**
 * Re-fetch the org-global payloads (projects/org/chatScript). The authenticated
 * app shell calls this on entry so real backend projects replace the fixture
 * seed before the home redirect picks a project — it must NOT run unauthenticated
 * (the caller gates on a token), so the login round-trip fires no 401s.
 */
export function refreshOrgGlobal(): Promise<void> {
  return catalog.refreshOrgGlobal();
}

/** The scoped pid the test seam exposes so a primary can read it (mirrors the
 * production `getProjectId` injection). Tests that drive `selectProject` will
 * have this updated; primaries that ignore scope can disregard it. */
export function currentScopedProjectIdForTest(): string | undefined {
  return scopedProjectId;
}

/**
 * Install a catalog composed from explicit sources — the seam route/nav tests
 * use to seed a known fixture catalog (and exercise the async deep-link
 * resolver) without the real backend `metadataApiSource`. Resets the scoped-pid
 * holder so each test starts unscoped. Not used by the app.
 */
export async function installCatalogForTest(
  primary: PartialCatalogSource,
  fallback: CatalogSource,
): Promise<void> {
  scopedProjectId = undefined;
  catalog = await createDataCatalog(primary, fallback);
}

/** Subscribe a component to catalog mutations; returns the store version. */
export function useCatalog(): number {
  return useSyncExternalStore(
    catalog.subscribe,
    catalog.getSnapshot,
    catalog.getSnapshot,
  );
}

/**
 * Toggle a transform-type audit entry through the module-level catalog (the
 * optimistic write-through). Delegates to `catalog.toggleAudit`, mirroring how
 * {@link selectProject} delegates re-scope — components that prefer the module
 * entry point over the bound `catalog` instance call this.
 */
export function toggleAudit(
  nodeId: string,
  auditEntryId: string,
  enabled: boolean,
): Promise<void> {
  return catalog.toggleAudit(nodeId, auditEntryId, enabled);
}
