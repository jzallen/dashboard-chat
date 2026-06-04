/* Pipeline workspace: the lineage home view — layer legend, visualization-mode
   toggle, and the lineage canvas. Owns its own visualization mode (the only
   place it's read). */
import { useState } from "react";

import type { Layer, LineageNode } from "../../lib/catalog";
import { useFlashedNode } from "../FlashedNodeProvider";
import { LAYER_META } from "../layerMeta";
import { LineageCanvas } from "../LineageCanvas";
import { Icon, type IconName, LayerDot } from "../primitives";
import styles from "./Workspace.module.css";

type LineageMode = "dag" | "swimlanes" | "audit";

const MODE_OPTS: { key: LineageMode; label: string; icon: IconName }[] = [
  { key: "dag", label: "Flow", icon: "flow" },
  { key: "swimlanes", label: "Lanes", icon: "layers" },
  { key: "audit", label: "Audit", icon: "sparkle" },
];

const LEGEND_LAYERS: Layer[] = ["source", "staging", "intermediate", "mart"];

function Legend() {
  return (
    <div className={styles.legend}>
      {LEGEND_LAYERS.map((ly) => (
        <span className={styles.lg} key={ly}>
          <LayerDot layer={ly} />
          {LAYER_META[ly].name}
          <span
            className="mono"
            style={{ fontSize: 10, color: "var(--text-400)" }}
          >
            {LAYER_META[ly].dbt}
          </span>
        </span>
      ))}
    </div>
  );
}

export function Workspace({ onOpen }: { onOpen: (node: LineageNode) => void }) {
  const [mode, setMode] = useState<LineageMode>("dag");
  const { flashedNodeId } = useFlashedNode();
  return (
    <div className={styles.linWrap}>
      <div className={styles.linHead}>
        <div>
          <div className={styles.linTitle}>Pipeline</div>
          <div className={styles.linSub}>
            Every model the assistant built, across your three dbt layers — raw
            uploads through marts.
          </div>
        </div>
        <div className={styles.seg}>
          {MODE_OPTS.map((o) => (
            <button
              key={o.key}
              className={mode === o.key ? styles.on : undefined}
              onClick={() => setMode(o.key)}
            >
              <Icon name={o.icon} size={15} />
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Legend />
      </div>
      <LineageCanvas
        mode={mode}
        sel={null}
        onOpen={onOpen}
        flashedNodeId={flashedNodeId}
      />
    </div>
  );
}
