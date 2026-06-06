/* Pipeline workspace: the lineage home view — layer legend, visualization-mode
   toggle, and the lineage canvas. The visualization mode lives in the URL as
   `?view=flow|lanes|audit` so it's bookmarkable and part of browser history
   (back/forward steps between modes). The bare project URL is Flow. */
import { useSearchParams } from "react-router";

import type { Layer, LineageNode } from "../../catalog";
import { useFlashedNode } from "../FlashedNodeProvider";
import { LAYER_META } from "../layerMeta";
import { LineageCanvas } from "../LineageCanvas";
import { Icon, type IconName, LayerDot } from "../primitives";
import styles from "./Workspace.module.css";

type LineageMode = "dag" | "swimlanes" | "audit";
/** The URL-facing value of the `view` query param (the canvas uses LineageMode). */
type ViewKey = "flow" | "lanes" | "audit";

const VIEW_PARAM = "view";
const DEFAULT_VIEW: ViewKey = "flow";

const MODE_OPTS: {
  key: ViewKey;
  mode: LineageMode;
  label: string;
  icon: IconName;
}[] = [
  { key: "flow", mode: "dag", label: "Flow", icon: "flow" },
  { key: "lanes", mode: "swimlanes", label: "Lanes", icon: "layers" },
  { key: "audit", mode: "audit", label: "Audit", icon: "sparkle" },
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
  const [searchParams, setSearchParams] = useSearchParams();
  const active =
    MODE_OPTS.find((o) => o.key === searchParams.get(VIEW_PARAM)) ??
    MODE_OPTS[0];
  // Each toggle is a history entry (push, not replace) so back/forward step
  // between modes. Flow is the default → drop the param to keep the URL clean.
  const selectView = (key: ViewKey) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key === DEFAULT_VIEW) next.delete(VIEW_PARAM);
      else next.set(VIEW_PARAM, key);
      return next;
    });
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
              className={active.key === o.key ? styles.on : undefined}
              onClick={() => selectView(o.key)}
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
        mode={active.mode}
        sel={null}
        onOpen={onOpen}
        flashedNodeId={flashedNodeId}
      />
    </div>
  );
}
