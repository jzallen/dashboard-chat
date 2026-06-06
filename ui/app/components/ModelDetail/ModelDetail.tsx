/* Model detail view — header, dependency strip, AI audit, columns, SQL.
   Exclusive styles are scoped (ModelDetail.module.css); the shared .panel /
   .panel-hd / .badge / .sql-block primitives and the layer-* helpers stay
   global. */
import { Fragment, type ReactNode, useState } from "react";

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
                    <span className={styles.b}>{String(samples[i].before)}</span>
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
          <div className={styles.detName}>{node.label}</div>
          <div className={styles.detFriendly}>{m.name}</div>
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
