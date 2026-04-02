import { ServerIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";

import { useQueryEnginesQuery } from "../../hooks/useQueryEngineQuery";

const statusColors: Record<string, string> = {
  active: "#22c55e",
  running: "#22c55e",
  degraded: "#f59e0b",
  unreachable: "#ef4444",
  pending: "#6b7280",
};

export function QueryEngineList() {
  const { data: engines, isLoading, error } = useQueryEnginesQuery();

  if (isLoading) {
    return <div style={{ padding: 24 }}>Loading query engines...</div>;
  }

  if (error) {
    return <div style={{ padding: 24, color: "#ef4444" }}>Failed to load query engines</div>;
  }

  if (!engines || engines.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Query Engines</h2>
        <p style={{ color: "#6b7280" }}>No query engine nodes configured for this organization.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Query Engines</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
            <th style={{ padding: "8px 12px", fontWeight: 500, color: "#6b7280" }}>Name</th>
            <th style={{ padding: "8px 12px", fontWeight: 500, color: "#6b7280" }}>Status</th>
            <th style={{ padding: "8px 12px", fontWeight: 500, color: "#6b7280" }}>Endpoint</th>
            <th style={{ padding: "8px 12px", fontWeight: 500, color: "#6b7280" }}>Projects</th>
          </tr>
        </thead>
        <tbody>
          {engines.map((engine) => (
            <tr key={engine.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "10px 12px" }}>
                <Link
                  to={`/query-engines/${engine.id}`}
                  style={{ display: "flex", alignItems: "center", gap: 8, color: "#2563eb", textDecoration: "none" }}
                >
                  <ServerIcon style={{ width: 16, height: 16 }} />
                  {engine.name}
                </Link>
              </td>
              <td style={{ padding: "10px 12px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: statusColors[engine.status] ?? "#6b7280",
                    }}
                  />
                  {engine.status}
                </span>
              </td>
              <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 13 }}>
                {engine.host}:{engine.port}
              </td>
              <td style={{ padding: "10px 12px" }}>
                {engine.project_count ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
