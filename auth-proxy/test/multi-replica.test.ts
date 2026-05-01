/**
 * Multi-replica acceptance test for auth-proxy keypair sharing.
 *
 * The contract this test pins down:
 *
 *   docker compose up -d --scale auth-proxy=2
 *
 * brings up two auth-proxy replicas that share signing key material —
 * a token minted by replica A verifies at replica B and vice-versa.
 * Without shared persistence, replica A and B generate independent
 * keypairs at boot and the signature verification at the wrong
 * replica returns 401.
 *
 * The test orchestrates docker compose from outside the container —
 * Strategy C in the same family as
 * `tests/acceptance/log-image-identity-on-startup`. It uses an
 * isolated `COMPOSE_PROJECT_NAME` so it can run alongside other
 * compose stacks (e.g. concurrent polecat worktrees) without
 * stepping on container names or volumes.
 *
 * Replicas are reached via `docker compose port` — auth-proxy now
 * publishes an ephemeral host port per replica (the fixed `3000:3000`
 * host mapping was dropped to support `--scale`). The slim runtime
 * image carries no http client, so we hit each replica from the host.
 *
 * Skipped automatically when:
 *   - `docker` CLI is not on PATH
 *   - the bazel-built `dashboard-chat/auth-proxy:bazel` image is not
 *     loaded in the local docker daemon
 *   - `SKIP_DOCKER_ACCEPTANCE=1` is set (CI escape hatch)
 *
 * The unit tests in `lib/secrets.test.ts` cover the provider
 * abstraction directly; this test is the production-fidelity gate
 * that the wiring from env → provider → keypair → multi-replica
 * really holds end-to-end.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PROJECT = `auth-proxy-mr-${process.pid}`;
const SERVICE = "auth-proxy";
const IMAGE = "dashboard-chat/auth-proxy:bazel";

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[]): RunResult {
  const proc = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: PROJECT,
    },
  });
  return {
    status: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

function dockerAvailable(): boolean {
  if (process.env.SKIP_DOCKER_ACCEPTANCE === "1") return false;
  const v = spawnSync("docker", ["version", "--format", "{{.Client.Version}}"], {
    encoding: "utf8",
  });
  return v.status === 0;
}

function imageLoaded(): boolean {
  const r = spawnSync("docker", ["image", "inspect", IMAGE], { encoding: "utf8" });
  return r.status === 0;
}

function composeFilePresent(): boolean {
  return existsSync(join(REPO_ROOT, "docker-compose.yml"));
}

const SKIP = !dockerAvailable() || !imageLoaded() || !composeFilePresent();
const SKIP_REASON = SKIP
  ? !dockerAvailable()
    ? "docker not available (or SKIP_DOCKER_ACCEPTANCE=1)"
    : !imageLoaded()
      ? `image ${IMAGE} not loaded — run 'bazel run //auth-proxy:image_load' first`
      : `docker-compose.yml not present at ${REPO_ROOT} — running outside the worktree (e.g. bazel sandbox)`
  : "";

describe.skipIf(SKIP)(
  `multi-replica auth-proxy keypair sharing [${SKIP_REASON || "live"}]`,
  () => {
    let replica1: string;
    let replica2: string;

    beforeAll(async () => {
      // Ensure a clean slate — a previous failed run could have left
      // a stack with the same project name behind.
      run("docker", ["compose", "down", "-v", "--remove-orphans"]);

      // Scale auth-proxy to 2; --no-deps skips bringing up the
      // full stack (api, query-engine, etc.) since the keypair-sharing
      // contract is local to auth-proxy. We only need both replicas
      // online and able to mint+verify each other's tokens.
      const up = run("docker", [
        "compose",
        "up",
        "-d",
        "--no-deps",
        "--scale",
        `${SERVICE}=2`,
        SERVICE,
      ]);
      if (up.status !== 0) {
        throw new Error(
          `docker compose up failed (exit ${up.status}):\n${up.stderr}\n${up.stdout}`,
        );
      }
      replica1 = replicaUrl(1);
      replica2 = replicaUrl(2);
      await waitForHealthy([replica1, replica2]);
    }, 120_000);

    afterAll(() => {
      run("docker", ["compose", "down", "-v", "--remove-orphans"]);
    }, 60_000);

    it("token minted at replica 1 verifies at replica 2", async () => {
      const token = await mintM2mToken(replica1);
      expect(token).toMatch(/^ey[A-Za-z0-9_.-]+$/);

      const status = await verify(replica2, token);
      // 401 specifically means the proxy rejected the signature — the
      // negative case the multi-replica feature exists to fix. A 5xx
      // (proxy fetch failure to the missing api backend) means verify
      // succeeded and the request reached the proxy step. Anything
      // non-401 proves the keypair is shared.
      expect(status).not.toBe(401);
    }, 60_000);

    it("token minted at replica 2 verifies at replica 1 (symmetric)", async () => {
      const token = await mintM2mToken(replica2);
      expect(token).toMatch(/^ey[A-Za-z0-9_.-]+$/);

      const status = await verify(replica1, token);
      expect(status).not.toBe(401);
    }, 60_000);
  },
);

/**
 * Resolve `http://localhost:<host-port>` for the replica at the given
 * compose `--index`. The host port is allocated at `up` time when
 * compose translates the unmapped `3000` port spec into a free host
 * port; we read it back via `docker compose port`.
 */
