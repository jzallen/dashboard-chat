import { Routes, Route } from "react-router-dom";
import { AppShell } from "./src/lib/ui/components/AppShell";
import { ProjectView } from "./src/lib/ui/components/DatasetView";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<ProjectView />} />
        <Route path="/projects/:projectId/datasets/:datasetId" element={<ProjectView />} />
      </Route>
    </Routes>
  );
}
