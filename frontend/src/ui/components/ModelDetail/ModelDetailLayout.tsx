// ModelDetailLayout — consistent single-page model-detail shell (MR-5).
//
// Presentational: the shared chrome that gives dataset / view / report detail
// pages one consistent layout — a scrolling content column (title + badges +
// description + the section children) plus the existing chat affordances
// (activity log overlay + input bar) as siblings. Consumes MR-1 tokens.
import type { ReactNode } from "react";

import styles from "./ModelDetail.module.css";

export interface ModelDetailLayoutProps {
  title: string;
  badges?: ReactNode;
  description?: string | null;
  children: ReactNode;
  activityLog?: ReactNode;
  inputBar?: ReactNode;
}

export function ModelDetailLayout({
  title,
  badges,
  description,
  children,
  activityLog,
  inputBar,
}: ModelDetailLayoutProps): JSX.Element {
  return (
    <div className={styles.container} data-testid="model-detail">
      <div className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.title} data-testid="model-detail-title">
            {title}
          </h1>
          {badges && <div className={styles.badges}>{badges}</div>}
        </div>
        {description && <p className={styles.description}>{description}</p>}
        {children}
      </div>
      {activityLog}
      {inputBar}
    </div>
  );
}
