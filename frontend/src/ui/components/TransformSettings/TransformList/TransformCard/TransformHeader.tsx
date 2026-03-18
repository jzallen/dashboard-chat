/**
 * Transform card header - displays name and active status badge
 */

import styles from "./TransformCard.module.css";

interface TransformHeaderProps {
  name: string;
  isActive: boolean;
  description?: string;
}

export function TransformHeader({ name, isActive, description }: TransformHeaderProps) {
  return (
    <div className={styles.cardContent}>
      <div className={styles.titleRow}>
        <h3 className={styles.transformName}>{name}</h3>
        {isActive && (
          <span className={styles.activeBadge}>
            Active
          </span>
        )}
      </div>
      {description && (
        <p className={styles.transformDescription}>
          {description}
        </p>
      )}
    </div>
  );
}
