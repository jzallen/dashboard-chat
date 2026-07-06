/**
 * Boundary guard — the browser reaches the backend ONLY through the same-origin
 * `/ui-server/*` gateway; it never calls the backend `/api` data plane directly.
 *
 * Two guards, one per acceptance criterion of "Retire backendClient and assert
 * the single boundary":
 *
 *   AC1 — source-graph scan: no browser-graph module imports the retired
 *         `backendClient` transport (`apiGet`/`apiPost`/`apiPatch`/`apiUpload`),
 *         and the catalog data-source tree performs no `credentials:"include"`
 *         browser fetch.
 *   AC2 — runtime guard: driving the browser onboarding + catalog + mutation +
 *         upload flows with a `fetch` spy issues ZERO requests to the backend
 *         `/api` — only `/ui-server/*` (and the storage presigned PUT) are
 *         allowed.
 *
 * IF YOU'RE AN AGENT, READ THIS: these are RED by design until the boundary is
 * retired (backendClient still exists and is imported today). This IS the spec —
 * make the code satisfy the guards; do NOT weaken the assertions to pass.
 *
 * Scope note: `auth/session.ts` (session refresh) and `lib/state-proxy.ts` (the
 * SSE state channel) legitimately keep their own same-origin cookie fetches and
 * are OUT of scope for this boundary — the credentials scan is deliberately
 * confined to the catalog data plane (`app/catalog/`), which is the surface the
 * retired transport lives on.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/** Absolute path to the `ui/app` source root, resolved from the working directory
 *  (vitest runs with cwd at `ui/`; the dispatcher may run from the repo root). A
 *  trailing separator lets callers slice it off a child path to get a relative
 *  module path. */
const APP_ROOT = ((): string => {
  for (const candidate of [join(process.cwd(), "app"), join(process.cwd(), "ui", "app")]) {
    if (existsSync(join(candidate, "root.tsx"))) return candidate + "/";
  }
  throw new Error("could not locate ui/app source root from cwd " + process.cwd());
})();

/** Recursively collect `.ts`/`.tsx` files under `dir`, skipping a caller-supplied
 *  set of path fragments (tests, server-only routes) that are not part of the
 *  browser module graph under audit. */
