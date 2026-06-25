import { describe, expect, it } from "vitest";

import { maskValue, redact, redactionKeys } from "./redaction";

/**
 * Redaction regression guard.
 *
 * The inputs are keyed by the attribute names a caller would use — an
 * `Authorization` header, a `Cookie`, a PAT, an M2M client secret, a raw
 * `email`. Redaction matches on the KEY (`authorization`, `cookie`, `*token*`,
 * `*secret*`, `password`, `email`), never on value content, so the values are
 * deliberately obvious placeholders rather than realistic credentials — real
 * high-entropy secrets would only trip secret scanners without making the test
 * any stronger. The guarantee: whatever value a sensitive key carries, it never
 * survives serialization.
 */

/** Placeholder credential values, keyed by the attribute name a caller would use. */
const SENSITIVE_ATTRIBUTES = {
  authorization: "Bearer test-access-token",
  cookie: "session=test-session-value; csrf=test-csrf-value",
  access_token: "test-personal-access-token",
  client_secret: "test-m2m-client-secret",
  password: "test-password-value",
  email: "user@example.com",
} as const;

describe("redact", () => {
  it("never serializes a sensitive or PII value", () => {
    const serialized = JSON.stringify(redact({ ...SENSITIVE_ATTRIBUTES }));

    for (const [key, value] of Object.entries(SENSITIVE_ATTRIBUTES)) {
      expect(
        serialized.includes(value),
        `value for "${key}" leaked into the serialized log line`,
      ).toBe(false);
    }
  });

  it("masks every sensitive key with the configured mask", () => {
    const out = redact({ ...SENSITIVE_ATTRIBUTES });

    for (const key of Object.keys(SENSITIVE_ATTRIBUTES)) {
      expect(out[key]).toBe(redactionKeys.mask);
    }
  });

  it("masks substring-matched keys regardless of position", () => {
    const out = redact({
      x_refresh_token: SENSITIVE_ATTRIBUTES.access_token,
      stripe_secret_key: SENSITIVE_ATTRIBUTES.client_secret,
    });

    expect(out.x_refresh_token).toBe(redactionKeys.mask);
    expect(out.stripe_secret_key).toBe(redactionKeys.mask);
  });

  it("leaves non-sensitive attributes untouched", () => {
    const out = redact({ principal_id: "user_01HQZX4F7R", decision: "allow" });

    expect(out).toEqual({ principal_id: "user_01HQZX4F7R", decision: "allow" });
  });

  it("matches sensitive keys case-insensitively", () => {
    const out = redact({
      Authorization: SENSITIVE_ATTRIBUTES.authorization,
      "X-Refresh-TOKEN": SENSITIVE_ATTRIBUTES.access_token,
    });

    expect(out).toEqual({
      Authorization: redactionKeys.mask,
      "X-Refresh-TOKEN": redactionKeys.mask,
    });
  });

  it("redacts credentials nested in objects and arrays", () => {
    const out = redact({
      request: {
        headers: { authorization: SENSITIVE_ATTRIBUTES.authorization },
        path: "/projects",
      },
      clients: [
        { id: "c1", client_secret: SENSITIVE_ATTRIBUTES.client_secret },
        { id: "c2" },
      ],
    });

    expect(out).toEqual({
      request: {
        headers: { authorization: redactionKeys.mask },
        path: "/projects",
      },
      clients: [{ id: "c1", client_secret: redactionKeys.mask }, { id: "c2" }],
    });
  });

  it("does not mutate the input attributes bag", () => {
    const input = { authorization: SENSITIVE_ATTRIBUTES.authorization };
    redact(input);

    expect(input.authorization).toBe(SENSITIVE_ATTRIBUTES.authorization);
  });

  it("breaks reference cycles instead of overflowing the stack", () => {
    const node: Record<string, unknown> = { id: "n1" };
    node.self = node;
    const ring: Record<string, unknown> = { a: { id: "a" } };
    (ring.a as Record<string, unknown>).back = ring;

    expect(() => redact(node)).not.toThrow();
    expect(redact(node)).toEqual({ id: "n1", self: "[Circular]" });
    expect(redact(ring)).toEqual({ a: { id: "a", back: "[Circular]" } });
  });

  it("masks a credential that closes a cycle before the cycle is broken", () => {
    const ctx: Record<string, unknown> = {
      authorization: SENSITIVE_ATTRIBUTES.authorization,
    };
    ctx.parent = ctx;

    expect(redact(ctx)).toEqual({
      authorization: redactionKeys.mask,
      parent: "[Circular]",
    });
  });

  it("passes non-plain objects through without flattening them", () => {
    const at = new Date("2026-06-07T00:00:00.000Z");
    const tags = new Set(["a", "b"]);
    const out = redact({ at, tags, note: "ok" });

    expect(out.at).toBe(at);
    expect(out.tags).toBe(tags);
    expect(out.note).toBe("ok");
  });

  it("preserves an Error's message while redacting its attached credentials", () => {
    const err = Object.assign(new Error("boom"), {
      access_token: SENSITIVE_ATTRIBUTES.access_token,
      attempt: 2,
    });
    const out = redact({ err }) as { err: Record<string, unknown> };

    expect(out.err.name).toBe("Error");
    expect(out.err.message).toBe("boom");
    expect(out.err.access_token).toBe(redactionKeys.mask);
    expect(out.err.attempt).toBe(2);
  });
});

describe("maskValue", () => {
  it("masks a value whose key is sensitive", () => {
    expect(maskValue("password", "test-password-value")).toBe(
      redactionKeys.mask,
    );
  });

  it("passes a value whose key is not sensitive through unchanged", () => {
    expect(maskValue("decision", "allow")).toBe("allow");
  });

  it("is a no-op for an absent value even on a sensitive key", () => {
    expect(maskValue("authorization", undefined)).toBeUndefined();
  });
});
