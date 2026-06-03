/* Swimlanes view: one horizontal band per pipeline layer, cards within each. */
import { LAYER_ORDER } from "../../lib/catalog";
import { catalog } from "../fixtureSource";
import { LAYER_META } from "../layerMeta";
import { Icon, LayerDot } from "../primitives";
import styles from "./lineageCanvas.module.css";
import { AiEditChip } from "./shared";

export function SwimView({ sel, onOpen, justAdded }) {
  const orphans = catalog.orphans();
  return (
    <div className={styles.lanes}>
      {LAYER_ORDER.map((ly) => {
        const layerMeta = LAYER_META[ly];
        const items = catalog.getNodesByLayer(ly);
        return (
          <div className={`${styles.lane} layer-${ly}`} key={ly}>
            <div className={styles.laneHead}>
              <LayerDot layer={ly} />
              <span className={styles.lhName}>{layerMeta.name}</span>
              <span className={styles.lhDbt}>{layerMeta.dbt}</span>
              <span className={styles.lhDesc}>{layerMeta.desc}</span>
            </div>
            <div className={styles.laneBody}>
              {items.map((n) => {
                const parentLabels = catalog
                  .parentsOf(n.id)
                  .map((p) => p.label);
                const edits = catalog.auditCount(n.id);
                return (
                  <div
                    key={n.id}
                    className={`${styles.laneCard} layer-${ly}`}
                    data-selected={sel === n.id || undefined}
                    data-orphan={orphans.has(n.id) || undefined}
                    data-just-added={n.id === justAdded || undefined}
                    onClick={() => onOpen(n)}
                  >
                    <div className={styles.lnRow}>
                      <span className={styles.lnName}>{n.label}</span>
                    </div>
                    <div className={styles.lnSub}>{n.sub}</div>
                    <div className={styles.lnMeta}>
                      {orphans.has(n.id) && (
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
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
