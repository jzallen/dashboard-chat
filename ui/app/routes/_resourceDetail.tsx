/* Shared resource-detail body: resolve the deep-linked node off the catalog,
   then render skeleton (pending) / not-found (missing) / ModelDetail (resolved,
   node guaranteed non-null). The three resource route modules (table / view /
   report) are thin wrappers that pass their kind + param. */
import { ModelDetail } from "../../src/app/ModelDetail";
import { useResolvedNode } from "../lib/useResolvedNode";
import { ModelDetailSkeleton, NodeNotFound } from "./_modelDetailStates";
import { useShellContext } from "./_shellContext";

export function ResourceDetail({
  id,
  kind,
}: {
  id: string;
  kind: "dataset" | "view" | "report";
}) {
  const { onOpenNode } = useShellContext();
  const { status, node } = useResolvedNode(id);

  if (status === "pending") return <ModelDetailSkeleton kind={kind} />;
  if (status === "missing") return <NodeNotFound id={id} kind={kind} />;
  return <ModelDetail node={node} onOpen={onOpenNode} />;
}
