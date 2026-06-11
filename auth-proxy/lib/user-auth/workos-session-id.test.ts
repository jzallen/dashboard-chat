import { describe, expect, it } from "vitest";

import { decodeWorkosSessionId } from "./workos.ts";

function jwt(payload: object): string {
  const seg = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${seg({ alg: "RS256", typ: "JWT" })}.${seg(payload)}.signature`;
}

describe("decodeWorkosSessionId", () => {
  it("extracts the `sid` claim from a WorkOS access token", () => {
    expect(decodeWorkosSessionId(jwt({ sid: "session_01ABC", sub: "u" }))).toBe(
      "session_01ABC",
    );
  });

  it("returns undefined when the token carries no `sid`", () => {
    expect(decodeWorkosSessionId(jwt({ sub: "u" }))).toBeUndefined();
  });

  it("returns undefined for a non-string `sid`", () => {
    expect(decodeWorkosSessionId(jwt({ sid: 123 }))).toBeUndefined();
  });

  it("returns undefined for a malformed/empty token (never throws)", () => {
    expect(decodeWorkosSessionId("not-a-jwt")).toBeUndefined();
    expect(decodeWorkosSessionId("")).toBeUndefined();
    expect(decodeWorkosSessionId("a.b")).toBeUndefined();
  });
});
