/**
 * Transform card component - displays a saved transform with controls
 */

import type { Transform } from "@/api";
import { countRules } from "@/raqb";
import { TransformHeader } from "./TransformHeader";
import { TransformMetadata } from "./TransformMetadata";
import { SQLPreview } from "./SQLPreview";
import { TransformToggle } from "./TransformToggle";
import { DeleteButton } from "./DeleteButton";
import styles from "./TransformCard.module.css";

interface TransformCardProps {
  transform: Transform;
  onToggle: (transformId: string, isActive: boolean) => void;
  onDelete?: (transformId: string) => void;
}

export function TransformCard({ transform, onToggle, onDelete }: TransformCardProps) {
  const ruleCount = countRules(transform.condition_json);
  const isEnabled = transform.status === 'enabled';

  return (
    <div className={`${styles.transformCard} ${
      isEnabled
        ? styles.transformCardActive
        : styles.transformCardInactive
    }`}>
      <div className={styles.cardHeader}>
        <div>
          <TransformHeader
            name={transform.name}
            isActive={isEnabled}
            description={transform.description ?? undefined}
          />
          <TransformMetadata
            conditionCount={ruleCount}
          />
          {transform.condition_sql && (
            <SQLPreview sql={transform.condition_sql} />
          )}
        </div>
        <div className={styles.actionsColumn}>
          <TransformToggle
            isActive={isEnabled}
            onToggle={() => onToggle(transform.id, !isEnabled)}
          />
          {!isEnabled && onDelete && (
            <DeleteButton onClick={() => onDelete(transform.id)} />
          )}
        </div>
      </div>
    </div>
  );
}
