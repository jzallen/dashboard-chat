/**
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

import { catalog } from "./fixtureSource";

/** Subscribe a component to catalog mutations; returns the store version. */
export function useCatalog(): number {
  return useSyncExternalStore(
    catalog.subscribe,
    catalog.getSnapshot,
    catalog.getSnapshot,
  );
}
