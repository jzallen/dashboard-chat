/* LineageCanvas — the lineage view shell: picks one of three visualizations
   (dag · swimlanes · audit-log) and subscribes to catalog mutations. */
import type { LineageNode } from "../../lib/catalog";
import { useCatalog } from "../useCatalog";
import { AuditLogView } from "./auditLogView";
import { DagView } from "./dagView";
import styles from "./lineageCanvas.module.css";
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
  // Subscribe to catalog mutations; the version is a re-render / memo token.
  const version = useCatalog();
  return (
    <div className={styles.linScroll} style={{ overflowX: "auto" }}>
      {mode === "dag" && (
        <DagView
          version={version}
          sel={sel}
          onOpen={onOpen}
          flashedNodeId={flashedNodeId}
        />
      )}
      {mode === "swimlanes" && (
        <SwimView sel={sel} onOpen={onOpen} flashedNodeId={flashedNodeId} />
      )}
      {mode === "audit" && (
        <AuditLogView sel={sel} onOpen={onOpen} flashedNodeId={flashedNodeId} />
      )}
    </div>
  );
}
