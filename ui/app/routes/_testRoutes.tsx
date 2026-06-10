/* Test-only runtime route tree mirroring app/routes.ts. Framework mode's
   routes.ts is a build-time config, not a runtime array, so route/integration
   tests assemble the equivalent tree here with createMemoryRouter and render it
   under the same provider tree root.tsx supplies. Kept beside the route modules
   so it stays in lockstep with the real table. */
import {
  anonymousStateDocument,
  type ChatAppStateDocument,
} from "@dashboard-chat/ui-state-wire";
import { type ReactNode, useState } from "react";
import { type RouteObject } from "react-router";

import { ThemeProvider } from "../components/AppShell/ThemeProvider";
import { FlashedNodeProvider } from "../components/FlashedNodeProvider";
import { createStateProxy, type StateProxy } from "../lib/state-proxy";
import { StateProxyProvider } from "../lib/StateProxyProvider";
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

/** A SETTLED StateProxy document — phase past onboarding, a project selected —
 *  so the app-shell onboarding gate (02-04) renders the chrome for these
 *  route/nav tests exactly as before the gate existed. Tests that exercise the
 *  gate itself inject their own scripted proxy (see app-shell.test.tsx). */
function settledStateDocument(): ChatAppStateDocument {
  const doc = anonymousStateDocument();
  return {
    ...doc,
    phase: "chat",
    sequence_id: doc.sequence_id + 1,
    regions: {
      ...doc.regions,
      onboarding: { ...doc.regions.onboarding, state: "ready" },
      projectContext: {
        ...doc.regions.projectContext,
        state: "project_selected",
      },
    },
  };
}

/** A proxy with no network: POSTs answer the settled document, the SSE stream
 *  is a silent fake (happy-dom has no EventSource). */
function settledStateProxy(): StateProxy {
  const doc = settledStateDocument();
  return createStateProxy({
    seed: doc,
    fetchImpl: (async () =>
      ({ ok: true, status: 200, json: async () => doc }) as Response) as
      typeof fetch,
    eventSourceFactory: () => ({
      addEventListener() {},
      close() {},
      onerror: null,
    }),
  });
}

/** The provider tree root.tsx renders the route tree under. */
export function TestProviders({ children }: { children: ReactNode }) {
  const [proxy] = useState(settledStateProxy);
  return (
    <ThemeProvider>
      <FlashedNodeProvider>
        <StateProxyProvider proxy={proxy}>{children}</StateProxyProvider>
      </FlashedNodeProvider>
    </ThemeProvider>
  );
}
