// DisplayNameEditor — reusable editor for a source's display name (MR-6).
//
// Persists ONLY the display name via the useUpdateDatasetDisplayName optimistic
// mutation; the underlying filename/`name` is never sent. The input defaults to
// `display_name ?? name` so the UI falls back to the raw name when unset. Mounted
// both inside the upload modal and on the MR-5 dataset-detail surface (DWD-M6-7).
//
// RED scaffold (DISTILL) — body throws until DELIVER step 06-03 implements it.
export const __SCAFFOLD__ = true;

export interface DisplayNameEditorProps {
  datasetId: string;
  projectId: string;
  /** The underlying dataset name/filename (never mutated by this editor). */
  name: string;
  /** The current display name; null/undefined → the input falls back to `name`. */
  displayName?: string | null;
  /** Optional callback after a successful save. */
  onSaved?: (displayName: string) => void;
}

export function DisplayNameEditor(_props: DisplayNameEditorProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold DisplayNameEditor");
}
