/* Swimlanes view: one horizontal band per pipeline layer, cards within each.

   A thin container (SwimView/Lane) reads the catalog and derives each card's
   data; LaneCard is pure presentation over plain props and reads the open-node
   callback from context. */
import {
  type DataCatalog,
  type Layer,
  LAYER_ORDER,
  type LineageNode,
} from "../../catalog";
import { LAYER_META } from "../layerMeta";
import { Icon, LayerDot } from "../primitives";
import styles from "./lineageCanvas.module.css";
import { useOpenNode } from "./openNodeContext";
import { AiEditChip } from "./shared";
import { laneCardViewModel } from "./viewModel";

function LaneCard({
  n,
  selected,
  orphan,
  justAdded,
  parentLabels,
  edits,
}: {
  n: LineageNode;
  selected: boolean;
  orphan: boolean;
  justAdded: boolean;
  parentLabels: string[];
  edits: number;
}) {
  const onOpen = useOpenNode();
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
  catalog,
  layer,
  isSelected,
  isOrphaned,
  wasJustAdded,
}: {
  catalog: DataCatalog;
  layer: Layer;
  isSelected: (id: string) => boolean;
  isOrphaned: (id: string) => boolean;
  wasJustAdded: (id: string) => boolean;
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
        {items.map((n) => {
          const vm = laneCardViewModel(catalog, n.id);
          return (
            <LaneCard
              key={n.id}
              n={n}
              selected={isSelected(n.id)}
              orphan={isOrphaned(n.id)}
              justAdded={wasJustAdded(n.id)}
              parentLabels={vm.parentLabels}
              edits={vm.auditCount}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SwimView({
  catalog,
  sel: selectedId,
  flashedNodeId,
}: {
  catalog: DataCatalog;
  sel: string | null;
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
          catalog={catalog}
          layer={ly}
          isSelected={isSelected}
          isOrphaned={isOrphaned}
          wasJustAdded={wasJustAdded}
        />
      ))}
    </div>
  );
}
