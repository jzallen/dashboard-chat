// UiStateClient — direct HTTP client for the ui-state `/state` surface,
// used by step methods that need to assert wire-level facts the harness
// abstracts (e.g. raw status codes, document structure).
//
// ADR-046 MR-6 — reads the single `GET /ui-state/state` document instead of
// the former per-machine `/ui-state/flow/<machine>/projection` mounts. Callers
// that want a specific region's `{state, context}` read it off
// `document.regions.<region>`; the single authoritative `active_scope` is
// top-level.
//
// All calls route through auth-proxy (CM-A). Tests never import from
// ui-state/lib/**.

import { request } from "undici";

import type { ChatAppStateDocument } from "../harness/types.ts";

export class UiStateClient {
  constructor(private readonly authProxyUrl: string) {}

  async health(): Promise<{ status: number; body: unknown }> {
    const res = await request(`${this.authProxyUrl}/ui-state/health`, {
      method: "GET",
    });
    const body = await res.body.json();
    return { status: res.statusCode, body };
  }

  async get_state_raw(): Promise<{ status: number; body: unknown }> {
    const res = await request(`${this.authProxyUrl}/ui-state/state`, {
      method: "GET",
    });
    return { status: res.statusCode, body: await res.body.json() };
  }

  async get_state(): Promise<ChatAppStateDocument> {
    const { status, body } = await this.get_state_raw();
    if (status !== 200) {
      throw new Error(`GET /ui-state/state expected 200, got ${status}`);
    }
    return body as ChatAppStateDocument;
  }
}
