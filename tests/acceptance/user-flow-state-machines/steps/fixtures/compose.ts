// Compose orchestration helpers.
//
// In Strategy C (DWD-2) every local adapter is real; the suite stands up
// 7 services via docker compose before scenarios run. The fake WorkOS Hono
// server runs in-process (it's not a compose service) so the suite controls
// its profile fixtures per scenario.

import { exec } from "node:child_process";
import { promisify } from "node:util";

const exec_async = promisify(exec);

const COMPOSE_FILE = "../../../docker-compose.yml";
const PROFILE = "flow-state"; // future compose profile that brings up the 7-service stack

export async function compose_up(): Promise<void> {
  await exec_async(
    `docker compose -f ${COMPOSE_FILE} --profile ${PROFILE} up -d`,
    { cwd: __dirname },
  );
}

export async function compose_down(): Promise<void> {
  await exec_async(
    `docker compose -f ${COMPOSE_FILE} --profile ${PROFILE} down -v`,
    { cwd: __dirname },
  );
}

export async function compose_restart(service: string): Promise<void> {
  await exec_async(
    `docker compose -f ${COMPOSE_FILE} --profile ${PROFILE} restart ${service}`,
    { cwd: __dirname },
  );
}

export async function wait_for_health(
  url: string,
  timeout_ms = 30_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout_ms) {
    try {
      const { request } = await import("undici");
      const res = await request(url, { method: "GET" });
      if (res.statusCode < 500) return;
    } catch {
      // continue polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`health check timed out for ${url}`);
}
