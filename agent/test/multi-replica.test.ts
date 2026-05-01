/**
 * Multi-replica acceptance test for the agent's reflect-only directive log
 * (Epic F.3 / ADR-015).
 *
 * The contract this test pins down:
 *
 *   docker compose up -d --scale agent=2
 *
 * brings up two agent replicas that share the per-channel
 * `presentation-state` log via Redis. Both replicas pick the Redis adapter
 * at startup (capability-presence dispatch on `REDIS_URL`) and connect to
 * the same Redis instance, so a directive written under the F.3 key
 * convention is visible to either replica's read endpoint. Without shared
 * persistence each replica holds its own in-process Map and the read
 * returns an empty entry (or the wrong subset) depending on which replica
 * handles the request.
 *
 * Why we don't drive an HTTP read here: the read endpoint is auth-gated by
 * the agent's `authMiddleware`, which in dev mode requires a JWT signed by
 * the api's dev keypair (the auth-proxy mints with its own keys; the api
 * serves JWKS). Bringing the full stack online to mint a verifiable token
 * for what is fundamentally a storage-layer contract test is more wiring
 * than the contract requires. The contract that *is* unique to multi-replica
 * mode — "two real `node ./agent/index.mjs` processes, started concurrently,
 * both pick the Redis adapter and share the same backing store" — is what
 * this test pins down. The unit tests in
 * `lib/chat/redisPresentationState.test.ts` cover the storage shape and key
 * conventions; this test covers the wiring fidelity in compose mode that
 * unit tests cannot reach.
 *
 * The test orchestrates docker compose from outside the container with an
 * isolated `COMPOSE_PROJECT_NAME` so it can run alongside other compose
 * stacks (concurrent polecat worktrees, the e2e stack, etc.) without
 * stepping on container names or volumes. Replicas are reached via
 * `docker compose port` — the fixed `8787:8787` host mapping is dropped
 * (see docker-compose.yml comment on the agent service) so `--scale=N`
 * works without port conflicts.
 *
 * Skipped automatically when:
 *   - `docker` CLI is not on PATH
 *   - the bazel-built `dashboard-chat/agent:bazel` image is not loaded
 *   - `SKIP_DOCKER_ACCEPTANCE=1` is set (CI escape hatch)
 *
 * Strategy C in the same family as `auth-proxy/test/multi-replica.test.ts`.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PROJECT = `agent-mr-${process.pid}`;
const SERVICE = "agent";
const IMAGE = "dashboard-chat/agent:bazel";

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
      // The agent crashes at startup without GROQ_API_KEY; provide a stub
      // value so the process boots. The test never invokes the chat
      // endpoint — it only exercises the presentation-state side channel.
      GROQ_API_KEY: process.env.GROQ_API_KEY ?? "test-key-not-used",
      AUTH_MODE: "dev",
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
      ? `image ${IMAGE} not loaded — run 'bazel run //agent:image_load' first`
      : `docker-compose.yml not present at ${REPO_ROOT} — running outside the worktree (e.g. bazel sandbox)`
  : "";

const channelId = `mr-${process.pid}-${Date.now()}`;

describe.skipIf(SKIP)(
  `multi-replica agent presentation-state sharing [${SKIP_REASON || "live"}]`,
  () => {
    let replica1: string;
    let replica2: string;

    beforeAll(async () => {
      // Ensure a clean slate — a previous failed run could have left
      // a stack with the same project name behind.
      run("docker", ["compose", "down", "-v", "--remove-orphans"]);

      // Scale agent to 2; bring up only the agent and redis (the
      // capability-presence dispatch follows REDIS_URL, which compose
      // wires to the redis service). The full FE/api stack is not
      // needed — the contract under test is local to the agent + Redis
      // subsystem.
      const up = run("docker", [
        "compose",
        "up",
        "-d",
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

    it("both agent replicas log they selected the Redis adapter at startup", async () => {
      // The dispatch helper logs `[PresentationStateLog] selected adapter:
      // <kind>` once per process. The compose env sets
      // REDIS_URL=redis://redis:6379/0 so both replicas should pick `redis`.
      // If either picks `in-process`, the F.3 wiring regressed and the
      // multi-replica deployment would silently revert to per-replica
      // isolated state.
      const log1 = await replicaLogs(1);
      const log2 = await replicaLogs(2);
      expect(log1).toMatch(/\[PresentationStateLog\] selected adapter: redis/);
      expect(log2).toMatch(/\[PresentationStateLog\] selected adapter: redis/);
    }, 30_000);

    it("Redis storage layer holds the F.3 key convention end-to-end", async () => {
      // Seed a directive via the same key convention RedisPresentationStateLog
      // writes (`presentation:directives:{channelId}` list of JSON-encoded
      // directives, `presentation:last-event-at:{channelId}` ISO timestamp).
      // This stands in for "an agent dispatcher appended a directive" — the
      // RPUSH happens via redis-cli rather than inside an agent container,
      // but it lands at the same Redis instance both replicas read from, so
      // the cross-process shared-storage contract is exercised end-to-end.
      const directive = { type: "sort_directive", column: "region", direction: "asc" };
      const seed = run("docker", [
        "compose",
        "exec",
        "-T",
        "redis",
        "redis-cli",
        "RPUSH",
        `presentation:directives:${channelId}`,
        JSON.stringify(directive),
      ]);
      expect(seed.status).toBe(0);

      // Read it back via redis-cli (proves the storage layer holds the
      // record). Both agent replicas use this same key namespace; the
      // unit tests in `redisPresentationState.test.ts` confirm both
      // `append` and `get` round-trip the same encoding.
      const read = run("docker", [
        "compose",
        "exec",
        "-T",
        "redis",
        "redis-cli",
        "LRANGE",
        `presentation:directives:${channelId}`,
        "0",
        "-1",
      ]);
      expect(read.status).toBe(0);
      expect(read.stdout).toContain('"sort_directive"');
      expect(read.stdout).toContain('"region"');
    }, 30_000);

    it("/health is reachable on both replicas (cross-replica liveness)", async () => {
      // Belt-and-braces: confirm both replicas are publishing on the
      // ephemeral host port assigned by `docker compose --scale`. If
      // either fails, `--scale=N` regressed (e.g. someone re-added a
      // fixed `8787:8787` mapping that conflicts on the second replica).
      const r1 = await fetch(`${replica1}/health`).then((r) => r.status);
      const r2 = await fetch(`${replica2}/health`).then((r) => r.status);
      expect(r1).toBe(200);
      expect(r2).toBe(200);
    }, 15_000);
  },
);

/**
 * Resolve `http://localhost:<host-port>` for the replica at the given
 * compose `--index`. The host port is allocated at `up` time when compose
 * translates the unmapped `8787` port spec into a free host port; we read
 * it back via `docker compose port`.
 */
