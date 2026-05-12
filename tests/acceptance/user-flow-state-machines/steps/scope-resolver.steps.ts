// Step definitions for `features/slice-1-scope-resolver.feature` (step 01-03).
//
// All step bodies drive through the harness (`open_deep_link`,
// `assert_scope_reconciled`) — no test imports from ui-state/lib/**
// (CM-A). The harness routes through auth-proxy:1042 (driving port).
//
// Scenarios covered:
//   1. Happy-path deep link → scope.org_id + scope.project_id + project.name
//   2. Cross-tenant deep link → access_denied with named diagnostic (I1/I4)
//   3. Stale-bookmark deep link → scope_reconciled FlowEvent (I5)
//   4. Resource-type without resource-id → project-only scope (I3 fallback)

import { After, Before, Given, Then, When } from "@cucumber/cucumber";
import { expect } from "expect";

import { FakeWorkOS } from "./fake-workos.ts";
import { MAYA } from "./fixtures/personas.ts";
import { wait_for_health } from "./fixtures/compose.ts";
import type { UserFlowWorld } from "./world.ts";

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL ?? "http://localhost:1042";
const FAKE_WORKOS_PORT = parseInt(
  process.env.FAKE_WORKOS_PORT ?? "14299",
  10,
);

// In dev mode auth-proxy injects X-Org-Id=dev-org-001. That is Maya's tenant
// for the scope-resolver scenarios. We use a deterministic project id so
// the harness can construct the deep-link route without provisioning.
const DEV_ORG_ID = "dev-org-001";
const MAYA_PROJECT_ID = "proj-q4-analytics-dev";

// --------------------------------------------------------------------------
// Hook: stand up the fake WorkOS so begin_auth can resolve identity.
// (Mirrors the @slice-1 hook in error-paths.steps.ts but matches
// @scope-resolver scenarios that share the same scaffolding need.)
// --------------------------------------------------------------------------
Before({ tags: "@scope-resolver" }, async function (this: UserFlowWorld) {
  this.fakeWorkOS = new FakeWorkOS({ port: FAKE_WORKOS_PORT });
  await this.fakeWorkOS.start();
  this.fakeWorkOS.set_profile_for("maya-auth-code", {
    email: MAYA.email,
    display_name: MAYA.display_name,
  });
  await wait_for_health(`${AUTH_PROXY_URL}/ui-state/health`);
});

After({ tags: "@scope-resolver" }, async function (this: UserFlowWorld) {
  if (this.fakeWorkOS) {
    await this.fakeWorkOS.stop();
    this.fakeWorkOS = null;
  }
});

// --------------------------------------------------------------------------
// Shared Given: Maya has an org + project. In dev mode the org is implied
// (DEV_USER carries dev-org-001); we stash the "current name" so the
// open_deep_link payload can carry it as project_name.
// --------------------------------------------------------------------------
Given(
  /^Maya has organization "([^"]+)" with project "([^"]+)" already set up$/,
  async function (
    this: UserFlowWorld,
    orgName: string,
    projectName: string,
  ) {
    const harness = this.use_harness_for("maya");
    // Drive Maya through sign-in + org setup so the flow is in `ready` with
    // org.name populated. The subsequent deep-link reads that projection.
    await harness.begin_auth("maya");
    const submitProjection = await harness.submit_org(orgName);
    expect(submitProjection.state).toBe("ready");
    expect(
      (submitProjection.context as { org?: { name?: string } }).org?.name,
    ).toBe(orgName);
    this.bag.maya_org_name = orgName;
    this.bag.maya_project_name = projectName;
    this.bag.maya_project_id = MAYA_PROJECT_ID;
  },
);

Given(
  /^Maya belongs to organization "([^"]+)"$/,
  async function (this: UserFlowWorld, orgName: string) {
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    const submitProjection = await harness.submit_org(orgName);
    expect(submitProjection.state).toBe("ready");
    this.bag.maya_org_name = orgName;
  },
);

Given(
  /^another tenant owns a project with id "([^"]+)"$/,
  function (this: UserFlowWorld, foreignProjectId: string) {
    // In dev mode the "another tenant" is modelled as a route that names a
    // DIFFERENT org_id than Maya's JWT (dev-org-001). The pure resolver
    // catches it as cross_tenant — no backend provisioning needed.
    this.bag.foreign_project_id = foreignProjectId;
    this.bag.foreign_org_id = "org-foreign-other-tenant";
  },
);

