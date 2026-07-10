/* Audit-log view: per-layer audit trails of the AI's transforms, one card per model.

   A thin container (AuditLogView/LayerAuditTrail) reads the catalog and derives
   each card's trail; ModelTrailCard is pure presentation over plain props and
   reads the open-node callback from context. */
import {
  type AuditEntry,
  type DataCatalog,
  type Layer,
  LAYER_ORDER,
  type LineageNode,
  SOURCE_LAYER,
} from "../../catalog";
import { LAYER_META } from "../layerMeta";
import { Icon, LayerDot, TAG_ICON } from "../primitives";
import styles from "./lineageCanvas.module.css";
import { useOpenNode } from "./openNodeContext";
import { AiEditChip } from "./shared";
import { auditTrailViewModel } from "./viewModel";

/** The audit log skips the source layer — sources have no transforms. */
const AUDITED_LAYERS = LAYER_ORDER.filter((layer) => layer !== SOURCE_LAYER);

function ModelTrailCard({
  n,
  selected,
  justAdded,
  audit,
}: {
  n: LineageNode;
  selected: boolean;
  justAdded: boolean;
  audit: AuditEntry[];
}) {
  const onOpen = useOpenNode();
  return (
    <div
      className={`${styles.streamCard} layer-${n.layer}`}
      data-selected={selected || undefined}
      data-just-added={justAdded || undefined}
      onClick={() => n.ref && onOpen(n)}
    >
      <div className={styles.scHead}>
        <span className={styles.scName}>
          {n.label} <span className={styles.lite}>· {n.sub}</span>
        </span>
        <AiEditChip
          count={audit.length}
          label="AI edits"
          style={{ marginLeft: "auto" }}
        />
      </div>
      <div className={styles.scAudit}>
        {audit.length === 0 && (
          <div className={styles.emptySrc}>Raw upload — no transforms.</div>
        )}
        {audit.map((a, i) => {
          // A transform toggled off stays in the trail but reads as inactive:
          // faded, with a "disabled" chip.
          const disabled = a.transformId != null && a.enabled === false;
          return (
            <div
              className={`${styles.auditLine}${disabled ? " " + styles.auditDisabled : ""}`}
              key={i}
            >
              <span className={styles.ico}>
                <Icon name={TAG_ICON[a.tag]} />
              </span>
              <span className={styles.auditSayText}>{a.say}</span>
              {disabled && (
                <span className={styles.auditDisabledChip}>disabled</span>
              )}
              <span className={styles.tag}>{a.tag}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LayerAuditTrail({
  catalog,
  layer,
  isSelected,
  wasJustAdded,
}: {
  catalog: DataCatalog;
  layer: Layer;
  isSelected: (id: string) => boolean;
  wasJustAdded: (id: string) => boolean;
}) {
  const layerMeta = LAYER_META[layer];
  const items = catalog.getNodesByLayer(layer);
  return (
    <div className={`${styles.streamGroup} layer-${layer}`}>
      <div className={styles.streamRail} />
      <div className={styles.streamDot} />
      <div className={styles.streamLayer}>
        <LayerDot layer={layer} />
        {layerMeta.name}
        <span className={styles.streamDbt}>{layerMeta.dbt}</span>
      </div>
      {items.map((n) => (
        <ModelTrailCard
          key={n.id}
          n={n}
          selected={isSelected(n.id)}
          justAdded={wasJustAdded(n.id)}
          audit={auditTrailViewModel(catalog, n.id).audit}
        />
      ))}
    </div>
  );
}

export function AuditLogView({
  catalog,
  sel: selectedId,
  flashedNodeId,
}: {
  catalog: DataCatalog;
  sel: string | null;
  flashedNodeId: string | null;
}) {
  const isSelected = (id: string) => selectedId === id;
  const wasJustAdded = (id: string) => id === flashedNodeId;
  return (
    <div className={styles.stream}>
      {AUDITED_LAYERS.map((ly) => (
        <LayerAuditTrail
          key={ly}
          catalog={catalog}
          layer={ly}
          isSelected={isSelected}
          wasJustAdded={wasJustAdded}
        />
      ))}
    </div>
  );
}
