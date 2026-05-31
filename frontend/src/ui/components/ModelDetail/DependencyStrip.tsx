// DependencyStrip — model-detail upstream/downstream dependency strip (MR-5).
//
// Presentational: renders the model's immediate producers (upstream) and
// consumers (downstream) as links to their detail routes
// (dataset → /table/:id, view → /view/:id, report → /report/:id). Pure over its
// props; the data comes from useModelDependencies. Consumes MR-1 tokens.
import clsx from "clsx";
import { Link } from "react-router";

import styles from "./ModelDetail.module.css";

export interface DependencyNode {
  id: string;
  name: string;
  kind: "dataset" | "view" | "report";
}

export interface DependencyStripProps {
  upstream: DependencyNode[];
  downstream: DependencyNode[];
  isLoading?: boolean;
}

const ROUTE_PREFIX: Record<DependencyNode["kind"], string> = {
  dataset: "/table/",
  view: "/view/",
  report: "/report/",
};

const KIND_CLASS: Record<DependencyNode["kind"], string> = {
  dataset: styles.depLinkDataset,
  view: styles.depLinkView,
  report: styles.depLinkReport,
};

function hrefFor(node: DependencyNode): string {
  return `${ROUTE_PREFIX[node.kind]}${node.id}`;
}

function DependencyList({
  nodes,
  label,
  testId,
}: {
  nodes: DependencyNode[];
  label: string;
  testId: string;
}) {
  return (
    <div className={styles.depGroup} data-testid={testId}>
      <span className={styles.depGroupLabel}>{label}</span>
      <ul className={styles.depList}>
        {nodes.map((node) => (
          <li key={node.id}>
            <Link
              to={hrefFor(node)}
              data-testid={`dep-link-${node.id}`}
              className={clsx(styles.depLink, KIND_CLASS[node.kind])}
            >
              {node.name}
              <span className={styles.depKind}>{node.kind}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DependencyStrip({
  upstream,
  downstream,
  isLoading,
}: DependencyStripProps): JSX.Element {
  const isEmpty = upstream.length === 0 && downstream.length === 0;
  return (
    <section className={styles.section} data-testid="dependency-strip">
      <div className={styles.sectionTitle}>Dependencies</div>
      {isLoading ? (
        <div data-testid="dependency-strip-loading" className={styles.emptyState}>
          Loading dependencies…
        </div>
      ) : isEmpty ? (
        <div data-testid="dependency-strip-empty" className={styles.emptyState}>
          No dependencies
        </div>
      ) : (
        <>
          {upstream.length > 0 && (
            <DependencyList nodes={upstream} label="Upstream" testId="dependency-upstream" />
          )}
          {downstream.length > 0 && (
            <DependencyList nodes={downstream} label="Downstream" testId="dependency-downstream" />
          )}
        </>
      )}
    </section>
  );
}
