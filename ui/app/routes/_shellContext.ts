/* The shape the layout route hands its children via <Outlet context>. Route
   modules read it with useShellContext() — the onOpenNode bridge (a source opens
   its upload window, a model routes to its detail view) lives in the shell. */
import { useOutletContext } from "react-router";

import type { LineageNode } from "../catalog";

export type ShellContext = {
  onOpenNode: (node: LineageNode) => void;
};

export function useShellContext(): ShellContext {
  return useOutletContext<ShellContext>();
}