Given(
  /^Maya bookmarked project "([^"]+)" when its name was "([^"]+)"$/,
  async function (
    this: UserFlowWorld,
    currentName: string,
    bookmarkedName: string,
  ) {
    // Maya's machine is in `ready`; stash the bookmarked (stale) and the
    // current (server-known) names so the When step can drive the
    // reconciliation case.
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    // The org name used for the sign-in submission is irrelevant for the
    // reconciliation scenario — what matters is the project name diff.
    const submitProjection = await harness.submit_org("Acme Data");
    expect(submitProjection.state).toBe("ready");
    this.bag.maya_project_name = currentName;
    this.bag.maya_bookmarked_project_name = bookmarkedName;
    this.bag.maya_project_id = MAYA_PROJECT_ID;
  },
);

Given(
  /^the project's name was later changed to "([^"]+)"$/,
  function (this: UserFlowWorld, newName: string) {
    // No-op vs. the previous Given — the bookmarked-vs-current diff is
    // already captured. Sanity-check the names disagree as the feature
    // promises.
    const current = this.bag.maya_project_name as string;
    expect(current).toBe(newName);
  },
);

Given(
  /^Maya has project "([^"]+)"$/,
  async function (this: UserFlowWorld, projectName: string) {
    const harness = this.use_harness_for("maya");
    await harness.begin_auth("maya");
    const submitProjection = await harness.submit_org("Acme Data");
    expect(submitProjection.state).toBe("ready");
    this.bag.maya_project_name = projectName;
    this.bag.maya_project_id = MAYA_PROJECT_ID;
  },
);

// --------------------------------------------------------------------------
// When: Maya opens deep links of various shapes.
// --------------------------------------------------------------------------

When(
  /^Maya opens the deep link to project "([^"]+)" cold$/,
  async function (this: UserFlowWorld, _projectName: string) {
    const harness = this.harness;
    if (!harness) throw new Error("harness not initialized");
    const projection = await harness.open_deep_link({
      route: {
        org: DEV_ORG_ID,
        project: this.bag.maya_project_id as string,
      },
      project_name: this.bag.maya_project_name as string,
    });
    this.bag.scope_projection = projection;
  },
);

When(
  "Maya opens a deep link to the foreign project",
  async function (this: UserFlowWorld) {
    const harness = this.harness;
    if (!harness) throw new Error("harness not initialized");
    const projection = await harness.open_deep_link({
      route: {
        org: this.bag.foreign_org_id as string,
        project: this.bag.foreign_project_id as string,
      },
    });
    this.bag.scope_projection = projection;
  },
);

When("Maya opens the stale bookmark", async function (this: UserFlowWorld) {
  const harness = this.harness;
  if (!harness) throw new Error("harness not initialized");
  const projection = await harness.open_deep_link({
    route: {
      org: DEV_ORG_ID,
      project: this.bag.maya_project_id as string,
    },
    project_name: this.bag.maya_project_name as string,
    bookmarked_project_name: this.bag.maya_bookmarked_project_name as string,
  });
  this.bag.scope_projection = projection;
});

When(
  /^Maya opens a deep link that names "([^"]+)" as the resource type with no resource id$/,
  async function (this: UserFlowWorld, resourceType: string) {
    const harness = this.harness;
    if (!harness) throw new Error("harness not initialized");
    const projection = await harness.open_deep_link({
      route: {
        org: DEV_ORG_ID,
        project: this.bag.maya_project_id as string,
        resource_type: resourceType as "dataset" | "view" | "report",
        // resource_id intentionally omitted — boundary case.
      },
      project_name: this.bag.maya_project_name as string,
    });
    this.bag.scope_projection = projection;
  },
);

// --------------------------------------------------------------------------
// Then: assertions over the resulting projection.
// --------------------------------------------------------------------------

Then(
  /^Maya sees "([^"]+)" as the active organization on first paint$/,
  function (this: UserFlowWorld, expectedOrgName: string) {
    const projection = this.bag.scope_projection as {
      context: { org?: { name?: string } };
    };
    expect(projection.context?.org?.name).toBe(expectedOrgName);
  },
);

Then(
  /^Maya sees "([^"]+)" as the active project on first paint$/,
  function (this: UserFlowWorld, expectedProjectName: string) {
    const projection = this.bag.scope_projection as {
      context: { project?: { name?: string | null } };
    };
    expect(projection.context?.project?.name).toBe(expectedProjectName);
  },
);

