import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  useQueryEngineDetailQuery,
  useTestQueryEngine,
} from "../../hooks/useQueryEngineQuery";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      style={{
        marginLeft: 8,
        padding: "2px 8px",
        fontSize: 12,
        border: "1px solid #d1d5db",
        borderRadius: 4,
        background: copied ? "#dcfce7" : "#fff",
        cursor: "pointer",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ConnectionString({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <code
          style={{
            fontSize: 13,
            background: "#f3f4f6",
            padding: "4px 8px",
            borderRadius: 4,
            wordBreak: "break-all",
          }}
        >
          {value}
        </code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

export function QueryEngineDetail() {
  const { nodeId } = useParams<{ nodeId: string }>();
  const { data: engine, isLoading, error } = useQueryEngineDetailQuery(nodeId);
  const testMutation = useTestQueryEngine();

  if (isLoading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (error) return <div style={{ padding: 24, color: "#ef4444" }}>Failed to load engine details</div>;
  if (!engine) return <div style={{ padding: 24 }}>Engine not found</div>;

  const pgConnStr = `postgresql://<username>:<password>@${engine.host}:${engine.port}/${engine.database}`;
  const odbcConnStr = `Driver={PostgreSQL Unicode};Server=${engine.host};Port=${engine.port};Database=${engine.database};Uid=<username>;Pwd=<password>;`;
  const jdbcConnStr = `jdbc:postgresql://${engine.host}:${engine.port}/${engine.database}?user=<username>&password=<password>`;
  const psqlCmd = `psql -h ${engine.host} -p ${engine.port} -d ${engine.database} -U <username>`;

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <Link to="/query-engines" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#6b7280", textDecoration: "none", marginBottom: 16, fontSize: 14 }}>
        <ArrowLeftIcon style={{ width: 14, height: 14 }} />
        Back to Query Engines
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{engine.name}</h2>
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: 9999,
            background: engine.status === "active" || engine.status === "running" ? "#dcfce7" : "#fef3c7",
            color: engine.status === "active" || engine.status === "running" ? "#166534" : "#92400e",
          }}
        >
          {engine.status}
        </span>
        <button
          onClick={() => nodeId && testMutation.mutate(nodeId)}
          disabled={testMutation.isPending}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            fontSize: 13,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </button>
      </div>

      {testMutation.data && (
        <div style={{
          marginBottom: 16,
          padding: "8px 12px",
          borderRadius: 6,
          background: testMutation.data.success ? "#dcfce7" : "#fef2f2",
          fontSize: 13,
        }}>
          {testMutation.data.success
            ? `Connection OK (${testMutation.data.latency_ms}ms)`
            : `Connection failed: ${testMutation.data.error}`}
        </div>
      )}

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Connection Strings</h3>
        <ConnectionString label="PostgreSQL" value={pgConnStr} />
        <ConnectionString label="ODBC" value={odbcConnStr} />
        <ConnectionString label="JDBC" value={jdbcConnStr} />
        <ConnectionString label="psql" value={psqlCmd} />
      </section>

      {engine.connected_projects && engine.connected_projects.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Connected Projects</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
                <th style={{ padding: "6px 12px", fontWeight: 500, color: "#6b7280", fontSize: 13 }}>Project</th>
                <th style={{ padding: "6px 12px", fontWeight: 500, color: "#6b7280", fontSize: 13 }}>Schema</th>
                <th style={{ padding: "6px 12px", fontWeight: 500, color: "#6b7280", fontSize: 13 }}>Sync Status</th>
              </tr>
            </thead>
            <tbody>
              {engine.connected_projects.map((p) => (
                <tr key={p.project_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 12px" }}>{p.project_name}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 13 }}>{p.schema_name}</td>
                  <td style={{ padding: "8px 12px" }}>{p.sync_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Quick-Start Guides</h3>
        <div style={{ fontSize: 13, color: "#374151" }}>
          <p><strong>Excel (ODBC):</strong> Data tab &gt; Get Data &gt; From Other Sources &gt; ODBC. Use the ODBC connection string above with PostgreSQL Unicode driver.</p>
          <p><strong>Power BI:</strong> Get Data &gt; PostgreSQL. Server: <code>{engine.host}:{engine.port}</code>, Database: <code>{engine.database}</code>.</p>
          <p><strong>Tableau:</strong> Connect &gt; PostgreSQL. Server: <code>{engine.host}</code>, Port: <code>{engine.port}</code>, Database: <code>{engine.database}</code>.</p>
          <p><strong>dbt:</strong> Add to <code>profiles.yml</code>:</p>
          <pre style={{ background: "#f3f4f6", padding: 12, borderRadius: 6, fontSize: 12, overflow: "auto" }}>
{`my_profile:
  target: prod
  outputs:
    prod:
      type: postgres
      host: ${engine.host}
      port: ${engine.port}
      dbname: ${engine.database}
      user: <username>
      password: <password>
      schema: <project_schema>`}
          </pre>
        </div>
      </section>
    </div>
  );
}
