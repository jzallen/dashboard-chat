/* Upload flow: browse → 3-leg dial-up progress → schema + name + upload-another,
   plus the archive-confirm dialog its "move to cold storage" action opens. The
   view/leg/pct saga and CSV schema inference live in sibling units
   (useUploadProgress, inferSchema); this component stays presentational. */
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";

import type { LineageNode } from "../../catalog";
import { ConfirmDialog, Icon } from "../primitives";
import styles from "./Upload.module.css";
import { UploadingView } from "./UploadingView";
import { useUploadProgress } from "./useUploadProgress";

type CreateSourcePayload = {
  file: File | null;
  name: string;
};

/** Schema-mismatch detail surfaced for the recovery UX (slice 5). */
type MismatchDetail = {
  missing: string[];
  extra: string[];
  type_mismatch: { column: string; expected: string; actual: string }[];
};

export function UploadModal({
  source,
  onClose,
  onCreateSource,
  onRename,
  onArchive,
  mismatch = null,
  onRetry,
}: {
  source: LineageNode | null;
  onClose: () => void;
  onCreateSource: (src: CreateSourcePayload) => void | Promise<void>;
  onRename: (id: string, name: string) => void;
  onArchive: (src: LineageNode) => void;
  /** When present, the last add-to-this-source upload was rejected for a schema
   *  mismatch; the offending columns are shown with a recovery affordance. */
  mismatch?: MismatchDetail | null;
  /** Clear the mismatch and let the user pick a different file. */
  onRetry?: () => void;
}) {
  const existing = !!source;
  const [name, setName] = useState(source ? source.label : "");
  const [drag, setDrag] = useState(false);
  const [committed] = useState(existing);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    view,
    setView,
    leg,
    pct,
    schema,
    files,
    freshFile,
    pendingFile,
    runUpload,
    totalRows,
    overallPct,
  } = useUploadProgress({ source, existing, name, setName });

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0];
    if (f) runUpload(f);
    e.target.value = "";
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) runUpload(f);
  }

  function commit() {
    if (!existing && !committed) {
      const finalName =
        name.trim() || (freshFile || "new_source").replace(/\.[^.]+$/, "");
      onCreateSource({ file: pendingFile, name: finalName });
    }
    onClose();
  }

  return (
    <>
      <div className="up-scrim" onClick={onClose} />
      <div className="up-modal" role="dialog" aria-label="Upload source">
        <div className="up-head">
          <span className="up-mark">
            <Icon name={existing ? "database" : "upload"} size={16} />
          </span>
          <div className="up-htext">
            <div className="up-title">
              {source
                ? name || source.label
                : view === "schema"
                  ? name || "New source"
                  : "Upload a file"}
            </div>
            <div className="up-sub">
              {existing
                ? "Source · add files to the same schema"
                : view === "uploading"
                  ? "Reading your file…"
                  : view === "schema"
                    ? "Name it and add more files"
                    : "CSV up to 50MB"}
            </div>
          </div>
          <button className="up-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="up-body">
          {mismatch && (
            <div className={styles.mismatch} role="alert">
              <div className={styles.mismatchHeader}>
                <Icon name="x" size={14} />
                <span>This file doesn&apos;t match the source schema</span>
              </div>
              <ul className={styles.mismatchList}>
                {mismatch.missing.length > 0 && (
                  <li>
                    Missing columns: <b>{mismatch.missing.join(", ")}</b>
                  </li>
                )}
                {mismatch.extra.length > 0 && (
                  <li>
                    Unexpected columns: <b>{mismatch.extra.join(", ")}</b>
                  </li>
                )}
                {mismatch.type_mismatch.length > 0 && (
                  <li>
                    Wrong types:{" "}
                    <b>
                      {mismatch.type_mismatch
                        .map(
                          (m) =>
                            `${m.column} (expected ${m.expected}, got ${m.actual})`,
                        )
                        .join(", ")}
                    </b>
                  </li>
                )}
              </ul>
              <button
                className="btn sq"
                onClick={() => {
                  onRetry?.();
                  setView("browse");
                }}
              >
                <Icon name="upload" size={14} />
                Pick a different file
              </button>
            </div>
          )}
          {view === "browse" && (
            <div
              className={`${styles.dropzone}${drag ? " " + styles.drag : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              <div className="dz-ic">
                <Icon name="upload" size={26} />
              </div>
              <div className="dz-title">
                {existing ? "Add another file" : "Drop a CSV here"}
              </div>
              <div className="dz-sub">
                {existing
                  ? "It must match this source's schema."
                  : "or browse to choose a file from your computer."}
              </div>
              <button
                className="btn primary sq"
                onClick={() => inputRef.current && inputRef.current.click()}
              >
                <Icon name="file" size={15} />
                Browse files
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={pick}
                style={{ display: "none" }}
              />
              <div className="dz-hint">.csv · comma-separated · header row</div>
            </div>
          )}

          {view === "uploading" && (
            <UploadingView leg={leg} pct={pct} overallPct={overallPct} />
          )}

          {view === "schema" && (
            <>
              <div className={styles.nameRow}>
                <div className={styles.nameLabel}>Display name</div>
                <input
                  className={styles.nameInput}
                  value={name}
                  placeholder="Name this source…"
                  onChange={(e) => {
                    setName(e.target.value);
                    if (source && onRename) onRename(source.id, e.target.value);
                  }}
                  autoFocus={!existing}
                />
              </div>
              {/* Schema sits ABOVE Files so adding a file grows the list at the
                  bottom and never pushes the schema down. */}
              <div className={styles.sectionHeader}>
                <Icon
                  name="table"
                  size={14}
                  style={{ color: "var(--text-500)" }}
                />
                <span className={styles.sectionTitle}>Schema</span>
                <span className={styles.sectionCount}>
                  {(schema || []).length} columns
                </span>
              </div>
              <div className={styles.schemaGrid}>
                {(schema || []).map((c, i) => (
                  <div className={styles.schemaCol} key={i}>
                    <span className={styles.columnIndex}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.columnName}>{c.name}</span>
                    <span
                      className={
                        "badge " + (c.type === "number" ? "number" : "text")
                      }
                    >
                      {c.type}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.sectionHeader}>
                <Icon
                  name="file"
                  size={14}
                  style={{ color: "var(--text-500)" }}
                />
                <span className={styles.sectionTitle}>Files</span>
                <span className={styles.sectionCount}>
                  {files.length} · {totalRows.toLocaleString()} rows
                </span>
              </div>
              {files.length === 0 && (
                <div className={styles.fileRow}>
                  <span className={styles.fileName}>No files yet</span>
                </div>
              )}
              {files.map((f, i) => (
                <div
                  className={`${styles.fileRow}${f.fresh ? " " + styles.fresh : ""}`}
                  key={i}
                >
                  <span className={styles.fileIcon}>
                    <Icon name="file" size={14} />
                  </span>
                  <span className={styles.fileName}>{f.name}</span>
                  <span className={styles.fileRows}>
                    {(f.rows || 0).toLocaleString()} rows
                  </span>
                  <span className={styles.fileWhen}>{f.when}</span>
                </div>
              ))}
            </>
          )}
        </div>

        {view === "schema" && (
          <div className={styles.footer}>
            {source && (
              <button
                className="btn sq cold-ghost"
                onClick={() =>
                  onArchive &&
                  onArchive({ ...source, label: name || source.label })
                }
              >
                <Icon name="snow" size={15} />
                Move to cold storage
              </button>
            )}
            <button className="btn sq" onClick={() => setView("browse")}>
              <Icon name="upload" size={15} />
              Upload another file
            </button>
            <span className={styles.spacer} />
            <button className="btn ok sq" onClick={commit}>
              <Icon name="check" size={15} />
              {existing ? "Done" : "Create source"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function ConfirmArchive({
  source,
  onCancel,
  onConfirm,
}: {
  source: LineageNode;
  onCancel: () => void;
  onConfirm: (source: LineageNode) => void;
}) {
  const n = (source.files || []).length;
  return (
    <ConfirmDialog
      icon="snow"
      title="Move to cold storage?"
      tone="cold"
      confirmIcon="snow"
      confirmLabel="Move to cold storage"
      onCancel={onCancel}
      onConfirm={() => onConfirm(source)}
      body={
        <>
          <b>{source.label}</b>
          {n ? ` and its ${n} file${n > 1 ? "s" : ""}` : ""} will be moved to
          cold storage and kept for <b>90 days</b> before permanent deletion.
          You can restore it any time before then.
        </>
      }
    />
  );
}
