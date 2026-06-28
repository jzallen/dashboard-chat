// onboarding-driver — the relocated client-driven onboarding flow POLICY
// (CDO-S5; ADR-050 §c/§e.4). A PURE module: a backend client port, a report sink
// (StateProxy.postEvent), and a logger are injected, so the whole status→cause
// matrix + the definitive-answers-only + probe-first-convergence rules are
// exercised with NO browser, NO React, NO network. The ui/ route surfaces
// (step 05-05) consume this driver; in-flight UI is the surface's local concern.
//
// WHY HERE (§e.4): the onboarding sequencing previously lived in the retired
// ui-state actors. No ui/ module owns flow sequencing — bootstrap is auth-only
// and the catalog owns resource write-through, not onboarding choreography. This
// is the documented-absence home for the flow policy.
//
// INV-PCO / earned-trust: report ONLY what the SSOT definitively said. A probe
// reports an outcome ONLY on a definitive HTTP answer (200/404); transport errors
// (5xx, network, timeout) are NOT reportable — the document stays awaiting the
// report and the surface re-probes. A 401 is the auth gate, never a report.
//
// AUDIT (ratification amendment 3): each POSTED outcome event + the resulting
// region state is logged via the injected createLogger('onboarding-driver').
// NEVER console.* directly.

import type {
  ChatAppStateDocument,
  ChatAppWireEvent,
} from "@dashboard-chat/ui-state-wire";

import { ApiError } from "../catalog/dataSources/backendClient";
import type { Logger } from "./log";

// ───────────────────────────── injected ports ─────────────────────────────

/**
 * The minimal backend client port the driver consumes. Mirrors the catalog
 * backendClient contract: a non-2xx HTTP response throws {@link ApiError}
 * (carrying `status` + parsed `body`); a 2xx returns the unwrapped JSON:API
 * payload; a network/timeout failure throws a plain (non-ApiError) Error. The
 * driver reads `ApiError.status` to map a DEFINITIVE answer to an outcome cause,
 * and treats any non-ApiError throw as a (non-reportable) transport error.
 */
export interface OnboardingClient {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

/** The report sink — the StateProxy.postEvent signature. */
export type ReportSink = (
  event: ChatAppWireEvent,
) => Promise<ChatAppStateDocument>;

export interface OnboardingDriverDeps {
  client: OnboardingClient;
  report: ReportSink;
  log: Logger;
}

/** The signal a method returns when a 401 short-circuits to the auth gate
 *  (no report posted). The surface routes the user to re-authenticate. */
export type AuthGate = { authGate: true };

const AUTH_GATE: AuthGate = { authGate: true };

/** The public surface the React surfaces (05-05) call: each method probes/POSTs,
 *  maps the outcome, posts the past-tense report, and logs the audit entry. */
export interface OnboardingDriver {
  /** Phase-B org probe (GET /api/orgs/me), definitive-answers-only. */
  probeOrg(): Promise<AuthGate | void>;
  /** Map an org-create POST result → org_created / org_create_failed. */
  reportOrgCreateResult(orgName: string): Promise<AuthGate | void>;
  /** Phase-D automatic default project (POST /api/projects "My First Project"). */
  createDefaultProject(): Promise<AuthGate | void>;
  /** Probe-first convergence retry (lost-201 dedup) for the default project. */
  retryProject(): Promise<AuthGate | void>;
  /** Initial-scope resolution (ported resolveInitialScopeFn). */
  resolveInitialScope(): Promise<AuthGate | void>;
}

// ───────────────────────────── constants ─────────────────────────────

const ORG_ME_PATH = "/api/orgs/me";
const ORGS_PATH = "/api/orgs";
const PROJECTS_PATH = "/api/projects";
const DEFAULT_PROJECT_NAME = "My First Project";

/** Which lifecycle region a posted event settles — used in the audit trail. */
const ONBOARDING_EVENTS = new Set([
  "org_found",
  "org_not_found",
  "org_created",
  "org_create_failed",
]);

type RegionName = "onboarding" | "projectContext";

function regionFor(eventType: string): RegionName {
  return ONBOARDING_EVENTS.has(eventType) ? "onboarding" : "projectContext";
}

// ───────────────────────────── snapshot extractors ─────────────────────────────

/** Read the {id,name} snapshot off an unwrapped JSON:API single. */
function toSnapshot(body: unknown): { id: string; name: string } {
  const record = (body ?? {}) as { id?: unknown; name?: unknown };
  return { id: String(record.id), name: String(record.name) };
}

/** The first resolvable {id,name} project in an unwrapped JSON:API list. */
function firstProject(
  body: unknown,
): { id: string; name: string } | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  return toSnapshot(body[0]);
}

