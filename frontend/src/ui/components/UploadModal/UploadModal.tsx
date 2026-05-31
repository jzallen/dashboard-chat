// UploadModal — standalone upload surface, detached from the assistant (MR-6).
//
// Toolbar-triggered (Pipeline landing). Flow: browse/drop → a COSMETIC 3-leg
// "dial-up" progress wrapped around the in-flight EXISTING uploadFile('/api/uploads')
// promise (no streaming-upload backend; DWD-M6-5) → a parsed schema view from the
// returned dataset's existing schema_config → an editable display name (DisplayNameEditor,
// persisted via updateDataset; the filename/`name` is untouched) → "upload another to
// same schema" (re-uploads with { project_id, dataset_id }) / "create source" (the created
// dataset already appears as a staging node in the MR-2 lineage). `existingSource` opens the
// modal directly at the schema/display-name step (source-node reopen; DWD-M6-9). The
// per-source file history is NOT served today → documented empty-state (deferred c, UI-7).
// The ui-state wire / chat transport / agent contract are NOT touched (DWD-M6-3).
//
// RED scaffold (DISTILL) — a closed modal renders nothing (so hosts that mount it stay
// green); opening it throws until DELIVER step 06-03 implements the flow.
import type { Dataset, DatasetSparse } from "@/dataCatalog";

export const __SCAFFOLD__ = true;

/** Minimal shape needed to reopen the modal into an existing source. */
export type UploadSource = Dataset | DatasetSparse;

export interface UploadModalProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  /** Handed the created/updated dataset when the user creates a source. */
  onSourceCreated?: (dataset: Dataset) => void;
  /** When set, the modal opens at the schema/display-name step for this source
   *  (browse skipped) — used by source-node reopen. */
  existingSource?: UploadSource | null;
}

export function UploadModal({ open }: UploadModalProps): JSX.Element | null {
  if (!open) return null;
  throw new Error("Not yet implemented — RED scaffold UploadModal");
}
