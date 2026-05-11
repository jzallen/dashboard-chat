// Cucumber World — shared state across step definitions for one scenario.
//
// This is the natural place to hold the harness, the fake WorkOS server,
// and per-scenario fixtures. Mirrors pytest-bdd's `target_fixture` pattern.

import { setWorldConstructor, World } from "@cucumber/cucumber";

import { UserFlowHarness } from "../harness/user-flow-harness.ts";
import { FakeWorkOS } from "./fake-workos.ts";
import { FlowStateClient } from "./flow-state-client.ts";
import { PERSONAS } from "./fixtures/personas.ts";

const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL ?? "http://localhost:1042";
const FAKE_WORKOS_PORT = parseInt(
  process.env.FAKE_WORKOS_PORT ?? "14299",
  10,
);

export class UserFlowWorld extends World {
  harness: UserFlowHarness | null = null;
  fakeWorkOS: FakeWorkOS | null = null;
  flowStateClient: FlowStateClient = new FlowStateClient(AUTH_PROXY_URL);
  currentPersona: keyof typeof PERSONAS | null = null;
  // Loose bag for per-scenario stash (correlation ids, fixture handles, etc.).
  bag: Record<string, unknown> = {};

  get_persona(name: string): (typeof PERSONAS)[keyof typeof PERSONAS] {
    const p = PERSONAS[name];
    if (!p) throw new Error(`Unknown persona: ${name}`);
    return p;
  }

  use_harness_for(personaName: string): UserFlowHarness {
    const persona = this.get_persona(personaName);
    this.currentPersona = personaName as keyof typeof PERSONAS;
    this.harness = new UserFlowHarness(
      {
        authProxyUrl: AUTH_PROXY_URL,
        fakeWorkOSUrl: `http://localhost:${FAKE_WORKOS_PORT}`,
      },
      persona,
    );
    return this.harness;
  }
}

setWorldConstructor(UserFlowWorld);
