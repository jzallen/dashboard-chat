/* "Just added" flash — the id of the node most recently created (via a source
   upload or the assistant), held briefly so the canvas can pop it. It's produced
   at the shell (flash) and consumed deep in the canvas (justAddedId); a context
   spares the layers between from drilling it. */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type JustAddedApi = {
  /** The freshly created node id, or null. Cleared ~1.6s after flash(). */
  justAddedId: string | null;
  /** Flag a node as just-created so the canvas pops it. */
  flash: (id: string) => void;
};

const JustAddedContext = createContext<JustAddedApi | null>(null);

export function JustAddedProvider({ children }: { children: ReactNode }) {
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const flash = useCallback((id: string) => {
    setJustAddedId(id);
    setTimeout(() => setJustAddedId(null), 1600);
  }, []);
  const value = useMemo<JustAddedApi>(
    () => ({ justAddedId, flash }),
    [justAddedId, flash],
  );
  return (
    <JustAddedContext.Provider value={value}>
      {children}
    </JustAddedContext.Provider>
  );
}

export function useJustAdded(): JustAddedApi {
  const ctx = useContext(JustAddedContext);
  if (!ctx)
    throw new Error("useJustAdded must be used within a JustAddedProvider");
  return ctx;
}
