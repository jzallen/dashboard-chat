/* Cold-storage drawer open/close + restore. */
import { useCallback, useState } from "react";

import { catalog } from "../useCatalog";

export function useColdStorage() {
  const [open, setOpen] = useState(false);
  const openCold = useCallback(() => setOpen(true), []);
  const closeCold = useCallback(() => setOpen(false), []);
  const restore = useCallback((id: string) => catalog.restoreSource(id), []);
  return { open, openCold, closeCold, restore };
}
export type ColdStorageApi = ReturnType<typeof useColdStorage>;
