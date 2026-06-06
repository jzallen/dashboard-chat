/* index route `/` — the pipeline workspace (lineage home). */
import { Workspace } from "../../src/app/Workspace";
import { useShellContext } from "./_shellContext";

export default function WorkspaceRoute() {
  const { onOpenNode } = useShellContext();
  return <Workspace onOpen={onOpenNode} />;
}
