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
import { useEffect, useRef, useState } from "react";

import { withAuth } from "@/auth";
import { createDataCatalog, type Dataset, type DatasetSparse } from "@/dataCatalog";

import { useArchiveDataset } from "../../hooks/useDatasetMutations";
import { ConfirmDialog } from "../ConfirmDialog";
import { DisplayNameEditor } from "./DisplayNameEditor";
import styles from "./UploadModal.module.css";

const catalog = createDataCatalog(withAuth(fetch));

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

type Step = "browse" | "uploading" | "source" | "error";

export function UploadModal({
  open,
  projectId,
  onClose,
  onSourceCreated,
  existingSource,
}: UploadModalProps): JSX.Element | null {
  const [step, setStep] = useState<Step>(existingSource ? "source" : "browse");
  const [source, setSource] = useState<UploadSource | null>(existingSource ?? null);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // MR-7: archive (move to cold storage) the source being managed in this modal.
  const archiveDataset = useArchiveDataset(projectId);

  // Reset to the correct entry step whenever the modal (re)opens or its source changes.
  useEffect(() => {
    if (!open) return;
    if (existingSource) {
      setSource(existingSource);
      setStep("source");
    } else {
      setSource(null);
      setStep("browse");
    }
    setErrorMsg("");
  }, [open, existingSource]);

  if (!open) return null;

  const uploadSelected = async (file: File): Promise<void> => {
    setStep("uploading");
    setErrorMsg("");
    // "Upload another to same schema" reuses the existing dataset via dataset_id.
    const fields = source
      ? { project_id: projectId, dataset_id: source.id }
      : { project_id: projectId };
    try {
      const result = await catalog.uploadFile<Dataset>("/api/uploads", file, fields);
      setSource(result);
      setStep("source");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
      setStep("error");
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) void uploadSelected(file);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") onClose();
  };

  const fields = source?.schema_config?.fields ?? {};

  return (
    <div className={styles.overlay} data-testid="upload-modal-overlay">
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-modal-title"
        data-testid="upload-modal"
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <h2 id="upload-modal-title" className={styles.title}>
            Upload a source
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            data-testid="upload-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {step === "browse" && (
          <div className={styles.dropzone} data-testid="upload-dropzone">
            <input
              ref={inputRef}
              type="file"
              className={styles.hiddenInput}
              data-testid="upload-file-input"
              accept=".csv,.tsv,.xlsx,.xls,.parquet"
              onChange={onInputChange}
            />
            <p>Drop a file here, or</p>
            <button
              type="button"
              className={styles.browseButton}
              data-testid="upload-browse-button"
              onClick={() => inputRef.current?.click()}
            >
              Choose a file to upload
            </button>
          </div>
        )}

        {step === "uploading" && (
          <div className={styles.progress} data-testid="upload-progress" aria-label="Uploading">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                data-testid={`upload-leg-${i}`}
                className={styles.leg}
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </div>
        )}

        {step === "error" && (
          <div>
            <p className={styles.error} data-testid="upload-error">
              {errorMsg}
            </p>
            <button
              type="button"
              className={styles.retryButton}
              data-testid="upload-retry"
              onClick={() => setStep("browse")}
            >
              Retry
            </button>
          </div>
        )}

        {step === "source" && source && (
          <>
            <section className={styles.schema} data-testid="upload-schema">
              <h3>Parsed schema</h3>
              {Object.entries(fields).map(([name, field]) => (
                <div
                  key={name}
                  className={styles.schemaField}
                  data-testid={`upload-schema-field-${name}`}
                >
                  <span>{name}</span>
                  <span className={styles.schemaFieldType}>{field.type}</span>
                </div>
              ))}
            </section>

            <DisplayNameEditor
              datasetId={source.id}
              projectId={projectId}
              name={source.name}
              displayName={source.display_name ?? null}
            />

            {/* Per-source upload history is not served by the API today (deferred c, UI-7). */}
            <p className={styles.historyEmpty} data-testid="upload-history-empty">
              No upload history available yet for this source.
            </p>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                data-testid="archive-source-button"
                onClick={() => setConfirmArchiveOpen(true)}
              >
                ❄ Move to cold storage
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                data-testid="upload-another"
                onClick={() => setStep("browse")}
              >
                Upload another to same schema
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                data-testid="upload-create-source"
                onClick={() => {
                  onSourceCreated?.(source as Dataset);
                  onClose();
                }}
              >
                Create source
              </button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmArchiveOpen}
        testIdBase="archive"
        title="Move to cold storage?"
        message="This source leaves the live pipeline and any downstream models become orphaned. You can restore it from cold storage within the retention window."
        confirmLabel="Move to cold storage"
        cancelLabel="Cancel"
        onCancel={() => setConfirmArchiveOpen(false)}
        onConfirm={() => {
          if (source) archiveDataset.mutate({ datasetId: source.id });
          setConfirmArchiveOpen(false);
          onClose();
        }}
      />
    </div>
  );
}
