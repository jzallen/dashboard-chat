/* Cold-storage drawer open/close + restore. */
import { useCallback } from "react";

import { useDisclosure } from "../../lib/useDisclosure";
import { catalog } from "../useCatalog";

export function useColdStorage() {
  const { open, show: openCold, hide: closeCold } = useDisclosure();
  const restore = useCallback((id: string) => catalog.restoreSource(id), []);
  return { open, openCold, closeCold, restore };
}
export type ColdStorageApi = ReturnType<typeof useColdStorage>;
