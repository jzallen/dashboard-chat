/* Upload flow: browse → 3-leg dial-up progress → schema + name + upload-another,
   plus the archive-confirm dialog its "move to cold storage" action opens. */
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import type { FieldDef, LineageNode, SourceUpload } from "../../catalog";
import { ConfirmDialog, Icon } from "../primitives";
import styles from "./Upload.module.css";

type UploadView = "browse" | "uploading" | "schema";
/** A Files-list row. `rows` is `null` for a still-pending upload (no count yet);
 *  `fresh` marks an optimistic row added in the current session. */
type UploadFile = {
  name: string;
  rows: number | null;
  when: string;
  fresh?: boolean;
};
type CreateSourcePayload = {
  file: File | null;
  name: string;
};

const uSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function inferSchema(text: string): { cols: FieldDef[]; rows: number } | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return null;
  const strip = (s: string) => (s || "").trim().replace(/^"|"$/g, "");
  const headers = lines[0].split(",").map(strip);
  const sample = lines.slice(1, 8).map((l) => l.split(","));
  const cols = headers.map((h, i) => {
    const vals = sample
      .map((r) => (r[i] !== undefined ? r[i].trim() : ""))
      .filter((v) => v !== "");
    const numeric = vals.length > 0 && vals.every((v) => !isNaN(Number(v)));
    return { name: h || `column_${i + 1}`, type: numeric ? "number" : "text" };
  });
  return { cols, rows: lines.length - 1 };
}

const LEG_DEFS = [
  { key: "handshake", name: "Handshake", ms: 22 },
  { key: "transfer", name: "Transfer", ms: 34 },
  { key: "parse", name: "Parse", ms: 18 },
];

/** Schema-mismatch detail surfaced for the recovery UX (slice 5). */
type MismatchDetail = {
  missing: string[];
  extra: string[];
  type_mismatch: { column: string; expected: string; actual: string }[];
};

export function UploadModal({
  source,
  files: seededFiles,
  onClose,
  onCreateSource,
  onRename,
  onArchive,
  mismatch = null,
  onRetry,
}: {
  source: LineageNode | null;
  /** The source's persisted upload history, seeded from the source-uploads
   *  loader (oldest-first). Fresh in-session uploads append after these. */
  files?: SourceUpload[];
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
  const [view, setView] = useState<UploadView>(existing ? "schema" : "browse");
  const [leg, setLeg] = useState(0);
  const [pct, setPct] = useState(0);
  const [schema, setSchema] = useState<FieldDef[] | null>(
    source ? source.schema || [] : null,
  );
  // The Files list. Seeded from the source's persisted upload history (the
  // source-uploads loader, oldest-first) and grown by fresh optimistic uploads,
  // which append after the seeded rows (persisted-first ordering).
  const [files, setFiles] = useState<UploadFile[]>([]);
  // The history arrives ASYNCHRONOUSLY (the loader runs after the modal opens), so
  // seed once it resolves — a single one-shot seed that runs before the user adds
  // any fresh row, leaving later optimistic appends untouched.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || seededFiles === undefined) return;
    seededRef.current = true;
    setFiles(
      seededFiles.map((f) => ({ name: f.name, rows: f.rows, when: f.when })),
    );
  }, [seededFiles]);
  const [freshFile, setFreshFile] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [name, setName] = useState(source ? source.label : "");
  const [drag, setDrag] = useState(false);
  const [committed] = useState(existing);
  const inputRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);

  async function runUpload(file: File) {
    if (runningRef.current) return;
    runningRef.current = true;
    setPendingFile(file);
    setView("uploading");
    setLeg(0);
    setPct(0);
    setFreshFile(null);
    for (let L = 0; L < LEG_DEFS.length; L++) {
      setLeg(L);
      for (let p = 0; p <= 100; p += 8) {
        setPct(p);
        await uSleep(LEG_DEFS[L].ms);
      }
      setPct(100);
      await uSleep(170);
    }
    setLeg(3);
    let parsed: { cols: FieldDef[]; rows: number } | null = null;
    try {
      if (file && file.text) parsed = inferSchema(await file.text());
    } catch {
      /* ignore */
    }
    const cols =
      schema && schema.length
        ? schema
        : parsed
          ? parsed.cols
          : [{ name: "column_1", type: "text" }];
    const rows = parsed ? parsed.rows : Math.floor(180 + Math.random() * 1600);
    const fname = file ? file.name : `upload_${files.length + 1}.csv`;
    setSchema(cols);
    setFreshFile(fname);
    setFiles((prev) => [
      ...prev,
      { name: fname, rows, when: "just now", fresh: true },
    ]);
    if (!existing && !name)
      setName(
        fname
          .replace(/\.[^.]+$/, "")
          .replace(/[_-]+/g, " ")
          .trim(),
      );
    setView("schema");
    runningRef.current = false;
  }

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

  const totalRows = files.reduce((s, f) => s + (f.rows || 0), 0);
  const overallPct = Math.round((leg * 100 + (leg < 3 ? pct : 0)) / 3);

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
            <div className={styles.legs}>
              <div className={styles.legStatus}>
                Connecting to query engine — <b>{overallPct}%</b>
              </div>
              {LEG_DEFS.map((L, i) => {
                const state = leg > i ? "done" : leg === i ? "active" : "";
                const w = leg > i ? 100 : leg === i ? pct : 0;
                return (
                  <div
                    className={`${styles.leg} ${styles[state] ?? ""}`}
                    key={L.key}
                  >
                    <span className={styles.legName}>
                      <span className={styles.legDot} />
                      {L.name}
                    </span>
                    <span className={styles.legTrack}>
                      <span
                        className={styles.legFill}
                        style={{ width: w + "%" }}
                      />
                    </span>
                    <span className={styles.legPercent}>{w}%</span>
                  </div>
                );
              })}
              <div className={styles.legsFooter}>
                <Icon name="database" size={12} />
                duckdb · local engine
              </div>
            </div>
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
                    {f.rows === null
                      ? "processing…"
                      : `${f.rows.toLocaleString()} rows`}
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
