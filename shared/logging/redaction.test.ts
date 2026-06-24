import { describe, expect, it } from "vitest";

import { redact, redactionKeys } from "./redaction";

/**
 * Redaction regression guard (ADR-053 §2, US-7 AC7.2).
 *
 * The inputs are keyed by the attribute names a caller would use — an
 * `Authorization` header, a `Cookie`, a PAT, an M2M client secret, a raw
 * `email`. Redaction matches on the KEY (`authorization`, `cookie`, `*token*`,
 * `*secret*`, `password`, `email`), never on value content, so the values are
 * deliberately obvious placeholders rather than realistic credentials — real
 * high-entropy secrets would only trip secret scanners without making the test
 * any stronger. The guarantee: whatever value a sensitive key carries, it never
 * survives serialization.
 *
 * This test ships RED — the redaction stubs pass values through unchanged, so
 * the placeholder values leak and the assertions fail. Making it GREEN is the
 * next sub-issue; do not weaken these assertions to match the scaffold.
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
});
