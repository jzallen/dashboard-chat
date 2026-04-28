// Build-identity loader and startup logger.
//
// Reads /etc/dashboard-chat/version.json (planted by the Bazel `version_layer`
// macro) and emits one canonical identity line on stdout. Falls back to
// "unknown" tokens if the file is missing or unparseable so that
// uninstrumented images still boot (AC1.5 of dc-1k8).
//
// Format (matches AC1.1 regex from docs/feature/log-image-identity-on-startup/discuss/user-stories.md):
//
//     <service> image=<tag> sha=<sha7>[+dirty] built=<rfc3339>

import { readFileSync } from "node:fs";

const VERSION_FILE = "/etc/dashboard-chat/version.json";
const UNKNOWN = "unknown";

export function logImageIdentity(service: string): void {
  let image = UNKNOWN;
  let sha = UNKNOWN;
  let built = UNKNOWN;
  let dirty = false;

  try {
    const payload = JSON.parse(readFileSync(VERSION_FILE, "utf-8")) as {
      image?: unknown;
      sha?: unknown;
      dirty?: unknown;
      built?: unknown;
    };
    if (typeof payload.image === "string") image = payload.image;
    if (typeof payload.sha === "string") sha = payload.sha;
    if (typeof payload.built === "string") built = payload.built;
    dirty = payload.dirty === true;
  } catch {
    // File missing, unreadable, or invalid JSON — graceful degradation.
  }

  const shortSha = sha !== UNKNOWN && sha.length >= 7 ? sha.slice(0, 7) : sha;
  const dirtyMarker = dirty && sha !== UNKNOWN ? "+dirty" : "";
  // process.stdout.write so the line appears even if console.* is reconfigured.
  process.stdout.write(
    `${service} image=${image} sha=${shortSha}${dirtyMarker} built=${built}\n`,
  );
}
