/* Flashed node — the id of the node most recently created (via a source upload
   or the assistant), held briefly so the canvas can pop it. It's produced at the
   shell (flash) and consumed deep in the canvas (flashedNodeId); a context
   spares the layers between from drilling it. */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** How long a freshly created node stays flashed before the canvas settles. */
const FLASH_DURATION_MS = 1600;

type FlashedNodeApi = {
  /** The freshly created node id, or null. Cleared ~1.6s after flash(). */
  flashedNodeId: string | null;
  /** Flash a node as just-created so the canvas pops it. */
  flash: (id: string) => void;
};

const FlashedNodeContext = createContext<FlashedNodeApi | null>(null);

export function FlashedNodeProvider({ children }: { children: ReactNode }) {
  const [flashedNodeId, setFlashedNodeId] = useState<string | null>(null);
  // Hold the pending clear timer so a rapid re-flash restarts the countdown and
  // unmount can cancel it (no setState after teardown).
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((id: string) => {
    if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    setFlashedNodeId(id);
    clearTimer.current = setTimeout(() => {
      clearTimer.current = null;
      setFlashedNodeId(null);
    }, FLASH_DURATION_MS);
  }, []);
  useEffect(
    () => () => {
      if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    },
    [],
  );
  const value = useMemo<FlashedNodeApi>(
    () => ({ flashedNodeId, flash }),
    [flashedNodeId, flash],
  );
  return (
    <FlashedNodeContext.Provider value={value}>
      {children}
    </FlashedNodeContext.Provider>
  );
}

export function useFlashedNode(): FlashedNodeApi {
  const ctx = useContext(FlashedNodeContext);
  if (!ctx)
    throw new Error("useFlashedNode must be used within a FlashedNodeProvider");
  return ctx;
}
