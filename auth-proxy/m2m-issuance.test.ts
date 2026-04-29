/**
 * Integration tests for the M2M token-issuance endpoint.
 *
 * Unlike index.test.ts (which mocks `jose` to test the JWKS-verification
 * path against a non-existent backend), this suite exercises the issuance
 * path with real cryptographic signing and verification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "./app.ts";
import { _resetForTests } from "./lib/m2m.ts";

const ORIG_ENV = { ...process.env };

const VALID_CLIENTS = JSON.stringify({
  "svc-a": {
    secret: "shh-shh-shh",
    sub: "service-account:svc-a",
    org_id: "org-a",
    email: "svc-a@example.com",
  },
});

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith("M2M_") ||
      key === "AUTH_MODE" ||
      key === "BACKEND_URL" ||
      key === "JWKS_URL" ||
      key === "WORKOS_CLIENT_ID"
    ) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (
      k.startsWith("M2M_") ||
      k === "AUTH_MODE" ||
      k === "BACKEND_URL" ||
      k === "JWKS_URL" ||
      k === "WORKOS_CLIENT_ID"
    ) {
      if (v !== undefined) process.env[k] = v;
    }
  }
}

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  resetEnv();
  _resetForTests();
  vi.clearAllMocks();
  process.env.AUTH_MODE = "dev";
  process.env.M2M_CLIENTS = VALID_CLIENTS;
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(() => {
  resetEnv();
  _resetForTests();
});

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}
interface ErrorResponse {
  error: string;
  error_description?: string;
}

async function tokenRequest(
  body: unknown,
  asJson = true,
): Promise<Response> {
  const init: RequestInit = asJson
    ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    : {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body as Record<string, string>).toString(),
      };
  return Promise.resolve(
    app.fetch(new Request("http://localhost/api/auth/token", init)),
  );
}

describe("M2M issuance endpoint — flag off", () => {
  it("returns 404 when M2M_ENABLED is unset", async () => {
    delete process.env.M2M_ENABLED;
    const res = await tokenRequest({
      grant_type: "client_credentials",
      client_id: "svc-a",
      client_secret: "shh-shh-shh",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorResponse & Partial<TokenResponse>;
    expect(body.error).toBe("not_found");
  });

  it("returns 404 even with valid credentials when flag is off", async () => {
    process.env.M2M_ENABLED = "false";
    const res = await tokenRequest({
      grant_type: "client_credentials",
      client_id: "svc-a",
      client_secret: "shh-shh-shh",
    });
    expect(res.status).toBe(404);
  });
});

describe("M2M issuance endpoint — flag on", () => {
  beforeEach(() => {
    process.env.M2M_ENABLED = "true";
  });

  it("returns 200 + access_token for valid credentials (JSON body)", async () => {
    const res = await tokenRequest({
      grant_type: "client_credentials",
      client_id: "svc-a",
      client_secret: "shh-shh-shh",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TokenResponse;
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.split(".")).toHaveLength(3);
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBeGreaterThan(0);
  });

  it("returns 200 + access_token for form-encoded body (OAuth2 default)", async () => {
    const res = await tokenRequest(
      {
        grant_type: "client_credentials",
        client_id: "svc-a",
        client_secret: "shh-shh-shh",
      },
      false,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TokenResponse;
    expect(typeof body.access_token).toBe("string");
  });

  it("returns 401 invalid_client for unknown client_id", async () => {
    const res = await tokenRequest({
      grant_type: "client_credentials",
      client_id: "ghost",
      client_secret: "shh-shh-shh",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse & Partial<TokenResponse>;
    expect(body.error).toBe("invalid_client");
  });

  it("returns 401 invalid_client for wrong client_secret", async () => {
    const res = await tokenRequest({
      grant_type: "client_credentials",
      client_id: "svc-a",
      client_secret: "wrong",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse & Partial<TokenResponse>;
    expect(body.error).toBe("invalid_client");
  });

  it("returns 400 unsupported_grant_type for non-client-credentials grants", async () => {
    const res = await tokenRequest({
      grant_type: "password",
      client_id: "svc-a",
      client_secret: "shh-shh-shh",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse & Partial<TokenResponse>;
    expect(body.error).toBe("unsupported_grant_type");
  });

  it("returns 400 invalid_request for missing client_id", async () => {
    const res = await tokenRequest({
      grant_type: "client_credentials",
      client_secret: "shh-shh-shh",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse & Partial<TokenResponse>;
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 invalid_request for missing client_secret", async () => {
    const res = await tokenRequest({
      grant_type: "client_credentials",
      client_id: "svc-a",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse & Partial<TokenResponse>;
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 invalid_request for malformed body", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not valid json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("M2M token round-trip — issuance verifies through proxy auth path", () => {
  beforeEach(() => {
    process.env.M2M_ENABLED = "true";
  });

  it("issued token is accepted as Bearer and forwarded with identity headers", async () => {
    // Step 1: mint a token.
    const issueRes = await tokenRequest({
      grant_type: "client_credentials",
      client_id: "svc-a",
      client_secret: "shh-shh-shh",
    });
    expect(issueRes.status).toBe(200);
    const { access_token } = (await issueRes.json()) as TokenResponse;

    // Step 2: send the token as Bearer to a protected endpoint.
    const protectedRes = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
    );
    expect(protectedRes.status).toBe(200);

    // Step 3: assert the identity headers were forwarded to the backend.
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, fetchOptions] = mockFetch.mock.calls[0];
    const headers = fetchOptions.headers as Headers;
    expect(headers.get("X-User-Id")).toBe("service-account:svc-a");
    expect(headers.get("X-Org-Id")).toBe("org-a");
    expect(headers.get("X-User-Email")).toBe("svc-a@example.com");
    // And client-supplied identity headers are still stripped.
    expect(headers.get("Authorization")).toBe(`Bearer ${access_token}`);
  });

  it("rejects a tampered token at the protected endpoint with 401", async () => {
    const issueRes = await tokenRequest({
      grant_type: "client_credentials",
      client_id: "svc-a",
      client_secret: "shh-shh-shh",
    });
    const { access_token } = (await issueRes.json()) as TokenResponse;

    // Flip a byte in the signature segment.
    const parts = access_token.split(".");
    const sig = parts[2];
    const tampered =
      parts[0] +
      "." +
      parts[1] +
      "." +
      (sig.startsWith("A") ? "B" + sig.slice(1) : "A" + sig.slice(1));

    const protectedRes = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Authorization: `Bearer ${tampered}` },
      }),
    );
    expect(protectedRes.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("strips client-supplied identity headers when M2M token is used", async () => {
    const issueRes = await tokenRequest({
      grant_type: "client_credentials",
      client_id: "svc-a",
      client_secret: "shh-shh-shh",
    });
    const { access_token } = (await issueRes.json()) as TokenResponse;

    await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "X-User-Id": "attacker",
          "X-Org-Id": "evil-org",
          "X-User-Email": "attacker@evil.com",
        },
      }),
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, fetchOptions] = mockFetch.mock.calls[0];
    const headers = fetchOptions.headers as Headers;
    expect(headers.get("X-User-Id")).toBe("service-account:svc-a");
    expect(headers.get("X-Org-Id")).toBe("org-a");
    expect(headers.get("X-User-Email")).toBe("svc-a@example.com");
  });
});
