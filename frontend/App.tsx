import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./src/ui/components/AppShell";
import { AuthCallback } from "./src/ui/components/AuthCallback";
import { ChatView } from "./src/ui/components/ChatView";
import { CreateOrg } from "./src/ui/components/CreateOrg";
import { ProjectView } from "./src/ui/components/DatasetView";
import { LoginPage } from "./src/ui/components/LoginPage";
import { LogoutPage } from "./src/ui/components/LogoutPage";
import { ProjectsPage } from "./src/ui/components/OrgView";
import { QueryEngineDetail } from "./src/ui/components/QueryEngineDetail";
import { QueryEngineList } from "./src/ui/components/QueryEngineList";
import { SessionList } from "./src/ui/components/SessionList";
import { TableView } from "./src/ui/components/TableView";
import { ViewDetailView } from "./src/ui/components/ViewDetailView";
import { AuthProvider, useAuth } from "./src/ui/context/AuthContext";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function RequireOrg({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  if (!user?.org_id) return <Navigate to="/org/create" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/logout" element={<LogoutPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/org/create" element={<RequireAuth><CreateOrg /></RequireAuth>} />
      <Route element={<RequireAuth><RequireOrg><AppShell /></RequireOrg></RequireAuth>}>
        <Route index element={<ChatView />} />
        <Route path="chat/:channelId" element={<ChatView />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectView />} />
        <Route path="projects/:projectId/datasets/:datasetId" element={<ProjectView />} />
        <Route path="table/:datasetId" element={<TableView />} />
        <Route path="view/:viewId" element={<ViewDetailView />} />
        <Route path="query-engines" element={<QueryEngineList />} />
        <Route path="query-engines/:nodeId" element={<QueryEngineDetail />} />
        <Route path="sessions" element={<SessionList />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
