/* LineageCanvas — the lineage view shell: picks one of three visualizations
   (dag · swimlanes · audit-log) and subscribes to catalog mutations. */
import { useCatalog } from "../useCatalog";
import { AuditLogView } from "./auditLogView";
import { DagView } from "./dagView";
import styles from "./lineageCanvas.module.css";
import { SwimView } from "./swimLanes";

export function LineageCanvas({ mode, onOpen, sel, justAdded }) {
  // Subscribe to catalog mutations; the version is a re-render / memo token.
  const version = useCatalog();
  return (
    <div className={styles.linScroll} style={{ overflowX: "auto" }}>
      {mode === "dag" && (
        <DagView
          version={version}
          sel={sel}
          onOpen={onOpen}
          justAdded={justAdded}
        />
      )}
      {mode === "swimlanes" && (
        <SwimView sel={sel} onOpen={onOpen} justAdded={justAdded} />
      )}
      {mode === "audit" && (
        <AuditLogView sel={sel} onOpen={onOpen} justAdded={justAdded} />
      )}
    </div>
  );
}
