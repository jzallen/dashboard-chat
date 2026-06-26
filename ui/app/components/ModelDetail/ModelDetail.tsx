/* Model detail view — header, dependency strip, AI audit, columns, SQL. */
import { Fragment, type ReactNode, useState } from "react";
import { useFetcher } from "react-router";

import type { LineageNode, Model } from "../../catalog";
import { Icon, LayerBadge, LayerDot, SqlBlock, TAG_ICON } from "../primitives";
import { catalog } from "../useCatalog";
import { useCatalog } from "../useCatalog";
import styles from "./ModelDetail.module.css";

// node.ref is typed as the loose ModelRef (an index-signature bag); the detail
// panels are written against the full discriminated Model, which is the actual
// runtime shape for every non-source node this view renders.
const modelOf = (node: LineageNode) => node.ref as unknown as Model;

function MatBadge({ m }: { m?: string }) {
  return m ? <span className="badge neutral up">{m}</span> : null;
}

function DepStrip({
  node,
  onOpen,
}: {
  node: LineageNode;
  onOpen: (node: LineageNode) => void;
}) {
  const parents = catalog.parentsOf(node.id);
  return (
    <div className={styles.depStrip}>
      {parents.map((p) => (
        <Fragment key={p.id}>
          <div
            className={`${styles.depChip} layer-${p.layer}`}
            onClick={() => p.ref && onOpen(p)}
          >
            <LayerDot layer={p.layer} size={7} />
            {p.label}
          </div>
        </Fragment>
      ))}
      {parents.length > 0 && (
        <Icon name="arrow" size={16} style={{ color: "var(--text-400)" }} />
      )}
      <div className={`${styles.depChip} ${styles.here} layer-${node.layer}`}>
        <LayerDot layer={node.layer} size={7} />
        {node.label}
      </div>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={styles.copyBtn}
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <Icon name={done ? "check" : "table"} size={12} />
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function AuditPanel({ node }: { node: LineageNode }) {
  const m = modelOf(node);
  const audit = catalog.auditFor(node.id);
  // map transform before/after samples onto matching audit lines for datasets
  const samples = (m.kind === "dataset" ? m.transforms : []).map(
    (t) => t.sample,
  );
  return (
    <div className="panel audit">
      <div className="panel-hd">
        <span className={styles.aiMark}>
          <Icon name="sparkle" />
        </span>
        <span className="pt">Assistant changes</span>
        <span className="pcount">{audit.length} edits</span>
      </div>
      <div className={styles.auditNote}>
        <Icon name="chat" size={13} style={{ color: "var(--text-400)" }} />
        Generated from chat — review before exporting to dbt.
      </div>
      <div className="panel-body">
        {audit.map((a, i) => {
          // A transform-type entry toggled off stays in the trail but renders
          // inactive: faded, with a "disabled" chip.
          const disabled = a.transformId != null && a.enabled === false;
          return (
            <div
              className={`${styles.audItem}${disabled ? " " + styles.audDisabled : ""}`}
              key={i}
            >
              <span className={styles.audIco}>
                <Icon name={TAG_ICON[a.tag]} />
              </span>
              <div style={{ flex: 1 }}>
                <div className={styles.audSay}>{a.say}</div>
                {m.kind === "dataset" && samples[i] && (
                  <div className={styles.ba}>
                    <span className={styles.b}>
                      {String(samples[i].before)}
                    </span>
                    <span className={styles.ar}>→</span>
                    <span className={styles.a}>{String(samples[i].after)}</span>
                  </div>
                )}
              </div>
              {disabled && (
                <span className={styles.audDisabledChip}>disabled</span>
              )}
              {a.transformId != null && a.auditEntryId && (
                <input
                  type="checkbox"
                  role="switch"
                  className={styles.audToggle}
                  aria-label={`Toggle ${a.say}`}
                  checked={a.enabled ?? false}
                  onChange={() =>
                    catalog.toggleAudit(node.id, a.auditEntryId!, !a.enabled)
                  }
                />
              )}
              <span className={styles.audTag}>{a.tag}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ColumnsPanel({ node }: { node: LineageNode }) {
  const m = modelOf(node);
  let head: string[];
  let rows: ReactNode[][];
  if (m.kind === "dataset") {
    head = ["Field", "Type"];
    rows = m.fields.map((f) => [
      <span className={styles.cn}>{f.name}</span>,
      <span className={"badge " + (f.type === "number" ? "number" : "text")}>
        {f.type}
      </span>,
    ]);
  } else if (m.kind === "view") {
    head = ["Column", "Type", "Role", "Source"];
    rows = m.columns.map((c) => [
      <span className={styles.cn}>{c.name}</span>,
      <span
        className={
          "badge " +
          (["integer", "decimal"].includes(c.display_type) ? "number" : "text")
        }
      >
        {c.display_type}
      </span>,
      c.grain_role ? (
        <span
          className={`${styles.role} ${styles[c.grain_role.toLowerCase()] ?? ""}`}
        >
          {c.grain_role}
        </span>
      ) : (
        "—"
      ),
      <span className={styles.expr}>
        {c.source_ref}.{c.source_column}
      </span>,
    ]);
  } else {
    head = ["Column", "Role", "Type", "Expression"];
    rows = m.columns_metadata.map((c) => [
      <span className={styles.cn}>{c.name}</span>,
      <span className={`${styles.role} ${styles[c.semantic_role] ?? ""}`}>
        {c.semantic_role}
      </span>,
      <span className={styles.expr}>
        {c.semantic_type}
        {c.time_granularity ? ` · ${c.time_granularity}` : ""}
      </span>,
      c.expr ? <span className={styles.expr}>{c.expr}</span> : "—",
    ]);
  }
  return (
    <div className="panel">
      <div className="panel-hd">
        <Icon name="table" size={15} style={{ color: "var(--text-500)" }} />
        <span className="pt">Columns</span>
        <span className="pcount">{rows.length}</span>
      </div>
      <table className={styles.colsTable}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryRow({ node }: { node: LineageNode }) {
  const m = modelOf(node);
  const kvs: [string, string | number][] = [];
  if (m.kind === "view") {
    kvs.push(
      ["joins", m.joins.length],
      ["filters", m.filters.length],
      ["grain", m.grain ? m.grain.time_column : "—"],
      ["sources", m.source_refs.length],
    );
  } else if (m.kind === "report") {
    const meas = m.columns_metadata.filter(
      (c) => c.semantic_role === "measure",
    ).length;
    kvs.push(
      ["type", m.report_type],
      ["measures", meas],
      ["domain", m.domain],
      ["rows", m.rows.toLocaleString()],
    );
  } else {
    kvs.push(
      ["rows", m.rows.toLocaleString()],
      ["fields", m.fields.length],
      ["transforms", m.transforms.length],
    );
  }
  return (
    <div className={styles.summaryRow}>
      {kvs.map(([k, v], i) => (
        <span className={styles.kv} key={i}>
          {k} <b>{v}</b>
        </span>
      ))}
    </div>
  );
}

function fmtCell(v: string | number | null) {
  if (v === null || v === undefined || v === "")
    return <span style={{ color: "var(--text-400)" }}>—</span>;
  if (typeof v === "number")
    return (
      <span className="mono">
        {v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </span>
    );
  return String(v);
}

function DataPreview({ node }: { node: LineageNode }) {
  const m = modelOf(node);
  const cols =
    m.kind === "dataset"
      ? m.fields.map((f) => f.name)
      : m.kind === "view"
        ? m.columns.map((c) => c.name)
        : m.columns_metadata.map((c) => c.name);
  const rows = m.preview || [];
  if (rows.length === 0) return null;
  return (
    <div className="panel spanfull">
      <div className={styles.sqlBar}>
        <Icon name="grid" size={14} style={{ color: "var(--text-500)" }} />
        <span className={styles.st}>Data preview</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--text-400)",
          }}
        >
          {rows.length} of {m.rows.toLocaleString()} rows
        </span>
      </div>
      <div className={styles.prevWrap}>
        <table className={styles.prevTable}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c}>{fmtCell(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The dataset display name as a click-to-edit header. Click commits the draft by
 * submitting a PATCH `{ display_name }` via `useFetcher` to the
 * `/ui-server/datasets/:datasetId` action (ADR-034: the action brokers the write
 * to the backend and RRv7 auto-revalidates the active loaders on success).
 * Pessimistic-by-default — no optimistic flip; Enter/blur commits, Escape
 * cancels, and an empty/whitespace or unchanged draft is a no-op.
 *
 * Editing is gated to dataset nodes — views/reports render a static label.
 */
function DetName({ node }: { node: LineageNode }) {
  const editable = modelOf(node).kind === "dataset";
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label);

  if (!editing) {
    return (
      <div
        className={styles.detName}
        onClick={
          editable
            ? () => {
                setDraft(node.label);
                setEditing(true);
              }
            : undefined
        }
      >
        {node.label}
      </div>
    );
  }

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === node.label) return; // no-op / cancel
    fetcher.submit(
      { display_name: next },
      {
        method: "PATCH",
        action: `/ui-server/datasets/${encodeURIComponent(node.id)}`,
        encType: "application/json",
      },
    );
  };

  return (
    <input
      className={`${styles.detName} ${styles.detNameEditing}`}
      aria-label="Edit dataset name"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

/**
 * A blocking confirm dialog gating a dbt machine-name (`model_name`) change.
 * Clones the {@link ConfirmArchive} shape (global `up-scrim` + `role="dialog"`
 * + cancel/confirm). Renaming the machine name is a deliberate act: the app
 * repoints everything it manages (the lakehouse view + the exportable dbt
 * project) automatically, but anything OUTSIDE the app keyed on the old name
 * is the user's to update — and the display name is the soft, deferable
 * alternative. The copy says this in plain, non-technical terms.
 */
function ConfirmModelName({
  oldName,
  newName,
  displayName,
  onCancel,
  onConfirm,
}: {
  oldName: string;
  newName: string;
  displayName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="up-scrim" style={{ zIndex: 46 }} onClick={onCancel} />
      <div className={styles.confirmDialog} role="dialog">
        <div className={styles.cdTitle}>Update the machine name?</div>
        <div className={styles.cdBody}>
          <b>{oldName}</b> → <b>{newName}</b>. The app takes care of this for you
          everywhere it manages — your data here and the dbt project you can
          export both stay in sync. The one thing to know: anything outside the
          app that points to <b>{oldName}</b>, like an external database or BI
          tool, you&rsquo;ll need to update yourself.
          <span className={styles.cdNote}>
            Not ready to commit? You can rename the display name,{" "}
            <b>{displayName}</b>, instead — that&rsquo;s a soft, in-app label, so
            the machine name and everything built from it stay exactly as they
            are.
          </span>
        </div>
        <div className={styles.cdActions}>
          <button className="btn sq" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn ok sq" onClick={onConfirm}>
            Change machine name
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The header subline beneath {@link DetName}.
 *
 * For a DATASET node this renders the EDITABLE dbt machine name
 * (`node.modelName`, e.g. `stg_customers`) — a SECOND, independent editor from
 * {@link DetName} (the display label). The two are DECOUPLED: this path only
 * ever calls `catalog.setModelName`, never `renameSource`. Editing is
 * PESSIMISTIC: a click opens a draft input; committing it opens a blocking
 * {@link ConfirmModelName} dialog, and only confirming writes (no optimistic
 * flip). Cancel/Escape reverts the draft with no write. Gates to nothing for a
 * legacy dataset row with no `modelName`.
 *
 * For VIEW / REPORT nodes there is no machine name, so the friendly model name
 * (`m.name`) is shown READ-ONLY — distinct from the technical header label.
 *
 * On confirm the change is submitted as a PATCH `{ model_name }` via `useFetcher`
 * to the shared `/ui-server/datasets/:datasetId` action (ADR-034). model_name is
 * inherently pessimistic — write-first; the action surfaces a non-2xx (e.g. a 409
 * collision) to the caller and RRv7 auto-revalidates only on success.
 */
function DetSubline({ node, m }: { node: LineageNode; m: Model }) {
  const isDataset = m.kind === "dataset";
  const text = isDataset ? node.modelName : m.name;
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const [pending, setPending] = useState<string | null>(null);

  if (!text) return null;

  if (!isDataset) {
    return <div className={styles.detFriendly}>{text}</div>;
  }

  if (pending !== null) {
    return (
      <>
        <div className={styles.detFriendly}>{text}</div>
        <ConfirmModelName
          oldName={text}
          newName={pending}
          displayName={node.label}
          onCancel={() => {
            setPending(null);
            setDraft(text);
          }}
          onConfirm={() => {
            fetcher.submit(
              { model_name: pending },
              {
                method: "PATCH",
                action: `/ui-server/datasets/${encodeURIComponent(node.id)}`,
                encType: "application/json",
              },
            );
            setPending(null);
          }}
        />
      </>
    );
  }

  if (!editing) {
    return (
      <div
        className={styles.detFriendly}
        onClick={() => {
          setDraft(text);
          setEditing(true);
        }}
      >
        {text}
      </div>
    );
  }

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === text) return; // no-op / cancel → no dialog
    setPending(next);
  };

  return (
    <input
      className={`${styles.detFriendly} ${styles.detNameEditing}`}
      aria-label="Edit dataset machine name"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(text);
          setEditing(false);
        }
      }}
    />
  );
}

export function ModelDetail({
  node,
  onOpen,
}: {
  node: LineageNode;
  onOpen: (node: LineageNode) => void;
}) {
  const m = modelOf(node);
  useCatalog(); // subscribe: re-render when the catalog mutates
  return (
    <div className={`${styles.det} layer-${node.layer}`}>
      <div className={styles.detHd}>
        <div>
          <DetName node={node} />
          <DetSubline node={node} m={m} />
        </div>
        <div className={styles.detBadges}>
          <LayerBadge layer={node.layer} />
          {m.kind === "report" && <MatBadge m={m.report_type} />}
          <MatBadge
            m={"materialization" in m ? m.materialization : undefined}
          />
        </div>
      </div>
      <DepStrip node={node} onOpen={onOpen} />
      <SummaryRow node={node} />
      <div className={styles.detGrid} style={{ marginTop: 16 }}>
        <DataPreview node={node} />
        <AuditPanel node={node} />
        <ColumnsPanel node={node} />
        <div className="panel spanfull">
          <div className={styles.sqlBar}>
            <Icon
              name="database"
              size={14}
              style={{ color: "var(--text-500)" }}
            />
            <span className={styles.st}>Compiled SQL</span>
            <CopyBtn text={m.sql} />
          </div>
          <SqlBlock sql={m.sql} />
        </div>
      </div>
    </div>
  );
}
