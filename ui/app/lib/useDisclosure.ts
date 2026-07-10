/* useDisclosure — boolean open/close state for an overlay (modal, drawer,
   dialog). The single home for the `useState(false)` + open + close trio that
   every overlay hook (export drawer, cold-storage modal, …) was re-deriving. */
import { useCallback, useState } from "react";

export interface Disclosure {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

export function useDisclosure(initial = false): Disclosure {
  const [open, setOpen] = useState(initial);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return { open, show, hide, toggle };
}
