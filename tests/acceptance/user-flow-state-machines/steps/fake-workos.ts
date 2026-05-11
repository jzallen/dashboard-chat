// Fake WorkOS — in-process Hono server that speaks enough of the OIDC token-
// exchange + user-profile shape to drive the flow-state tier through the
// `authenticating` transition.
//
// Strategy C (DWD-2) treats every adapter except WorkOS as REAL. WorkOS is
// the fake because (a) we own no CI credentials, (b) testing against real
// WorkOS would couple the suite to external infra. The fake is a real HTTP
// server (loopback) so the flow-state tier exercises its real WorkOSClient
// adapter wiring; the network call is real, only the upstream identity is
// fake.

import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";

export interface FakeWorkOSConfig {
  port: number;
}

export interface FakeWorkOSProfileFixture {
  email: string | null;
  display_name: string | null;
  cause?: "missing_email" | "slow_response_ms" | "callback_500";
  slow_response_ms?: number;
}

export class FakeWorkOS {
  private server: ServerType | null = null;
  private profileFixtures = new Map<string, FakeWorkOSProfileFixture>();

  constructor(private readonly config: FakeWorkOSConfig) {}

  async start(): Promise<void> {
    const app = new Hono();

    app.get("/.well-known/openid-configuration", (c) =>
      c.json({
        issuer: `http://localhost:${this.config.port}`,
        authorization_endpoint: `http://localhost:${this.config.port}/oauth/authorize`,
        token_endpoint: `http://localhost:${this.config.port}/oauth/token`,
        userinfo_endpoint: `http://localhost:${this.config.port}/oauth/userinfo`,
      }),
    );

    app.post("/oauth/token", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        code?: string;
      };
      const fixture = body.code ? this.profileFixtures.get(body.code) : null;
      if (fixture?.cause === "callback_500") {
        return c.json({ error: "server_error" }, 500);
      }
      if (fixture?.cause === "slow_response_ms" && fixture.slow_response_ms) {
        await new Promise((r) => setTimeout(r, fixture.slow_response_ms));
      }
      return c.json({
        access_token: `fake.workos.token.${body.code ?? "anon"}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    });

    app.get("/oauth/userinfo", (c) => {
      const code = c.req.header("x-fake-workos-code") ?? "default";
      const fixture = this.profileFixtures.get(code);
      // Honor explicit corruption causes BEFORE applying defaults. A
      // null/missing email in the fixture means the upstream really did
      // omit the field.
      const sub = `workos|${fixture?.email ?? code}`;
      const profile: Record<string, unknown> = { sub };
      if (fixture?.cause === "missing_email") {
        // Explicit corruption: emit a profile with no email key.
        if (fixture.display_name) profile.name = fixture.display_name;
        return c.json(profile);
      }
      const email = fixture?.email ?? "default-user@example.com";
      const name = fixture?.display_name ?? "Default User";
      if (email !== null) profile.email = email;
      if (name !== null) profile.name = name;
      return c.json(profile);
    });

    await new Promise<void>((resolve) => {
      this.server = serve(
        { fetch: app.fetch, port: this.config.port },
        () => resolve(),
      );
    });
  }

  set_profile_for(code: string, fixture: FakeWorkOSProfileFixture): void {
    this.profileFixtures.set(code, fixture);
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) =>
        this.server!.close(() => resolve()),
      );
      this.server = null;
    }
  }
}
