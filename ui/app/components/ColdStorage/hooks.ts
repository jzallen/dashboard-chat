/* Cold-storage drawer open/close + restore. */
import { useCallback } from "react";
import { useFetcher } from "react-router";

import { useDisclosure } from "../../lib/useDisclosure";
import { useCatalogFromContext } from "../useCatalog";

export function useColdStorage() {
  const { open, show: openCold, hide: closeCold } = useDisclosure();
  const catalog = useCatalogFromContext();
  const restoreFetcher = useFetcher();
  const restore = useCallback(
    (id: string) => {
      // Restore is routed by the retired node's entity. A source was archived
      // client-side (it backs no backend entity), so it restores LOCALLY through
      // the catalog graph — never a backend POST (that would 404 on the source
      // id). Any other layer is a server-archived dataset and restores through
      // the backend, which clears `archived_at`.
      const item = catalog
        .listColdStorage()
        .find((coldItem) => coldItem.id === id);
      if (item?.layer === "source") {
        catalog.restoreSource(id);
        return;
      }
      restoreFetcher.submit(null, {
        method: "POST",
        action: `/ui-server/datasets/${encodeURIComponent(id)}/restore`,
        encType: "application/json",
      });
    },
    [catalog, restoreFetcher],
  );
  return { open, openCold, closeCold, restore };
}
export type ColdStorageApi = ReturnType<typeof useColdStorage>;
