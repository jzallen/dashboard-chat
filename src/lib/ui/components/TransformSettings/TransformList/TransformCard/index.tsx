/**
 * Transform card component - displays a saved transform with controls
 */

import type { Transform } from "@/api";
import { countRules } from "@/raqb";
import { TransformHeader } from "./TransformHeader";
import { TransformMetadata } from "./TransformMetadata";
import { SQLPreview } from "./SQLPreview";
import { TransformToggle } from "./TransformToggle";
import styles from "./TransformCard.module.css";

interface TransformCardProps {
  transform: Transform;
  onToggle: (transformId: string, isActive: boolean) => void;
}

export function TransformCard({ transform, onToggle }: TransformCardProps) {
  const ruleCount = countRules(transform.raqb_json);
  const createdDate = new Date(transform.created_at).toLocaleDateString();

  return (
    <div className={`${styles.transformCard} ${
      transform.is_active
        ? styles.transformCardActive
        : styles.transformCardInactive
    }`}>
      <div className={styles.cardHeader}>
        <div>
          <TransformHeader
            name={transform.name}
            isActive={transform.is_active}
            description={transform.description ?? undefined}
          />
          <TransformMetadata
            conditionCount={ruleCount}
            version={transform.version}
            createdDate={createdDate}
          />
          {transform.cached_sql && (
            <SQLPreview sql={transform.cached_sql} />
          )}
        </div>
        <div className={styles.actionsColumn}>
          <TransformToggle
            isActive={transform.is_active}
            onToggle={() => onToggle(transform.id, !transform.is_active)}
          />
        </div>
      </div>
    </div>
  );
}
