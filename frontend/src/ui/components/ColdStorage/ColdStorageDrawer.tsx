// ColdStorageDrawer — the "fridge" (MR-7). RED scaffold (created by DISTILL).
//
// Lists archived sources (from useArchivedDatasets / listDatasetsForProject(..,{archived:true}))
// with retired-at (archived_at), retention-end (retention_until), a days-left badge (the pure
// daysLeft helper, clock injected at render), and a Restore button (useRestoreDataset). When
// the archived list is empty it renders a playful random-food empty state. Returns null while
// closed so the Pipeline landing stays green until the drawer is opened. DELIVER 07-03 replaces
// the open body. Detached from the assistant; consumes MR-1 tokens; dark mode via `.dark`.
export const __SCAFFOLD__ = true;

export interface ColdStorageDrawerProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
}

export function ColdStorageDrawer(props: ColdStorageDrawerProps): JSX.Element | null {
  if (!props.open) return null;
  throw new Error("Not yet implemented — RED scaffold (ColdStorageDrawer, MR-7)");
}

export default ColdStorageDrawer;