// ───────────────────────────── the driver factory ─────────────────────────────

export function createOnboardingDriver(
  deps: OnboardingDriverDeps,
): OnboardingDriver {
  const { client, report, log } = deps;

  /** Post the outcome event, then log the audit entry: the posted event, the
   *  region it settles, AND the RESULTING region state read off the document
   *  report() returns (ratification amendment 3). */
  const postOutcome = async (event: ChatAppWireEvent): Promise<void> => {
    const doc = await report(event);
    const region = regionFor(event.type);
    log.info(`onboarding-driver.${event.type}.reported`, {
      event: event.type,
      region,
      region_state: doc.regions[region].state,
    });
  };

  /** True only for a definitive 401 — the auth gate (never a report). */
  const isAuthGate = (err: unknown): boolean =>
    err instanceof ApiError && err.status === 401;

  const probeOrg = async (): Promise<AuthGate | void> => {
    try {
      const body = await client.get(ORG_ME_PATH);
      await postOutcome({ type: "org_found", payload: { org: toSnapshot(body) } });
      return;
    } catch (err) {
      if (isAuthGate(err)) return AUTH_GATE;
      // Definitive 404 → org_not_found; any other status / network → NO report
      // (transport class: the document stays awaiting; the surface re-probes).
      if (err instanceof ApiError && err.status === 404) {
        await postOutcome({ type: "org_not_found", payload: {} });
        return;
      }
      return;
    }
  };

  const reportOrgCreateResult = async (
    orgName: string,
  ): Promise<AuthGate | void> => {
    try {
      const body = await client.post(ORGS_PATH, { name: orgName });
      await postOutcome({
        type: "org_created",
        payload: { org: toSnapshot(body) },
      });
      return;
    } catch (err) {
      if (isAuthGate(err)) return AUTH_GATE;
      await postOutcome(orgCreateFailure(err, orgName));
      return;
    }
  };

  const createDefaultProject = async (): Promise<AuthGate | void> => {
    try {
      const body = await client.post(PROJECTS_PATH, {
        name: DEFAULT_PROJECT_NAME,
      });
      await postOutcome({
        type: "project_created",
        payload: { project: toSnapshot(body) },
      });
      return;
    } catch (err) {
      if (isAuthGate(err)) return AUTH_GATE;
      await postOutcome({
        type: "project_create_failed",
        payload: { cause: "project_create_failed" },
      });
      return;
    }
  };

  const retryProject = async (): Promise<AuthGate | void> => {
    // PROBE-FIRST CONVERGENCE: re-probe before re-POSTing. A non-empty list means
    // a prior 201 was actually persisted (lost-201) — converge via scope_resolved
    // WITHOUT a duplicate POST. An empty list → re-POST.
    let existing: unknown;
    try {
      existing = await client.get(PROJECTS_PATH);
    } catch (err) {
      if (isAuthGate(err)) return AUTH_GATE;
      return;
    }
    const project = firstProject(existing);
    if (project) {
      await postOutcome({ type: "scope_resolved", payload: { project } });
      return;
    }
    return createDefaultProject();
  };

  const resolveInitialScope = async (): Promise<AuthGate | void> => {
    let body: unknown;
    try {
      body = await client.get(PROJECTS_PATH);
    } catch (err) {
      if (isAuthGate(err)) return AUTH_GATE;
      return;
    }
    const project = firstProject(body);
    if (project) {
      await postOutcome({ type: "scope_resolved", payload: { project } });
      return;
    }
    await postOutcome({ type: "no_projects_found", payload: {} });
    return;
  };

  return {
    probeOrg,
    reportOrgCreateResult,
    createDefaultProject,
    retryProject,
    resolveInitialScope,
  };
}

// ───────────────────────────── org-create status → cause ─────────────────────────────

/** Map an org-create POST failure to the closed-union org_create_failed event
 *  (ADR-050 §c): 409 → org_name_taken; 400|422 → org_name_invalid; any other
 *  status / network / timeout → org_create_failed. */
function orgCreateFailure(err: unknown, orgName: string): ChatAppWireEvent {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return {
        type: "org_create_failed",
        payload: { cause: "org_name_taken", org_name: orgName },
      };
    }
    if (err.status === 400 || err.status === 422) {
      return {
        type: "org_create_failed",
        payload: { cause: "org_name_invalid", org_name: orgName },
      };
    }
  }
  // The generic retry class (5xx ApiError / network / timeout) carries org_name
  // uniformly with the 409/400/422 arms — additive per the wire contract
  // (org_name?: string), for re-population/audit (D3).
  return {
    type: "org_create_failed",
    payload: { cause: "org_create_failed", org_name: orgName },
  };
}
