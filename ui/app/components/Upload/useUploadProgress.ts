/* The upload modal's saga state: the browse → uploading → schema view machine,
   the simulated three-leg "dial-up" progress animation (leg + pct), the Files
   list (seeded from the source's persisted upload history, grown by optimistic
   in-session uploads), and the schema bookkeeping a completed upload produces.
   Extracted from the modal so the component body stays presentational. */
import { useEffect, useRef, useState } from "react";

import type { FieldDef, LineageNode, SourceUpload } from "../../catalog";
import { type InferredSchema, inferSchema } from "./inferSchema";

export type UploadView = "browse" | "uploading" | "schema";
export type UploadFile = {
  name: string;
  /** Data-row count, or `null` when no count is known yet — a still-pending
   *  backend upload, or a fresh file whose body couldn't be parsed (empty /
   *  unreadable CSV). `null` means "unknown"; the presentation layer says so
   *  ("processing…") rather than showing a made-up or zero count. */
  rows: number | null;
  when: string;
  fresh?: boolean;
};

const uSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The three simulated connection legs, their labels, and per-tick delays. */
export const LEG_DEFS = [
  { key: "handshake", name: "Handshake", ms: 22 },
  { key: "transfer", name: "Transfer", ms: 34 },
  { key: "parse", name: "Parse", ms: 18 },
];

/** Infer a schema from a file's CSV text, tolerating a missing/unreadable body
 *  by returning `null` (the caller then falls back to a placeholder schema). */
async function parseUploadedCsv(file: File): Promise<InferredSchema | null> {
  try {
    if (file && file.text) return inferSchema(await file.text());
  } catch {
    /* malformed or unreadable — fall back to the placeholder schema */
  }
  return null;
}

/** Pick the columns to display after an upload: an existing source's schema
 *  wins, else the freshly inferred columns, else a single placeholder column. */
function resolveColumns(
  existingSchema: FieldDef[] | null,
  parsed: InferredSchema | null,
): FieldDef[] {
  if (existingSchema && existingSchema.length) return existingSchema;
  if (parsed) return parsed.cols;
  return [{ name: "column_1", type: "text" }];
}

/**
 * Summarize the total rows across `files` for the Files-section header. Sums the
 * known counts and stays honest about unknowns: a partial total (some file's
 * count is `null`) gets a `+` suffix, and when nothing is known it reports the
 * count as unavailable rather than claiming `0`.
 */
export function summarizeRowCount(files: UploadFile[]): string {
  const known = files.filter((f) => f.rows != null);
  const total = known.reduce((sum, f) => sum + (f.rows ?? 0), 0);
  if (files.length > 0 && known.length === 0) return "row count unavailable";
  const partial = known.length < files.length ? "+" : "";
  return `${total.toLocaleString()}${partial} rows`;
}

/** Derive a human display name from a file name: drop the extension and turn
 *  `_`/`-` separators into spaces. */
function displayNameFromFile(fname: string): string {
  return fname
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

/**
 * Drives the upload modal's view/leg/pct state machine and the file+schema
 * bookkeeping a completed upload produces.
 *
 * The returned {@link UploadProgress.runUpload} plays the three-leg progress
 * animation, then infers the schema from the file's CSV text (falling back to
 * the source's existing schema, or a single placeholder column), appends a
 * fresh {@link UploadFile}, and — for a brand-new source with no name yet —
 * seeds `name` from the file name via `setName`. `name` and `setName` are owned
 * by the component (the display-name input binds to them) and threaded in so the
 * saga can read the current name and seed it.
 */
export function useUploadProgress({
  source,
  existing,
  name,
  setName,
  seededFiles,
}: {
  source: LineageNode | null;
  existing: boolean;
  name: string;
  setName: (name: string) => void;
  /** The source's persisted upload history (source-uploads loader, oldest-first),
   *  arriving asynchronously after the modal opens. Seeded once; fresh in-session
   *  uploads append after it. */
  seededFiles?: SourceUpload[];
}) {
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
  const runningRef = useRef(false);

  /** Play the simulated three-leg dial-up animation, ticking each leg from 0 to
   *  100% at its own pace. The nested loop is intentional pacing, not a hot path
   *  — both bounds are fixed (three legs × ~14 ticks) and the wall-clock is all
   *  in the deliberate {@link uSleep} delays. Leaves `leg` at 3 (all done). */
  async function playDialUpProgress() {
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
  }

  async function runUpload(file: File) {
    if (runningRef.current) return;
    runningRef.current = true;

    setPendingFile(file);
    setView("uploading");
    setLeg(0);
    setPct(0);
    setFreshFile(null);

    await playDialUpProgress();

    const parsed = await parseUploadedCsv(file);
    const cols = resolveColumns(schema, parsed);
    // Row count is the client-side parse count, or null when the file can't be
    // parsed — the Files list then says "unknown" rather than inventing a
    // number. The authoritative count arrives from the backend upload-process
    // response in the catalog layer, not this simulated saga.
    const rows = parsed ? parsed.rows : null;
    const fname = file ? file.name : `upload_${files.length + 1}.csv`;

    setSchema(cols);
    setFreshFile(fname);
    setFiles((prev) => [
      ...prev,
      { name: fname, rows, when: "just now", fresh: true },
    ]);
    if (!existing && !name) setName(displayNameFromFile(fname));
    setView("schema");

    runningRef.current = false;
  }

  const overallPct = Math.round((leg * 100 + (leg < 3 ? pct : 0)) / 3);

  return {
    view,
    setView,
    leg,
    pct,
    schema,
    files,
    freshFile,
    pendingFile,
    runUpload,
    overallPct,
  };
}

export type UploadProgress = ReturnType<typeof useUploadProgress>;
