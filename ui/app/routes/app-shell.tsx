/* The layout route — composition root of the persistent chrome.

   - Redirects to /login when there's no session, so an unauthenticated deep-link
     folds into the dev sign-in.
   - Authenticated entries pass the onboarding gate (D6, in OnboardingGate),
     which renders the chrome (Chrome) once the StateProxy document resolves.
   - Seeds the catalog from the loader's org-global payload so child routes read
     real projects/org rather than the fixture seed.

   The chrome and onboarding gate live under components/AppShell/; this module
   keeps only what React Router owns: the loader, shouldRevalidate, the auth
   gate, and the default export. */
import { useEffect } from "react";
import {
  type LoaderFunctionArgs,
  Navigate,
  redirect,
  useLoaderData,
} from "react-router";

import { hasSession } from "../auth/tokenStorage";
import type { OrgSettings, ProjectSummary } from "../catalog";
import { apiGet, apiPost } from "../catalog/dataSources/backendClient";
import {
  type BackendOrg,
  type BackendProject,
  toOrgSettings,
  toProjectSummary,
  unwrapList,
  unwrapSingle,
} from "../catalog/dataSources/metadataMappers";
import { OnboardingGate } from "../components/AppShell/OnboardingGate";
import { seedOrgGlobal } from "../components/useCatalog";
import {
  apiFetch,
  ApiUnauthenticatedError,
  assertAuthenticated,
} from "../lib/api-client";
import type { OnboardingClient } from "../lib/onboarding-driver";

/** The default backend client adapter — the Phase-B probe's real HTTP port. */
const defaultClient: OnboardingClient = {
  get: (path) => apiGet(path),
  post: (path, body) => apiPost(path, body),
};

/** The org-global payload the server loader returns for the initial document. */
export interface OrgGlobalData {
  projects: ProjectSummary[];
  org: OrgSettings;
}

/**
 * Fetch the org-global payloads — the project list and org settings — server-side
 * so the chrome renders with real projects/org in the initial document rather
 * than fetching them after hydration. The component seeds the catalog from this
 * via `useLoaderData()`.
 *
 * Reaches the backend through the server `/api` client (the cookie→Bearer hop),
 * which returns the raw upstream Response — so each body is read and unwrapped
 * from its JSON:API envelope here, then mapped to the catalog DTOs. An
 * unauthenticated (401) response becomes a redirect to /login rather than a
 * client-surfaced error.
 */
export async function loader({
  request,
}: LoaderFunctionArgs): Promise<OrgGlobalData> {
  let projectsRes: Response;
  let orgRes: Response;
  try {
    [projectsRes, orgRes] = await Promise.all([
      apiFetch(request, "/projects").then(assertAuthenticated),
      apiFetch(request, "/orgs/me").then(assertAuthenticated),
    ]);
  } catch (err) {
    if (err instanceof ApiUnauthenticatedError) throw redirect("/login");
    throw err;
  }

  const projects = unwrapList<BackendProject>(await projectsRes.json()).map(
    toProjectSummary,
  );
  const org = toOrgSettings(unwrapSingle<BackendOrg>(await orgRes.json()));
  return { projects, org };
}

/**
 * Org-global data (projects, org settings) does not change with in-app
 * navigation, so the loader runs once per document load and is never
 * revalidated — re-fetching it on every navigation would be redundant.
 */
export function shouldRevalidate() {
  return false;
}

export default function AppShell({
  client = defaultClient,
}: {
  /** Test seam: inject the Phase-B probe's HTTP port; defaults to the backend. */
  client?: OnboardingClient;
}) {
  // Seed the catalog from the loader's org-global payload so child routes (the
  // home redirect, the project layout) read real projects/org rather than the
  // fixture seed. Undefined when the route carries no loader — then it's a no-op.
  const data = useLoaderData() as OrgGlobalData | undefined;
  useEffect(() => {
    if (data) seedOrgGlobal(data.projects, data.org);
  }, [data]);

  if (!hasSession()) return <Navigate to="/login" replace />;
  return <OnboardingGate client={client} />;
}
