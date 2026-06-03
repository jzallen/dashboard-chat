/**
 * useCatalog — subscribe a React component to the catalog's mutable working
 * state. The catalog owns the rename/archive/restore/live-add state and bumps a
 * version counter on every mutation; this hook bridges that store into React via
 * useSyncExternalStore so any consumer re-renders when the catalog changes.
 *
 * Returns the store version — use it as a memo/effect dependency to recompute
 * derived data (e.g. the lineage graph) off the catalog after a mutation.
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
