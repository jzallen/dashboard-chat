import styles from "./LayerBadge.module.css";

const layerStyles: Record<string, string> = {
  dataset: styles.dataset,
  view: styles.view,
  report: styles.report,
};

interface LayerBadgeProps {
  layer: string;
  modelName: string;
}

/** Small badge indicating the current model layer (dataset, view, or report). */
export function LayerBadge({ layer, modelName }: LayerBadgeProps) {
  return (
    <span className={`${styles.badge} ${layerStyles[layer] ?? styles.dataset}`}>
      {layer}: {modelName}
    </span>
  );
}
