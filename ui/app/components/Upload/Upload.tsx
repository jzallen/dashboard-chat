/* Upload flow: browse → 3-leg dial-up progress → schema + name + upload-another,
   plus the archive-confirm dialog its "move to cold storage" action opens. */
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import type { FieldDef, LineageNode } from "../../catalog";
import type { SourceUpload } from "../../catalog/dataSources/source";
import { ConfirmDialog, Icon } from "../primitives";
import styles from "./Upload.module.css";

type UploadView = "browse" | "uploading" | "schema";
type UploadFile = { name: string; rows: number; when: string; fresh?: boolean };
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
  onClose,
  onCreateSource,
  onRename,
  onArchive,
  mismatch = null,
  onRetry,
  onLoadUploads,
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
  /** Load the existing source's uploaded files from the backend (the initial
   *  Files list). Optional — when absent (a brand-new source) the list starts
   *  empty and grows from fresh uploads only. */
  onLoadUploads?: (sourceId: string) => Promise<SourceUpload[]>;
}) {
  const existing = !!source;
  const [view, setView] = useState<UploadView>(existing ? "schema" : "browse");
  const [leg, setLeg] = useState(0);
  const [pct, setPct] = useState(0);
  const [schema, setSchema] = useState<FieldDef[] | null>(
    source ? source.schema || [] : null,
  );
  // The Files list. For an existing source it is loaded from the backend (the
  // UploadRecorded history) via onLoadUploads on open; fresh uploads append
  // optimistically on top of it. A brand-new source starts empty.
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [filesLoading, setFilesLoading] = useState<boolean>(!!source);
  const [freshFile, setFreshFile] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [name, setName] = useState(source ? source.label : "");
  const [drag, setDrag] = useState(false);
  const [committed] = useState(existing);
  const inputRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);

  // Load the existing source's uploaded files from the backend once on open.
  // Fresh uploads (runUpload) append on top, so we prepend the loaded history
  // before any optimistic rows rather than clobbering them.
  useEffect(() => {
    if (!source || !onLoadUploads) {
      setFilesLoading(false);
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    onLoadUploads(source.id)
      .then((loaded) => {
        if (cancelled) return;
        const initial: UploadFile[] = loaded.map((u) => ({
          name: u.name,
          rows: u.rows ?? 0,
          when: u.when,
        }));
        setFiles((fresh) => [...initial, ...fresh]);
      })
      .catch(() => {
        /* leave the list empty on a load error — the canvas surfaces failures */
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source?.id, onLoadUploads]);

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
              <div className={styles.mismatchHead}>
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
                    <span className={styles.legPct}>{w}%</span>
                  </div>
                );
              })}
              <div className={styles.legsFoot}>
                <Icon name="database" size={12} />
                duckdb · local engine
              </div>
            </div>
          )}

          {view === "schema" && (
            <>
              <div className={styles.upNameRow}>
                <div className={styles.upNameLabel}>Display name</div>
                <input
                  className={styles.upNameInput}
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
              <div className={styles.upSectionH}>
                <Icon
                  name="table"
                  size={14}
                  style={{ color: "var(--text-500)" }}
                />
                <span className={styles.shT}>Schema</span>
                <span className={styles.shC}>
                  {(schema || []).length} columns
                </span>
              </div>
              <div className={styles.schemaGrid}>
                {(schema || []).map((c, i) => (
                  <div className={styles.schemaCol} key={i}>
                    <span className={styles.scIdx}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.scName}>{c.name}</span>
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
              <div className={styles.upSectionH}>
                <Icon
                  name="file"
                  size={14}
                  style={{ color: "var(--text-500)" }}
                />
                <span className={styles.shT}>Files</span>
                <span className={styles.shC}>
                  {files.length} · {totalRows.toLocaleString()} rows
                </span>
              </div>
              {filesLoading && files.length === 0 && (
                <div className={styles.fileRow}>
                  <span className={styles.frName}>Loading files…</span>
                </div>
              )}
              {!filesLoading && files.length === 0 && (
                <div className={styles.fileRow}>
                  <span className={styles.frName}>No files yet</span>
                </div>
              )}
              {files.map((f, i) => (
                <div
                  className={`${styles.fileRow}${f.fresh ? " " + styles.fresh : ""}`}
                  key={i}
                >
                  <span className={styles.frIc}>
                    <Icon name="file" size={14} />
                  </span>
                  <span className={styles.frName}>{f.name}</span>
                  <span className={styles.frRows}>
                    {(f.rows || 0).toLocaleString()} rows
                  </span>
                  <span className={styles.frWhen}>{f.when}</span>
                </div>
              ))}
            </>
          )}
        </div>

        {view === "schema" && (
          <div className={styles.upFoot}>
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
