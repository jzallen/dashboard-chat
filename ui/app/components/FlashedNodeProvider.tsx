/* Flashed node — the id of the node most recently created (via a source upload
   or the assistant), held briefly so the canvas can pop it. It's produced at the
   shell (flash) and consumed deep in the canvas (flashedNodeId); a context
   spares the layers between from drilling it. */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type FlashedNodeApi = {
  /** The freshly created node id, or null. Cleared ~1.6s after flash(). */
  flashedNodeId: string | null;
  /** Flash a node as just-created so the canvas pops it. */
  flash: (id: string) => void;
};

const FlashedNodeContext = createContext<FlashedNodeApi | null>(null);

export function FlashedNodeProvider({ children }: { children: ReactNode }) {
  const [flashedNodeId, setFlashedNodeId] = useState<string | null>(null);
  const flash = useCallback((id: string) => {
    setFlashedNodeId(id);
    setTimeout(() => setFlashedNodeId(null), 1600);
  }, []);
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
