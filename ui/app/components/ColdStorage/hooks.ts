/* Cold-storage drawer open/close + restore. */
import { useCallback, useState } from "react";
import { useFetcher } from "react-router";

export function useColdStorage() {
  const [open, setOpen] = useState(false);
  const restoreFetcher = useFetcher();
  const openCold = useCallback(() => setOpen(true), []);
  const closeCold = useCallback(() => setOpen(false), []);
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
