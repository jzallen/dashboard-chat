/* Upload flow: browse → 3-leg dial-up progress → schema + name + upload-another */
const uSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function inferSchema(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return null;
  const strip = (s) => (s || "").trim().replace(/^"|"$/g, "");
  const headers = lines[0].split(",").map(strip);
  const sample = lines.slice(1, 8).map((l) => l.split(","));
  const cols = headers.map((h, i) => {
    const vals = sample.map((r) => (r[i] !== undefined ? r[i].trim() : "")).filter((v) => v !== "");
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

function UploadModal({ source, onClose, onCreateSource, onRename, onArchive }) {
  const existing = !!source;
  const [view, setView] = useState(existing ? "schema" : "browse"); // browse | uploading | schema
  const [leg, setLeg] = useState(0);
  const [pct, setPct] = useState(0);
  const [schema, setSchema] = useState(existing ? (source.schema || []) : null);
  const [files, setFiles] = useState(existing ? (source.files ? source.files.map((f) => ({ ...f })) : []) : []);
  const [freshFile, setFreshFile] = useState(null);
  const [name, setName] = useState(existing ? source.label : "");
  const [drag, setDrag] = useState(false);
  const [committed, setCommitted] = useState(existing);
  const inputRef = useRef(null);
  const runningRef = useRef(false);

  async function runUpload(file) {
    if (runningRef.current) return;
    runningRef.current = true;
    setView("uploading"); setLeg(0); setPct(0); setFreshFile(null);
    for (let L = 0; L < LEG_DEFS.length; L++) {
      setLeg(L);
      for (let p = 0; p <= 100; p += 8) { setPct(p); await uSleep(LEG_DEFS[L].ms); }
      setPct(100); await uSleep(170);
    }
    setLeg(3);
    let parsed = null;
    try { if (file && file.text) parsed = inferSchema(await file.text()); } catch (e) { /* ignore */ }
    const cols = (schema && schema.length) ? schema : (parsed ? parsed.cols : [{ name: "column_1", type: "text" }]);
    const rows = parsed ? parsed.rows : Math.floor(180 + Math.random() * 1600);
    const fname = file ? file.name : `upload_${files.length + 1}.csv`;
    setSchema(cols);
    setFreshFile(fname);
    setFiles((prev) => [...prev, { name: fname, rows, when: "just now", fresh: true }]);
    if (!existing && !name) setName(fname.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim());
    setView("schema");
    runningRef.current = false;
  }

  function pick(e) {
    const f = e.target.files && e.target.files[0];
    if (f) runUpload(f);
    e.target.value = "";
  }
  function onDrop(e) {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) runUpload(f);
  }

  function commit() {
    if (!existing && !committed) {
      const finalName = name.trim() || (freshFile || "new_source").replace(/\.[^.]+$/, "");
      onCreateSource({ name: finalName, schema, files: files.map((f) => ({ name: f.name, rows: f.rows, when: f.when })) });
    }
    onClose();
  }

  const totalRows = files.reduce((s, f) => s + (f.rows || 0), 0);
  const overallPct = Math.round(((leg * 100) + (leg < 3 ? pct : 0)) / 3);

  return (
    <React.Fragment>
      <div className="up-scrim" onClick={onClose} />
      <div className="up-modal" role="dialog" aria-label="Upload source">
        <div className="up-head">
          <span className="up-mark"><Icon name={existing ? "database" : "upload"} size={16} /></span>
          <div className="up-htext">
            <div className="up-title">{existing ? (name || source.label) : view === "schema" ? (name || "New source") : "Upload a file"}</div>
            <div className="up-sub">{existing ? "Source · add files to the same schema" : view === "uploading" ? "Reading your file…" : view === "schema" ? "Name it and add more files" : "CSV up to 50MB"}</div>
          </div>
          <button className="up-x" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        <div className="up-body">
          {view === "browse" && (
            <div className={"dropzone" + (drag ? " drag" : "")}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)} onDrop={onDrop}>
              <div className="dz-ic"><Icon name="upload" size={26} /></div>
              <div className="dz-title">{existing ? "Add another file" : "Drop a CSV here"}</div>
              <div className="dz-sub">{existing ? "It must match this source's schema." : "or browse to choose a file from your computer."}</div>
              <button className="btn primary sq" onClick={() => inputRef.current && inputRef.current.click()}>
                <Icon name="file" size={15} />Browse files
              </button>
              <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={pick} style={{ display: "none" }} />
              <div className="dz-hint">.csv · comma-separated · header row</div>
            </div>
          )}

          {view === "uploading" && (
            <div className="legs">
              <div className="leg-status">Connecting to query engine — <b>{overallPct}%</b></div>
              {LEG_DEFS.map((L, i) => {
                const state = leg > i ? "done" : leg === i ? "active" : "";
                const w = leg > i ? 100 : leg === i ? pct : 0;
                return (
                  <div className={"leg " + state} key={L.key}>
                    <span className="leg-name"><span className="leg-dot" />{L.name}</span>
                    <span className="leg-track"><span className="leg-fill" style={{ width: w + "%" }} /></span>
                    <span className="leg-pct">{w}%</span>
                  </div>
                );
              })}
              <div className="legs-foot"><Icon name="database" size={12} />duckdb · local engine</div>
            </div>
          )}

          {view === "schema" && (
            <React.Fragment>
              <div className="up-name-row">
                <div className="up-name-label">Display name</div>
                <input className="up-name-input" value={name} placeholder="Name this source…"
                  onChange={(e) => { setName(e.target.value); if (existing && onRename) onRename(source.id, e.target.value); }}
                  autoFocus={!existing} />
              </div>
              <div className="up-section-h"><Icon name="file" size={14} style={{ color: "var(--text-500)" }} />
                <span className="sh-t">Files</span><span className="sh-c">{files.length} · {totalRows.toLocaleString()} rows</span></div>
              {files.map((f, i) => (
                <div className={"file-row" + (f.fresh ? " fresh" : "")} key={i}>
                  <span className="fr-ic"><Icon name="file" size={14} /></span>
                  <span className="fr-name">{f.name}</span>
                  <span className="fr-rows">{(f.rows || 0).toLocaleString()} rows</span>
                  <span className="fr-when">{f.when}</span>
                </div>
              ))}
              <div className="up-section-h"><Icon name="table" size={14} style={{ color: "var(--text-500)" }} />
                <span className="sh-t">Schema</span><span className="sh-c">{(schema || []).length} columns</span></div>
              <div className="schema-grid">
                {(schema || []).map((c, i) => (
                  <div className="schema-col" key={i}>
                    <span className="sc-idx">{String(i + 1).padStart(2, "0")}</span>
                    <span className="sc-name">{c.name}</span>
                    <span className={"badge " + (c.type === "number" ? "number" : "text")}>{c.type}</span>
                  </div>
                ))}
              </div>
            </React.Fragment>
          )}
        </div>

        {view === "schema" && (
          <div className="up-foot">
            {existing && (
              <button className="btn sq cold-ghost" onClick={() => onArchive && onArchive({ ...source, label: name || source.label })}>
                <Icon name="snow" size={15} />Move to cold storage
              </button>
            )}
            <button className="btn sq" onClick={() => setView("browse")}><Icon name="upload" size={15} />Upload another file</button>
            <span className="spacer" />
            <button className="btn ok sq" onClick={commit}>
              <Icon name="check" size={15} />{existing ? "Done" : "Create source"}
            </button>
          </div>
        )}
      </div>
    </React.Fragment>
  );
}

