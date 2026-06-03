/* Audit-stream view: lineage layers with the AI's transform audit shown inline. */
import { LAYER_ORDER } from "../../lib/catalog";
import { catalog } from "../fixtureSource";
import { LAYER_META } from "../layerMeta";
import { Icon, LayerDot } from "../primitives";
import { TAG_ICON } from "../tagIcon";
import styles from "./lineageCanvas.module.css";
import { AiEditChip } from "./shared";

/** Audit stream skips the source layer — sources have no transforms. */
const STREAM_LAYERS = LAYER_ORDER.slice(1);

export function StreamView({ sel, onOpen, justAdded }) {
  return (
    <div className={styles.stream}>
      {STREAM_LAYERS.map((ly) => {
        const layerMeta = LAYER_META[ly];
        const items = catalog.getNodesByLayer(ly);
        return (
          <div className={`${styles.streamGroup} layer-${ly}`} key={ly}>
            <div className={styles.streamRail} />
            <div className={styles.streamDot} />
            <div className={styles.streamLayer}>
              <LayerDot layer={ly} />
              {layerMeta.name}
              <span className={styles.streamDbt}>{layerMeta.dbt}</span>
            </div>
            {items.map((n) => {
              const audit = catalog.auditFor(n.id);
              return (
                <div
                  key={n.id}
                  className={`${styles.streamCard} layer-${ly}`}
                  data-selected={sel === n.id || undefined}
                  data-just-added={n.id === justAdded || undefined}
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
                      <div className={styles.emptySrc}>
                        Raw upload — no transforms.
                      </div>
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
            })}
          </div>
        );
      })}
    </div>
  );
}
