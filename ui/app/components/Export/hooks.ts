/* Export-drawer open/close state. */
import { useDisclosure } from "../../lib/useDisclosure";

export function useExport() {
  const { open, show: openExport, hide: closeExport } = useDisclosure();
  return { open, openExport, closeExport };
}
export type ExportApi = ReturnType<typeof useExport>;
