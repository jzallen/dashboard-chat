import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./src/lib/ui/components/AppShell";
import { ProjectView } from "./src/lib/ui/components/DatasetView";
import { SessionList } from "./src/lib/ui/components/SessionViewer/SessionList";
import { SessionViewer } from "./src/lib/ui/components/SessionViewer";

const DEFAULT_PROJECT_ID = "default-project-001";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="/projects" element={<Navigate to={`/projects/${DEFAULT_PROJECT_ID}`} replace />} />
      <Route element={<AppShell />}>
        <Route path="/projects/:projectId" element={<ProjectView />} />
        <Route path="/projects/:projectId/datasets/:datasetId" element={<ProjectView />} />
        <Route path="/projects/:projectId/datasets/:datasetId/sessions" element={<SessionList />} />
        <Route path="/projects/:projectId/datasets/:datasetId/sessions/:sessionId" element={<SessionViewer />} />
      </Route>
    </Routes>
  );
}