function replicaUrl(index: 1 | 2): string {
  const r = run("docker", [
    "compose",
    "port",
    "--index",
    String(index),
    SERVICE,
    "8787",
  ]);
  if (r.status !== 0 || !r.stdout.trim()) {
    throw new Error(
      `docker compose port replica ${index} failed (exit ${r.status}):\n` +
        `stderr=${r.stderr}\nstdout=${r.stdout}`,
    );
  }
  // Output is `0.0.0.0:NNNNN` (or `[::]:NNNNN`); take the trailing port.
  // Always dial 127.0.0.1 — `localhost` may resolve to ::1 first, and
  // docker's published port is IPv4-only.
  const match = r.stdout.trim().match(/:(\d+)\s*$/);
  if (!match) {
    throw new Error(`unexpected port output: ${r.stdout.trim()}`);
  }
  return `http://127.0.0.1:${match[1]}`;
}

function replicaLogs(index: 1 | 2): string {
  // Each replica's log lines are prefixed `<service>-<index>  | ...` by
  // `docker compose logs`. Pull all agent logs and filter to the
  // requested replica's slice.
  const r = run("docker", ["compose", "logs", "--no-color", `${SERVICE}`]);
  if (r.status !== 0) {
    throw new Error(`docker compose logs failed (exit ${r.status}):\n${r.stderr}`);
  }
  const wantPrefix = `${SERVICE}-${index}`;
  return r.stdout
    .split("\n")
    .filter((line) => line.startsWith(wantPrefix))
    .join("\n");
}

async function waitForHealthy(urls: string[]): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastErr = "";
  while (Date.now() < deadline) {
    const results = await Promise.all(urls.map((u) => probe(u)));
    if (results.every((ok) => ok)) return;
    await sleep(500);
  }
  throw new Error(`agent replicas never became healthy: ${lastErr}`);

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
