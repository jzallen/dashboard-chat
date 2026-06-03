/* Audit-stream view: lineage layers with the AI's transform audit shown inline. */
import { LAYER_ORDER } from "../../lib/catalog";
import { catalog } from "../fixtureSource";
import { LAYER_META } from "../layerMeta";
import { Icon, LayerDot } from "../primitives";
import { TAG_ICON } from "../tagIcon";
import { AiEditChip, cx } from "./shared";

/** Audit stream skips the source layer — sources have no transforms. */
const STREAM_LAYERS = LAYER_ORDER.slice(1);

export function StreamView({ sel, onOpen, justAdded }) {
  return (
    <div className="stream">
      {STREAM_LAYERS.map((ly) => {
        const layerMeta = LAYER_META[ly];
        const items = catalog.getNodesByLayer(ly);
        return (
          <div className={`stream-group layer-${ly}`} key={ly}>
            <div className="stream-rail" />
            <div className="stream-dot" />
            <div className="stream-layer">
              <LayerDot layer={ly} />
              {layerMeta.name}
              <span className="stream-dbt">{layerMeta.dbt}</span>
            </div>
            {items.map((n) => {
              const audit = catalog.auditFor(n.id);
              return (
                <div
                  key={n.id}
                  className={cx(
                    "stream-card",
                    sel === n.id && "sel",
                    n.id === justAdded && "pop",
                    `layer-${ly}`,
                  )}
                  onClick={() => n.ref && onOpen(n)}
                >
                  <div className="sc-head">
                    <span className="sc-name">
                      {n.label} <span className="lite">· {n.sub}</span>
                    </span>
                    <AiEditChip
                      count={audit.length}
                      label="AI edits"
                      style={{ marginLeft: "auto" }}
                    />
                  </div>
                  <div className="sc-audit">
                    {audit.length === 0 && (
                      <div className="empty-src">
                        Raw upload — no transforms.
                      </div>
                    )}
                    {audit.map((a, i) => (
                      <div className="audit-line" key={i}>
                        <span className="ico">
                          <Icon name={TAG_ICON[a.tag] || TAG_ICON.default} />
                        </span>
                        <span>{a.say}</span>
                        <span className="tag">{a.tag}</span>
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
