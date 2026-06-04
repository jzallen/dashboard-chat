/* Audit-log view: per-layer audit trails of the AI's transforms, one card per model. */
import { type Layer, LAYER_ORDER, type LineageNode } from "../../lib/catalog";
import { catalog } from "../fixtureSource";
import { LAYER_META } from "../layerMeta";
import { Icon, LayerDot } from "../primitives";
import { TAG_ICON } from "../tagIcon";
import styles from "./lineageCanvas.module.css";
import { AiEditChip } from "./shared";

/** The audit log skips the source layer — sources have no transforms. */
const AUDITED_LAYERS = LAYER_ORDER.slice(1);

function ModelTrailCard({
  n,
  selected,
  justAdded,
  onOpen,
}: {
  n: LineageNode;
  selected: boolean;
  justAdded: boolean;
  onOpen: (node: LineageNode) => void;
}) {
  const audit = catalog.auditFor(n.id);
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
        {audit.map((a, i) => (
          <div className={styles.auditLine} key={i}>
            <span className={styles.ico}>
              <Icon name={TAG_ICON[a.tag] || TAG_ICON.default} />
            </span>
            <span>{a.say}</span>
            <span className={styles.tag}>{a.tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LayerAuditTrail({
  layer,
  isSelected,
  wasJustAdded,
  onOpen,
}: {
  layer: Layer;
  isSelected: (id: string) => boolean;
  wasJustAdded: (id: string) => boolean;
  onOpen: (node: LineageNode) => void;
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
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

export function AuditLogView({
  sel: selectedId,
  onOpen,
  flashedNodeId,
}: {
  sel: string | null;
  onOpen: (node: LineageNode) => void;
  flashedNodeId: string | null;
}) {
  const isSelected = (id: string) => selectedId === id;
  const wasJustAdded = (id: string) => id === flashedNodeId;
  return (
    <div className={styles.stream}>
      {AUDITED_LAYERS.map((ly) => (
        <LayerAuditTrail
          key={ly}
          layer={ly}
          isSelected={isSelected}
          wasJustAdded={wasJustAdded}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
