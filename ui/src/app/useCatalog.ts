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
  createDataCatalog,
  type DataCatalog,
  fixtureSource,
  metadataApiSource,
} from "../lib/catalog";

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
 * Construct and install the application catalog. `main.js` awaits this in the
 * authenticated paths BEFORE `mount()`, guaranteeing `catalog` is set before any
 * component reads it. Token is injected (lib/catalog stays auth-decoupled).
 */
export async function initCatalog(): Promise<void> {
  catalog = await createDataCatalog(
    metadataApiSource({ getToken }),
    fixtureSource,
  );
}

/** Subscribe a component to catalog mutations; returns the store version. */
export function useCatalog(): number {
  return useSyncExternalStore(
    catalog.subscribe,
    catalog.getSnapshot,
    catalog.getSnapshot,
  );
}