function ConfirmArchive({ source, onCancel, onConfirm }) {
  const n = (source.files || []).length;
  return (
    <React.Fragment>
      <div className="up-scrim" style={{ zIndex: 46 }} onClick={onCancel} />
      <div className="confirm-dialog" role="dialog">
        <div className="cd-ic"><Icon name="snow" size={24} /></div>
        <div className="cd-title">Move to cold storage?</div>
        <div className="cd-body">
          <b>{source.label}</b>{n ? ` and its ${n} file${n > 1 ? "s" : ""}` : ""} will be moved to cold storage and kept for <b>90 days</b> before permanent deletion. You can restore it any time before then.
        </div>
        <div className="cd-actions">
          <button className="btn sq" onClick={onCancel}>Cancel</button>
          <button className="btn sq cold-btn" onClick={() => onConfirm(source)}><Icon name="snow" size={15} />Move to cold storage</button>
        </div>
      </div>
    </React.Fragment>
  );
}

const DAY_MS = 86400000;
const fmtDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const FOODS = [
  { icon: "donut", line: "Nothing in here but a day-old donut" },
  { icon: "egg", line: "Nothing in here but a single egg" },
  { icon: "carrot", line: "Nothing in here but a lonely carrot" },
  { icon: "icecream", line: "Nothing in here but melting ice cream" },
  { icon: "cookie", line: "Nothing in here but one last cookie" },
  { icon: "pizza", line: "Nothing in here but a cold slice of pizza" },
];

function ColdStorageModal({ items, onRestore, onClose }) {
  const [food] = useState(() => FOODS[Math.floor(Math.random() * FOODS.length)]);
  return (
    <React.Fragment>
      <div className="up-scrim" onClick={onClose} />
      <div className="up-modal cold-modal" role="dialog" aria-label="Cold storage">
        <div className="up-head">
          <span className="up-mark cold-mark"><Icon name="fridge" size={16} /></span>
          <div className="up-htext">
            <div className="up-title">Cold storage</div>
            <div className="up-sub">Retired sources · auto-deleted after retention</div>
          </div>
          <button className="up-x" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="up-body">
          {items.length === 0 && (
            <div className="cold-empty">
              <div className="dz-ic food"><Icon name={food.icon} size={28} /></div>
              <div className="dz-title">{food.line}</div>
              <div className="dz-sub">Retire a source from its upload window and it'll wait here, restorable, until its retention ends.</div>
            </div>
          )}
          {items.map((it) => {
            const end = it.retiredAt + it.retentionDays * DAY_MS;
            const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
            return (
              <div className="cold-row" key={it.id}>
                <span className="cold-ic"><Icon name="database" size={15} /></span>
                <div className="cold-main">
                  <div className="cold-name">{it.name}</div>
                  <div className="cold-meta">
                    <span>Retired {fmtDate(it.retiredAt)}</span>
                    <span className="cdot">·</span>
                    <span>Deletes {fmtDate(end)}</span>
                    <span className="cdot">·</span>
                    <span>{(it.files || []).length} file{(it.files || []).length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div className={"cold-left" + (daysLeft <= 7 ? " soon" : "")}>
                  <b>{daysLeft}</b><span>days left</span>
                </div>
                <button className="btn sq" onClick={() => onRestore(it.id)}><Icon name="refresh" size={14} />Restore</button>
              </div>
            );
          })}
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { UploadModal, ConfirmArchive, ColdStorageModal });
