/**
 * Groq fixture-replay harness (TWD-2 / UI-2 resolution).
 *
 * Two modes:
 *   - record: pass-through to real Groq, capture response bytes to disk.
 *   - replay: intercept fetch and serve recorded bytes; fail fast if missing.
 *
 * Fixtures live at agent/test/chat/fixtures/<family>/<scenario>.json.
 * The "production-fidelity" principle (DESIGN §8) is preserved: replayed bytes
 * are real Groq output captured during walking-skeleton runs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type GroqFamily = "cleaning" | "mutations" | "ui";

export type GroqFixture = {
  family: GroqFamily;
  scenario: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

type FetchLike = typeof fetch;

const FIXTURES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const GROQ_HOST = "api.groq.com";

function fixturePath(family: GroqFamily, scenario: string): string {
  return resolve(FIXTURES_ROOT, family, `${scenario}.json`);
}

function isGroqRequest(input: RequestInfo | URL): boolean {
  if (typeof input === "string") return input.includes(GROQ_HOST);
  if (input instanceof URL) return input.host.includes(GROQ_HOST);
  if (input instanceof Request) return new URL(input.url).host.includes(GROQ_HOST);
  return false;
}

export type ReplayHarness = {
  install: () => void;
  uninstall: () => void;
};

/**
 * Install a fetch interceptor that captures the next Groq response to disk.
 * Returns a harness with install/uninstall; tests call install() before the
 * Groq-driven action and uninstall() after to flush the fixture.
 */
export function recordGroqFixture(family: GroqFamily, scenario: string): ReplayHarness {
  const original = globalThis.fetch;

  const wrapped: FetchLike = async (input, init) => {
    const res = await original(input as Parameters<FetchLike>[0], init);
    if (!isGroqRequest(input as RequestInfo | URL)) return res;

    const cloned = res.clone();
    const body = await cloned.text();
    const headers: Record<string, string> = {};
    cloned.headers.forEach((v, k) => {
      headers[k] = v;
    });

    const path = fixturePath(family, scenario);
    mkdirSync(dirname(path), { recursive: true });
    const fixture: GroqFixture = {
      family,
      scenario,
      status: cloned.status,
      headers,
      body,
    };
    writeFileSync(path, JSON.stringify(fixture, null, 2));
    return res;
  };

  return {
    install() {
      globalThis.fetch = wrapped;
    },
    uninstall() {
      globalThis.fetch = original;
    },
  };
}

/**
 * Install a fetch interceptor that serves a previously-recorded fixture for
 * any Groq request. Throws if the fixture is missing — tests must record
 * before they replay.
 */
export function replayGroqFixture(family: GroqFamily, scenario: string): ReplayHarness {
  const path = fixturePath(family, scenario);
  if (!existsSync(path)) {
    throw new Error(
      `Groq fixture missing: ${path}. Run the walking skeleton with RECORD=1 to capture it.`,
    );
  }
  const fixture = JSON.parse(readFileSync(path, "utf8")) as GroqFixture;
  const original = globalThis.fetch;

  const wrapped: FetchLike = async (input, init) => {
    if (!isGroqRequest(input as RequestInfo | URL)) {
      return original(input as Parameters<FetchLike>[0], init);
    }
    return new Response(fixture.body, {
      status: fixture.status,
      headers: fixture.headers,
    });
  };

  return {
    install() {
      globalThis.fetch = wrapped;
    },
    uninstall() {
      globalThis.fetch = original;
    },
  };
}
