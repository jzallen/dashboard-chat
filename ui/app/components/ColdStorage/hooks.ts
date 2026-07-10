/* Cold-storage drawer open/close + restore. */
import { useCallback } from "react";
import { useFetcher } from "react-router";

import { useDisclosure } from "../../lib/useDisclosure";

export function useColdStorage() {
  const { open, show: openCold, hide: closeCold } = useDisclosure();
  const restoreFetcher = useFetcher();
  const restore = useCallback(
    (id: string) => {
      restoreFetcher.submit(null, {
        method: "POST",
        action: `/ui-server/datasets/${encodeURIComponent(id)}/restore`,
        encType: "application/json",
      });
    },
    [restoreFetcher],
  );
  return { open, openCold, closeCold, restore };
}
export type ColdStorageApi = ReturnType<typeof useColdStorage>;
