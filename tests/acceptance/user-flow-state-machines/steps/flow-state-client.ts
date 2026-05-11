// FlowStateClient — direct HTTP client for the flow-state tier surface,
// used by step methods that need to assert wire-level facts the harness
// abstracts (e.g. raw status codes, projection structure).
//
// All calls route through auth-proxy (CM-A). Tests never import from
// flow-state/lib/**.

import { request } from "undici";

import type { FlowProjection } from "../harness/types.ts";

export class FlowStateClient {
  constructor(
    private readonly authProxyUrl: string,
    private readonly machine = "login-and-org-setup",
  ) {}

  async health(): Promise<{ status: number; body: unknown }> {
    const res = await request(`${this.authProxyUrl}/flow-state/health`, {
      method: "GET",
    });
    const body = await res.body.json();
    return { status: res.statusCode, body };
  }

  async get_projection_raw(flowId: string): Promise<{
    status: number;
    body: unknown;
  }> {
    const res = await request(
      `${this.authProxyUrl}/flow-state/flow/${this.machine}/projection?flow_id=${encodeURIComponent(flowId)}`,
      { method: "GET" },
    );
    return { status: res.statusCode, body: await res.body.json() };
  }

  async get_projection(flowId: string): Promise<FlowProjection> {
    const { status, body } = await this.get_projection_raw(flowId);
    if (status !== 200) {
      throw new Error(`projection expected 200, got ${status}`);
    }
    return body as FlowProjection;
  }
}
