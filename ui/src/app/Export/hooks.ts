/* Export-drawer open/close state. */
import { useCallback, useState } from "react";

export function useExport() {
  const [open, setOpen] = useState(false);
  const openExport = useCallback(() => setOpen(true), []);
  const closeExport = useCallback(() => setOpen(false), []);
  return { open, openExport, closeExport };
}
export type ExportApi = ReturnType<typeof useExport>;
