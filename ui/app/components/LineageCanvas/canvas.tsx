/* LineageCanvas — the lineage view shell: picks one of three visualizations
   (dag · swimlanes · audit-log), subscribes to catalog mutations, and injects
   the catalog + the open-node callback into the subtree. This is the ONE place
   the presentational views take the `catalog` from — the leaf cards read plain
   data props and the open callback from context, never the store directly. */
import type { LineageNode } from "../../catalog";
import { useCatalogFromContext, useCatalogVersion } from "../useCatalog";
import { AuditLogView } from "./auditLogView";
import { DagView } from "./dagView";
import styles from "./lineageCanvas.module.css";
import { OpenNodeProvider } from "./openNodeContext";
import { SwimView } from "./swimLanes";

export function LineageCanvas({
  mode,
  onOpen,
  sel,
  flashedNodeId,
}: {
  mode: "dag" | "swimlanes" | "audit";
  onOpen: (node: LineageNode) => void;
  sel: string | null;
  flashedNodeId: string | null;
}) {
  const catalog = useCatalogFromContext();
  // Subscribe to catalog mutations; the version is a re-render / memo token the
  // presentational views take as a prop.
  const version = useCatalogVersion();
  return (
    <OpenNodeProvider onOpen={onOpen}>
      <div className={styles.linScroll} style={{ overflowX: "auto" }}>
        {mode === "dag" && (
          <DagView
            catalog={catalog}
            version={version}
            sel={sel}
            flashedNodeId={flashedNodeId}
          />
        )}
        {mode === "swimlanes" && (
          <SwimView catalog={catalog} sel={sel} flashedNodeId={flashedNodeId} />
        )}
        {mode === "audit" && (
          <AuditLogView
            catalog={catalog}
            sel={sel}
            flashedNodeId={flashedNodeId}
          />
        )}
      </div>
    </OpenNodeProvider>
  );
}
