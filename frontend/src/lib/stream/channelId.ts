/** Strip hyphens from a UUID to produce a compact 32-char hex string. */
export function compactId(id: string): string {
  return id.replace(/-/g, "");
}

/**
 * Generate a short session hash from org, user, and timestamp.
 * 8 hex chars ~ 4 billion combinations — collision-safe for <100 users/org.
 */
export async function sessionHash(orgId: string, userId: string): Promise<string> {
  const input = `${orgId}:${userId}:${Date.now()}`;
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 8);
}
