/* Swimlanes view: one horizontal band per pipeline layer, cards within each. */
import { LAYER_ORDER } from "../../lib/catalog";
import { catalog } from "../fixtureSource";
import { LAYER_META } from "../layerMeta";
import { Icon, LayerDot } from "../primitives";
import { AiEditChip, cx } from "./shared";

export function SwimView({ sel, onOpen, justAdded }) {
  const orphans = catalog.orphans();
  return (
    <div className="lanes">
      {LAYER_ORDER.map((ly) => {
        const layerMeta = LAYER_META[ly];
        const items = catalog.getNodesByLayer(ly);
        return (
          <div className={`lane layer-${ly}`} key={ly}>
            <div className="lane-head">
              <LayerDot layer={ly} />
              <span className="lh-name">{layerMeta.name}</span>
              <span className="lh-dbt">{layerMeta.dbt}</span>
              <span className="lh-desc">{layerMeta.desc}</span>
            </div>
            <div className="lane-body">
              {items.map((n) => {
                const parentLabels = catalog
                  .parentsOf(n.id)
                  .map((p) => p.label);
                const edits = catalog.auditCount(n.id);
                return (
                  <div
                    key={n.id}
                    className={cx(
                      "lane-card",
                      sel === n.id && "sel",
                      orphans.has(n.id) && "orphan",
                      n.id === justAdded && "pop",
                      `layer-${ly}`,
                    )}
                    onClick={() => onOpen(n)}
                  >
                    <div className="ln-row">
                      <span className="ln-name">{n.label}</span>
                    </div>
                    <div className="ln-sub">{n.sub}</div>
                    <div className="ln-meta">
                      {orphans.has(n.id) && (
                        <span className="orphan-tag">
                          <Icon name="x" size={10} />
                          Orphaned
                        </span>
                      )}
                      {edits > 0 && <AiEditChip count={edits} />}
                    </div>
                    {parentLabels.length > 0 && (
                      <div className="lane-src">
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
