/* The upload modal's saga state: the browse → uploading → schema view machine,
   the simulated three-leg "dial-up" progress animation (leg + pct), and the
   file/schema bookkeeping that a completed upload produces. Extracted from the
   modal so the component body stays presentational. */
import { useRef, useState } from "react";

import type { FieldDef, LineageNode } from "../../catalog";
import { type InferredSchema, inferSchema } from "./inferSchema";

export type UploadView = "browse" | "uploading" | "schema";
export type UploadFile = {
  name: string;
  rows: number;
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
}: {
  source: LineageNode | null;
  existing: boolean;
  name: string;
  setName: (name: string) => void;
}) {
  const [view, setView] = useState<UploadView>(existing ? "schema" : "browse");
  const [leg, setLeg] = useState(0);
  const [pct, setPct] = useState(0);
  const [schema, setSchema] = useState<FieldDef[] | null>(
    source ? source.schema || [] : null,
  );
  // The Files list. Starts empty and grows only from fresh optimistic uploads in
  // the current session. The persisted Files history for an existing source will
  // be seeded by a future source-detail loader.
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [freshFile, setFreshFile] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
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
    let parsed: InferredSchema | null = null;
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

  const totalRows = files.reduce((s, f) => s + (f.rows || 0), 0);
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
    totalRows,
    overallPct,
  };
}

export type UploadProgress = ReturnType<typeof useUploadProgress>;
