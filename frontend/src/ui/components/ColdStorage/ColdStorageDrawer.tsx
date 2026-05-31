// ColdStorageDrawer — the "fridge" (MR-7).
//
// Lists archived sources (useArchivedDatasets → listDatasetsForProject(..,{archived:true}))
// with retired-at (archived_at), retention-end (retention_until), a days-left badge (the pure
// daysLeft helper, clock injected at render), and a Restore button (useRestoreDataset). When
// the archived list is empty it renders a playful, deterministic random-food empty state.
// Returns null while closed. Detached from the assistant; consumes MR-1 tokens; dark mode via
// the orthogonal `.dark` root class. happy-dom asserts structure/values, never colors.
import { daysLeft } from "../../../core/coldStorage/daysLeft";
import { useArchivedDatasets } from "../../hooks/useDatasetQuery";
import { useRestoreDataset } from "../../hooks/useDatasetMutations";
import styles from "./ColdStorage.module.css";

export interface ColdStorageDrawerProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
}

// Deterministic "random-food" empty-state lines (no Math.random — picked by a stable index).
const EMPTY_FOODS: readonly string[] = [
  "🥦 The fridge is empty — not even leftovers.",
  "🍕 Nothing chilling here yet. Archive a source to fill the fridge.",
  "🧊 Cold storage is spotless. Nothing retired.",
  "🥕 No leftovers in cold storage.",
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function daysLeftLabel(retentionUntil: string | null | undefined, now: Date): string {
  const n = daysLeft(retentionUntil, now);
  if (n === null) return "no retention window";
  if (n <= 0) return "retention elapsed";
  return `${n} day${n === 1 ? "" : "s"} left`;
}

export function ColdStorageDrawer({
  open,
  projectId,
  onClose,
}: ColdStorageDrawerProps): JSX.Element | null {
  const archived = useArchivedDatasets(projectId);
  const restore = useRestoreDataset(projectId);

  if (!open) return null;

  const items = archived.data ?? [];
  const now = new Date();
  const emptyFood = EMPTY_FOODS[projectId.length % EMPTY_FOODS.length];

  return (
    <div className={styles.overlay}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Cold storage"
        data-testid="cold-storage-drawer"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Cold storage</h2>
          <button
            type="button"
            className={styles.closeButton}
            data-testid="cold-storage-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {items.length === 0 ? (
          <p className={styles.empty} data-testid="cold-storage-empty">
            {emptyFood}
          </p>
        ) : (
          <ul className={styles.list}>
            {items.map((ds) => (
              <li
                key={ds.id}
                className={styles.row}
                data-testid={`cold-storage-row-${ds.id}`}
              >
                <span className={styles.rowName}>{ds.display_name ?? ds.name}</span>
                <span
                  className={styles.rowMeta}
                  data-testid={`cold-storage-retired-at-${ds.id}`}
                >
                  Retired: {formatDate(ds.archived_at)}
                </span>
                <span
                  className={styles.rowMeta}
                  data-testid={`cold-storage-retention-end-${ds.id}`}
                >
                  Retention ends: {formatDate(ds.retention_until)}
                </span>
                <span
                  className={styles.daysLeft}
                  data-testid={`cold-storage-days-left-${ds.id}`}
                >
                  {daysLeftLabel(ds.retention_until, now)}
                </span>
                <button
                  type="button"
                  className={styles.restoreButton}
                  data-testid={`cold-storage-restore-${ds.id}`}
                  onClick={() => restore.mutate({ datasetId: ds.id })}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

export default ColdStorageDrawer;
