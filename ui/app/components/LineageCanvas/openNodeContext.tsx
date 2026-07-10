/* Open-node callback for the lineage canvas subtree. `onOpen` enters the canvas
   once (from the shell, via Workspace) and is consumed deep in the leaf cards;
   a context spares the view layers between from drilling it as a prop (mirrors
   FlashedNodeProvider). */
import { createContext, type ReactNode, useContext } from "react";

import type { LineageNode } from "../../catalog";

type OpenNode = (node: LineageNode) => void;

const OpenNodeContext = createContext<OpenNode | null>(null);

export function OpenNodeProvider({
  onOpen,
  children,
}: {
  onOpen: OpenNode;
  children: ReactNode;
}) {
  return (
    <OpenNodeContext.Provider value={onOpen}>
      {children}
    </OpenNodeContext.Provider>
  );
}

/** The canvas's open-node callback. Throws outside an {@link OpenNodeProvider}. */
export function useOpenNode(): OpenNode {
  const ctx = useContext(OpenNodeContext);
  if (!ctx)
    throw new Error("useOpenNode must be used within an OpenNodeProvider");
  return ctx;
}
