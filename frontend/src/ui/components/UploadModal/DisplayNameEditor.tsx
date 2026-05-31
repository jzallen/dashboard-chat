// DisplayNameEditor — reusable editor for a source's display name (MR-6).
//
// Persists ONLY the display name via the useUpdateDatasetDisplayName optimistic
// mutation; the underlying filename/`name` is never sent. The input defaults to
// `display_name ?? name` so the UI falls back to the raw name when unset. Mounted
// both inside the upload modal and on the MR-5 dataset-detail surface (DWD-M6-7).
import { useEffect, useState } from "react";

import { useUpdateDatasetDisplayName } from "../../hooks/useDatasetMutations";
import styles from "./UploadModal.module.css";

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

export function DisplayNameEditor({
  datasetId,
  projectId,
  name,
  displayName,
  onSaved,
}: DisplayNameEditorProps): JSX.Element {
  const [value, setValue] = useState(displayName ?? name);
  const mutation = useUpdateDatasetDisplayName(projectId);

  // Re-seed when the editor is pointed at a different source (e.g. modal reopen).
  useEffect(() => {
    setValue(displayName ?? name);
  }, [datasetId, displayName, name]);

  const handleSave = (): void => {
    mutation.mutate(
      { datasetId, displayName: value },
      { onSuccess: () => onSaved?.(value) },
    );
  };

  return (
    <div className={styles.displayNameEditor} data-testid="display-name-editor">
      <input
        className={styles.input}
        data-testid="display-name-input"
        aria-label="Source display name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        className={styles.primaryButton}
        data-testid="display-name-save"
        onClick={handleSave}
        disabled={mutation.isPending}
      >
        Save name
      </button>
    </div>
  );
}
