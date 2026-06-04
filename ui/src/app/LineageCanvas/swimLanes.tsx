/* Swimlanes view: one horizontal band per pipeline layer, cards within each. */
import { type Layer, LAYER_ORDER, type LineageNode } from "../../lib/catalog";
import { catalog } from "../fixtureSource";
import { LAYER_META } from "../layerMeta";
import { Icon, LayerDot } from "../primitives";
import styles from "./lineageCanvas.module.css";
import { AiEditChip } from "./shared";

function LaneCard({
  n,
  selected,
  orphan,
  justAdded,
  onOpen,
}: {
  n: LineageNode;
  selected: boolean;
  orphan: boolean;
  justAdded: boolean;
  onOpen: (node: LineageNode) => void;
}) {
  const parentLabels = catalog.parentsOf(n.id).map((p) => p.label);
  const edits = catalog.auditCount(n.id);
  return (
    <div
      className={`${styles.laneCard} layer-${n.layer}`}
      data-selected={selected || undefined}
      data-orphan={orphan || undefined}
      data-just-added={justAdded || undefined}
      onClick={() => onOpen(n)}
    >
      <div className={styles.lnRow}>
        <span className={styles.lnName}>{n.label}</span>
      </div>
      <div className={styles.lnSub}>{n.sub}</div>
      <div className={styles.lnMeta}>
        {orphan && (
          <span className={styles.orphanTag}>
            <Icon name="x" size={10} />
            Orphaned
          </span>
        )}
        {edits > 0 && <AiEditChip count={edits} />}
      </div>
      {parentLabels.length > 0 && (
        <div className={styles.laneSrc}>
          <Icon name="arrow" size={12} />
          {parentLabels.join(" · ")}
        </div>
      )}
    </div>
  );
}

function Lane({
  layer,
  isSelected,
  isOrphaned,
  wasJustAdded,
  onOpen,
}: {
  layer: Layer;
  isSelected: (id: string) => boolean;
  isOrphaned: (id: string) => boolean;
  wasJustAdded: (id: string) => boolean;
  onOpen: (node: LineageNode) => void;
}) {
  const layerMeta = LAYER_META[layer];
  const items = catalog.getNodesByLayer(layer);
  return (
    <div className={`${styles.lane} layer-${layer}`}>
      <div className={styles.laneHead}>
        <LayerDot layer={layer} />
        <span className={styles.lhName}>{layerMeta.name}</span>
        <span className={styles.lhDbt}>{layerMeta.dbt}</span>
        <span className={styles.lhDesc}>{layerMeta.desc}</span>
      </div>
      <div className={styles.laneBody}>
        {items.map((n) => (
          <LaneCard
            key={n.id}
            n={n}
            selected={isSelected(n.id)}
            orphan={isOrphaned(n.id)}
            justAdded={wasJustAdded(n.id)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

export function SwimView({
  sel: selectedId,
  onOpen,
  flashedNodeId,
}: {
  sel: string | null;
  onOpen: (node: LineageNode) => void;
  flashedNodeId: string | null;
}) {
  const orphans = catalog.orphans();
  const isSelected = (id: string) => selectedId === id;
  const isOrphaned = (id: string) => orphans.has(id);
  const wasJustAdded = (id: string) => id === flashedNodeId;
  return (
    <div className={styles.lanes}>
      {LAYER_ORDER.map((ly) => (
        <Lane
          key={ly}
          layer={ly}
          isSelected={isSelected}
          isOrphaned={isOrphaned}
          wasJustAdded={wasJustAdded}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
