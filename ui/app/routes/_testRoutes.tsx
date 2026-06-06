/* Test-only runtime route tree mirroring app/routes.ts. Framework mode's
   routes.ts is a build-time config, not a runtime array, so route/integration
   tests assemble the equivalent tree here with createMemoryRouter and render it
   under the same provider tree root.tsx supplies. Kept beside the route modules
   so it stays in lockstep with the real table. */
import type { ReactNode } from "react";
import { type RouteObject } from "react-router";

import { ThemeProvider } from "../../src/app/AppShell/ThemeProvider";
import { FlashedNodeProvider } from "../../src/app/FlashedNodeProvider";
import AppShell from "./app-shell";
import AuthCallbackRoute from "./auth-callback";
import ChatsRoute from "./chats";
import DatasetDetailRoute from "./dataset-detail";
import HomeRedirect from "./home-redirect";
import LoginRoute from "./login";
import OrgRoute from "./org";
import ProjectLayout, { clientLoader as projectLoader } from "./project-layout";
import QueryEnginesRoute from "./query-engines";
import ReportDetailRoute from "./report-detail";
import ViewDetailRoute from "./view-detail";
import WorkspaceRoute from "./workspace";

/** The runtime equivalent of app/routes.ts, for createMemoryRouter. The
 *  project layout's loader re-scopes the catalog, exercising the real seam. */
export const testRouteTree: RouteObject[] = [
  { path: "/login", element: <LoginRoute /> },
  { path: "/auth/callback", element: <AuthCallbackRoute /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: "org", element: <OrgRoute /> },
      { path: "query-engines", element: <QueryEnginesRoute /> },
      {
        path: "project/:projectId",
        element: <ProjectLayout />,
        loader: ({ params }) =>
          projectLoader({ params: params as { projectId?: string } }),
        children: [
          { index: true, element: <WorkspaceRoute /> },
          { path: "dataset/:datasetId", element: <DatasetDetailRoute /> },
          { path: "view/:viewId", element: <ViewDetailRoute /> },
          { path: "report/:reportId", element: <ReportDetailRoute /> },
          { path: "chats", element: <ChatsRoute /> },
        ],
      },
    ],
  },
];

/** The provider tree root.tsx renders the route tree under. */
export function TestProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <FlashedNodeProvider>{children}</FlashedNodeProvider>
    </ThemeProvider>
  );
}
