/* Layer-aware primitives. `layer` selects styling via the CSS module;
   `size` feeds the --dot-size custom property. */
import { type CSSProperties, type ReactNode } from "react";

import { type Layer } from "../../catalog";
import styles from "../primitives.module.css";

export function LayerDot({ layer, size = 9 }: { layer: Layer; size?: number }) {
  return (
    <span
      className={`${styles.dot} ${styles[layer] || ""}`}
      style={{ "--dot-size": `${size}px` } as CSSProperties}
    />
  );
}

export function LayerBadge({
  layer,
  children,
}: {
  layer?: Layer;
  children?: ReactNode;
}) {
  if (!layer) return null;
  return (
    <span className={`${styles.badge} ${styles[layer] || ""}`}>
      <LayerDot layer={layer} size={7} />
      {children || layer}
    </span>
  );
}
