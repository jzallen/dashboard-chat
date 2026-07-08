/* Async deep-link resolver.

   A cold deep-link to /view/<backend-uuid> finds catalog.getNode(id) === undefined
   until SWR revalidation commits. RRv7 loaders can read the snapshot but cannot
   await the reactive catalog, so resolution lives in the route component, keyed
   off the catalog version. A bounded timer flips pending→missing so a genuinely
   absent id surfaces a not-found panel instead of spinning forever. */
import { useEffect, useMemo, useState } from "react";

import type { LineageNode } from "../catalog";
import {
  useCatalogContext,
  useCatalogWithSelector,
} from "../components/useCatalog";

/** How long to wait for a node to resolve before declaring it missing. */
const RESOLVE_TIMEOUT_MS = 8000;

export type ResolvedNode =
  | { status: "pending"; node?: undefined }
  | { status: "resolved"; node: LineageNode }
  | { status: "missing"; node?: undefined };

/**
 * Resolve a node by id off the reactive catalog. Re-reads on every catalog
 * commit (the version dep); reports `pending` until the node appears or the
 * bounded timer elapses, then `missing`.
 */
export function useResolvedNode(id: string): ResolvedNode {
  const catalog = useCatalogContext();
  // Re-resolve whenever the graph mutates (a scoped-payload commit lands the
  // deep-linked node); the graph reference is the memo dependency.
  const graph = useCatalogWithSelector((s) => s.graph);
  const node = useMemo(() => catalog.getNode(id), [catalog, id, graph]);
  const [timedOut, setTimedOut] = useState(false);

  // Each id gets exactly one bounded window: on an id change the cleanup clears
  // the prior timer before this effect re-arms a fresh one, so timers never
  // accumulate and a switched id is never declared missing on the old id's clock.
  useEffect(() => {
    setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [id]);

  if (node) return { status: "resolved", node };
  if (timedOut) return { status: "missing" };
  return { status: "pending" };
}
