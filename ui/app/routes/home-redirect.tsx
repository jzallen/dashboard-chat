/* index route `/` — redirect to the first project's workspace, or, when the org
   has no projects yet, a minimal inline onboarding panel. The user is already
   authenticated here (app-shell's RequireAuth ran), so empty-org must NOT bounce
   to /login, and must NOT navigate to /project/undefined. A real create-project
   flow is a later slice. */
import { Navigate } from "react-router";

import { catalog, useCatalog } from "../../src/app/useCatalog";

export default function HomeRedirect() {
  // Re-read after every catalog commit (backend projects revalidate a beat
  // after the instant fixture seed).
  useCatalog();
  const projects = catalog.listProjects();

  if (projects.length === 0) {
    return (
      <div style={{ padding: 40 }} data-testid="no-projects">
        <h1 className="serif" style={{ fontSize: 22, color: "var(--text-900)" }}>
          No projects yet
        </h1>
        <p style={{ color: "var(--text-500)" }}>
          This organization has no projects. Create one to start building your
          data pipeline.
        </p>
      </div>
    );
  }

  return <Navigate to={"/project/" + projects[0].id} replace />;
}
