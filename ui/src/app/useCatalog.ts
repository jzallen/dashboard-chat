/**
 * useCatalog — subscribe a React component to the catalog's visible lineage
 * graph. The catalog owns the rename/archive/restore/live-add working state and
 * rebuilds a fresh {@link LineageGraph} after every mutation; this hook bridges
 * that store into React via useSyncExternalStore so any consumer re-renders when
 * the catalog changes.
 *
 * Returns the current LineageGraph — read topology/audit off it directly, and
 * use it as a memo/effect dependency (the instance is referentially stable until
 * the next mutation).
 */
import { useSyncExternalStore } from "react";

import type { LineageGraph } from "../lib/catalog";
import { catalog } from "./fixtureSource";

/** Subscribe a component to catalog mutations; returns the visible LineageGraph. */
export function useCatalog(): LineageGraph {
  return useSyncExternalStore(
    catalog.subscribe,
    catalog.getSnapshot,
    catalog.getSnapshot,
  );
}
