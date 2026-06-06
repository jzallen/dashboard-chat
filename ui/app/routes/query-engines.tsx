/* /query-engines — compute-management stub (carried over from RouteFrame's
   engines view; the `engines` route name becomes the `/query-engines` path to
   match frontend/app/routes.ts). */
export default function QueryEnginesRoute() {
  return (
    <div style={{ padding: 40 }}>
      <h1 className="serif" style={{ fontSize: 22, color: "var(--text-900)" }}>
        Query Engines
      </h1>
      <p style={{ color: "var(--text-500)" }}>
        DuckDB · connected. Manage compute for previews and exports.
      </p>
    </div>
  );
}
