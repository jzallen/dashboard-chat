import { Navigate,Route, Routes } from "react-router-dom";

import { AppShell } from "./src/lib/ui/components/AppShell";
import { AuthCallback } from "./src/lib/ui/components/AuthCallback";
import { CreateOrg } from "./src/lib/ui/components/CreateOrg";
import { ProjectView } from "./src/lib/ui/components/DatasetView";
import { LoginPage } from "./src/lib/ui/components/LoginPage";
import { LogoutPage } from "./src/lib/ui/components/LogoutPage";
import { OrgView } from "./src/lib/ui/components/OrgView";
import { SessionViewer } from "./src/lib/ui/components/SessionViewer";
import { SessionList } from "./src/lib/ui/components/SessionViewer/SessionList";
import { AuthProvider, useAuth } from "./src/lib/ui/context/AuthContext";

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
      <Route path="/projects" element={<Navigate to="/" replace />} />
      <Route element={<RequireAuth><RequireOrg><AppShell /></RequireOrg></RequireAuth>}>
        <Route path="/" element={<OrgView />} />
        <Route path="/projects/:projectId" element={<ProjectView />} />
        <Route path="/projects/:projectId/datasets/:datasetId" element={<ProjectView />} />
        <Route path="/projects/:projectId/datasets/:datasetId/sessions" element={<SessionList />} />
        <Route path="/projects/:projectId/datasets/:datasetId/sessions/:sessionId" element={<SessionViewer />} />
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