function replicaUrl(index: 1 | 2): string {
  const r = run("docker", [
    "compose",
    "port",
    "--index",
    String(index),
    SERVICE,
    "3000",
  ]);
  if (r.status !== 0 || !r.stdout.trim()) {
    throw new Error(
      `docker compose port replica ${index} failed (exit ${r.status}):\n` +
        `stderr=${r.stderr}\nstdout=${r.stdout}`,
    );
  }
  // Output is `0.0.0.0:NNNNN` (or `[::]:NNNNN`); take the trailing
  // port. We always dial 127.0.0.1 — `localhost` may resolve to ::1
  // first, and docker's published port is IPv4-only, so `localhost`
  // produces `connect ECONNREFUSED ::1:NNNN` under undici.
  const match = r.stdout.trim().match(/:(\d+)\s*$/);
  if (!match) {
    throw new Error(`unexpected port output: ${r.stdout.trim()}`);
  }
  return `http://127.0.0.1:${match[1]}`;
}

async function mintM2mToken(baseUrl: string): Promise<string> {
  const body =
    "grant_type=client_credentials" +
    "&client_id=dev-m2m-client" +
    "&client_secret=dev-m2m-secret";

  const res = await fetch(`${baseUrl}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`mint at ${baseUrl} failed: ${res.status} ${await res.text()}`);
  }
  const parsed = (await res.json()) as { access_token?: string };
  if (!parsed.access_token) {
    throw new Error(`response missing access_token from ${baseUrl}`);
  }
  return parsed.access_token;
}

/**
 * Hit the proxy path at `baseUrl` with `token` as Bearer and return
 * the HTTP status. The proxy will attempt to forward the request to
 * the api backend (which we have not started); 401 cleanly distinguishes
 * "signature rejected" (the failure mode we care about) from any other
 * outcome.
 */
async function verify(baseUrl: string, token: string): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealthy(urls: string[]): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastErr = "";
  while (Date.now() < deadline) {
    const results = await Promise.all(urls.map((u) => probe(u)));
    if (results.every((ok) => ok)) return;
    await sleep(500);
  }
  throw new Error(`auth-proxy replicas never became healthy: ${lastErr}`);

  // Per-attempt fetch must time out — otherwise undici holds the
  // connection open against the not-yet-listening port for the full
  // socket timeout and we never reach the next iteration.
  async function probe(u: string): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2_000);
    try {
      const res = await fetch(`${u}/health`, { signal: ctrl.signal });
      return res.ok;
    } catch (e) {
      lastErr = `${u}: ${(e as Error).message}`;
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