function collectSources(dir: string, skip: (relPath: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const rel = full.slice(APP_ROOT.length);
      if (statSync(full).isDirectory()) {
        if (!skip(rel + "/")) walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (skip(rel)) continue;
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Test/fixture files and the server-only resource routes are excluded from the
 *  browser-graph audit: the `/ui-server/*` routes run server-side and use the
 *  gateway broker (`apiFetch`), not the browser transport; test files are the
 *  spec, not shipped code. */
const isExcludedFromBrowserGraph = (rel: string): boolean =>
  /\.test\.(ts|tsx)$/.test(rel) ||
  rel.includes("__tests__/") ||
  rel.includes("__acceptance__/") ||
  rel.startsWith("routes/ui-server/");

describe("boundary — the browser never calls the backend /api directly", () => {
  it("AC1: no browser-graph module imports the retired backendClient transport, and the catalog data plane does no credentials:'include' fetch", () => {
    const browserModules = collectSources(APP_ROOT, isExcludedFromBrowserGraph);

    // (a) No import of the browser transport module, and no call to any of its
    //     four symbols. Comment prose that merely names `apiGet` is ignored — we
    //     match the CALL form (`apiGet(` / `apiGet<`) and imports from a
    //     `backendClient` module path, never a bare mention.
    const importsBackendClient = /from\s+["'][^"']*backendClient["']/;
    const callsTransport = /\bapi(Get|Post|Patch|Upload)\s*[<(]/;
    const transportViolations = browserModules.filter((file) => {
      const src = readFileSync(file, "utf8");
      return importsBackendClient.test(src) || callsTransport.test(src);
    });

    // (b) The catalog data-source tree must contain no browser `credentials:
    //     "include"` fetch — that is the retired backendClient's signature. The
    //     app's other cookie channels (auth refresh, SSE) live outside `catalog/`.
    const catalogModules = collectSources(
      join(APP_ROOT, "catalog"),
      isExcludedFromBrowserGraph,
    );
    const credentialsViolations = catalogModules.filter((file) =>
      /credentials\s*:\s*["']include["']/.test(readFileSync(file, "utf8")),
    );

    const rel = (f: string): string => f.slice(APP_ROOT.length);
    expect(
      {
        importsOrCallsTransport: transportViolations.map(rel),
        catalogCredentialsInclude: credentialsViolations.map(rel),
      },
      "browser graph still reaches the backend /api through the retired backendClient transport",
    ).toEqual({ importsOrCallsTransport: [], catalogCredentialsInclude: [] });
  });

  describe("AC2: runtime fetch spy over the onboarding + catalog + mutation + upload flows", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("issues zero requests to the backend /api — only /ui-server/* (and the storage PUT) are reached", async () => {
      const urls: string[] = [];
      const spy = vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        urls.push(url);
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      globalThis.fetch = spy as unknown as typeof fetch;

      // Drive the real browser flows through their production modules. The
      // metadataApiSource port covers the one-step upload; the model rename now
      // lands through the RRv7 `/ui-server/datasets/:id` action (submitted as a
      // `gatewayPatch` from the browser, mirroring the ModelDetail fetcher); the
      // onboarding driver bound to the app-shell default client (onboardingClient,
      // which rewrites /api → /ui-server) covers the Phase-B org probe. The catalog
      // reads are seeded server-side by the loaders, so no browser read remains to
      // spy on here.
      const { metadataApiSource } = await import(
        "../../catalog/dataSources/metadataApiSource"
      );
      const { gatewayPatch } = await import("../../lib/gateway-client");
      const { createOnboardingDriver } = await import(
        "../../lib/onboarding-driver"
      );
      const { onboardingClient } = await import("../../lib/onboarding-client");
      const { createLogger } = await import("../../lib/log");

      const source = metadataApiSource({
        getToken: () => null,
        getProjectId: () => "p1",
      });

      // app-shell's default onboarding client is the onboardingClient — it takes
      // the driver's backend-shaped `/api/*` path constants and rewrites them onto
      // the same-origin `/ui-server/*` gateway, so the probe never hits `/api`.
      const driver = createOnboardingDriver({
        client: onboardingClient,
        report: (async () => ({
          regions: {
            onboarding: { state: "awaiting_org_report" },
            projectContext: { state: "verifying" },
          },
        })) as unknown as Parameters<typeof createOnboardingDriver>[0]["report"],
        log: createLogger("boundary-guard"),
      });

      // The upload port is optional on PartialCatalogSource but present on
      // metadataApiSource; optional-call keeps the types honest without asserting.
      await Promise.allSettled([
        // mutation: the browser rename submits a PATCH to the /ui-server action,
        // which forwards to /api/datasets/:id server-side — never browser-direct.
        gatewayPatch("/ui-server/datasets/d1", { display_name: "Renamed" }),
        source.createDataset?.(new File(["a,b\n1,2"], "x.csv")), // upload
        driver.probeOrg(), // onboarding
      ]);

      const backendHits = urls.filter((u) =>
        new URL(u, "http://localhost").pathname.startsWith("/api/"),
      );
      expect(
        backendHits,
        "browser flows still hit the backend /api directly instead of the /ui-server gateway",
      ).toEqual([]);

      // Every reached URL is either a same-origin /ui-server/* gateway route or
      // the presigned storage PUT — the spec's allow-list, no third channel.
      const offBoundary = urls.filter((u) => {
        const { pathname } = new URL(u, "http://localhost");
        const isGateway = pathname.startsWith("/ui-server/");
        const isStoragePut = /^https?:\/\//.test(u) && !isGateway;
        return !isGateway && !isStoragePut;
      });
      expect(
        offBoundary,
        "a browser flow reached a URL outside the /ui-server gateway + storage-PUT allow-list",
      ).toEqual([]);
    });
  });
});