Then(
  "Maya sees the project's dashboard content on the same first paint",
  function (this: UserFlowWorld) {
    // The dashboard view binds to `ready` state in the FE. The contract
    // observable through the driving port: state is `ready` and the
    // active_scope carries the project id (so the FE knows what to render).
    const projection = this.bag.scope_projection as {
      state: string;
      active_scope: { project_id: string | null };
    };
    expect(projection.state).toBe("ready");
    expect(projection.active_scope.project_id).toBeTruthy();
  },
);

Then(
  /^no placeholder text \("Loading\.\.\.", "Default Project", or empty\) appears anywhere on first paint$/,
  function (this: UserFlowWorld) {
    // Negative invariant: context.org.name and context.project.name are
    // both populated (not null, not empty). The FE binds these to the
    // org/project chips; non-empty means no placeholder.
    const projection = this.bag.scope_projection as {
      state: string;
      context: {
        org?: { name?: string | null };
        project?: { name?: string | null };
      };
    };
    expect(projection.context?.org?.name).toBeTruthy();
    expect(projection.context?.project?.name).toBeTruthy();
    // No "loading" state -- we're past authenticating/creating_org.
    expect(projection.state).not.toBe("authenticating");
    expect(projection.state).not.toBe("creating_org");
  },
);

Then("Maya sees an access-denied page", function (this: UserFlowWorld) {
  const projection = this.bag.scope_projection as { state: string };
  expect(projection.state).toBe("access_denied");
});

Then(
  /^Maya's app shell continues to show "([^"]+)" as the active organization$/,
  function (this: UserFlowWorld, expectedOrgName: string) {
    // After cross-tenant rejection the app shell still shows Maya's own
    // org -- the scope_resolution_error flips state to access_denied but
    // context.org.name (her real tenant) remains.
    const projection = this.bag.scope_projection as {
      context: { org?: { name?: string } };
    };
    expect(projection.context?.org?.name).toBe(expectedOrgName);
  },
);

Then(
  /^the access-denied page names "([^"]+)" as the reason$/,
  function (this: UserFlowWorld, expectedReason: string) {
    const projection = this.bag.scope_projection as {
      context: { scope_resolution_error?: { reason?: string } | null };
    };
    expect(projection.context?.scope_resolution_error?.reason).toBe(
      expectedReason,
    );
  },
);

Then(
  "a scope-reconciled signal is observable by an accompanying test agent",
  async function (this: UserFlowWorld) {
    // Read the projection again (acting as the "accompanying test agent"
    // reading from the same SSOT) and assert scope_reconciled is true.
    const harness = this.harness;
    if (!harness) throw new Error("harness not initialized");
    await harness.assert_scope_reconciled();
  },
);

Then("Maya is not asked to pick the project again", function (
  this: UserFlowWorld,
) {
  // Negative invariant: after reconciliation the state is NOT a picker /
  // error state. The reducer kept us in `ready` with project_id populated.
  const projection = this.bag.scope_projection as {
    state: string;
    active_scope: { project_id: string | null };
  };
  expect(projection.state).toBe("ready");
  expect(projection.active_scope.project_id).toBeTruthy();
});

Then("no resource is shown as active in the chips", function (
  this: UserFlowWorld,
) {
  // I3 fallback: when resource_type was set without resource_id, the
  // resolver drops both. The projection's active_scope reflects this.
  const projection = this.bag.scope_projection as {
    active_scope: { resource_type: string | null; resource_id: string | null };
  };
  expect(projection.active_scope.resource_type).toBeNull();
  expect(projection.active_scope.resource_id).toBeNull();
});

Then(
  "Maya is not shown an error about a malformed link",
  function (this: UserFlowWorld) {
    // The boundary scenario: a partial resource pair degrades gracefully
    // rather than erroring. State stays in `ready`, no scope_resolution_error.
    const projection = this.bag.scope_projection as {
      state: string;
      context: { scope_resolution_error?: unknown };
    };
    expect(projection.state).not.toBe("access_denied");
    expect(projection.state).not.toBe("error_recoverable");
    expect(projection.state).not.toBe("error_terminal");
    expect(projection.context?.scope_resolution_error ?? null).toBeNull();
  },
);
