// PipelineCanvas — presentational pipeline surface with in-canvas style switch (MR-2).
//
// Holds the active style (Flow / Lanes / Audit) in local state and renders the
// matching view over the SAME graph. Pure presentational — the graph is built
// upstream by the data-connected landing (./index) so the canvas stays testable
// in isolation. Default style is Flow.
import clsx from "clsx";
import { useState } from "react";

import type { LineageGraph } from "../../../core/lineage/buildGraph";
import { AuditView } from "./AuditView";
import { FlowView } from "./FlowView";
import { LanesView } from "./LanesView";
import styles from "./Pipeline.module.css";

export type PipelineStyle = "flow" | "lanes" | "audit";

export interface PipelineCanvasProps {
  graph: LineageGraph;
  /** Optional initial style override (defaults to "flow"). */
  initialStyle?: PipelineStyle;
}

const STYLE_LABELS: ReadonlyArray<{ style: PipelineStyle; label: string }> = [
  { style: "flow", label: "Flow" },
  { style: "lanes", label: "Lanes" },
  { style: "audit", label: "Audit" },
];

export function PipelineCanvas({ graph, initialStyle = "flow" }: PipelineCanvasProps): JSX.Element {
  const [style, setStyle] = useState<PipelineStyle>(initialStyle);

  return (
    <div className={styles.canvas}>
      <div className={styles.switch} role="tablist" aria-label="Pipeline style">
        {STYLE_LABELS.map(({ style: candidate, label }) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            data-testid={`pipeline-style-${candidate}`}
            aria-selected={style === candidate}
            className={clsx(styles.switchButton, style === candidate && styles.switchButtonActive)}
            onClick={() => setStyle(candidate)}
          >
            {label}
          </button>
        ))}
      </div>
      {style === "flow" ? <FlowView graph={graph} /> : null}
      {style === "lanes" ? <LanesView graph={graph} /> : null}
      {style === "audit" ? <AuditView graph={graph} /> : null}
    </div>
  );
}
