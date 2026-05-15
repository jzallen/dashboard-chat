#!/usr/bin/env node
// Failure-simulation manifest-vs-source drift check.
//
// Enforces CA-1 (`docs/feature/failure-simulation-consolidation/design/handoff-design-to-distill.md`):
// every failure-simulation knob-name pattern that appears in production source
// under `ui-state/` and `agent/` must correspond to a manifest entry.
//
// A match is established by one of:
//   - For headers: `X-Force-*` token, normalize to lower-kebab, match canonical.
//   - For events: `__force_*__` / `__expire_*__` token, normalize to kebab,
//     match canonical OR (for entries with `eventDistinguisher`) the canonical
//     name with the eventDistinguisher suffix stripped.
//   - For body fields: snake-case token, normalize to kebab, match canonical.
//
// Exit codes:
//   0 — clean
//   1 — drift detected (offending references printed on stderr)
//   2 — manifest-source mismatch (manifest.js and manifest.ts disagree)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { manifest } from "../manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(REGISTRY_DIR, "..", "..");

const CANONICAL_NAMES = new Set(manifest.map((entry) => entry.name));

// Entries with eventDistinguisher render to `__<canonical-without-suffix>__`.
// Precompute the stripped forms for the event-drift match.
const DISTINGUISHER_STRIPPED_CANONICALS = new Set(
  manifest
    .filter((entry) => entry.transport === "event" && entry.eventDistinguisher != null)
    .map((entry) => {
      const suffix = "-" + entry.eventDistinguisher;
      return entry.name.endsWith(suffix)
        ? entry.name.slice(0, -suffix.length)
        : entry.name;
    }),
);

const BODY_FIELD_CANONICAL_TOKENS = new Set(
  manifest
    .filter((entry) => entry.transport === "body-field")
    .map((entry) => entry.name.replace(/-/g, "_")),
);

function checkManifestSsotDrift() {
  const tsSource = readFileSync(join(REGISTRY_DIR, "manifest.ts"), "utf8");
  const tsCanonical = new Set(
    [...tsSource.matchAll(/name:\s*['"]([a-z][a-z0-9-]*[a-z0-9])['"]\s*as\s*KnobCanonicalName/g)].map(
      (match) => match[1],
    ),
  );

  const mismatches = [];
  for (const name of CANONICAL_NAMES) {
    if (!tsCanonical.has(name)) {
      mismatches.push(`manifest.js exports '${name}' but manifest.ts has no matching entry`);
    }
  }
  for (const name of tsCanonical) {
    if (!CANONICAL_NAMES.has(name)) {
      mismatches.push(`manifest.ts declares '${name}' but manifest.js has no matching entry`);
    }
  }
  return mismatches;
}

function* walkTs(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".turbo", ".bazel"].includes(name)) continue;
      yield* walkTs(join(root, name));
    } else if (entry.isFile() && name.endsWith(".ts")) {
      yield join(root, name);
    }
  }
}

const HEADER_PATTERN = /X-Force-[A-Za-z][A-Za-z0-9-]*/g;
const EVENT_PATTERN = /__(?:force|expire)_[a-z][a-z0-9_]*__/g;
const CANONICAL_BODY_FIELD_LITERAL = /\bforce_reissue_failures\b/g;

function normalizeHeader(token) {
  return token.startsWith("X-") ? token.slice(2).toLowerCase() : token.toLowerCase();
}

function normalizeEventToCanonical(token) {
  return token.replace(/^__|__$/g, "").replace(/_/g, "-");
}

function checkProductionSource() {
  const drift = [];
  const roots = [join(REPO_ROOT, "ui-state"), join(REPO_ROOT, "agent")];

  for (const root of roots) {
    try {
      statSync(root);
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
    for (const filePath of walkTs(root)) {
      const relPath = filePath.slice(REPO_ROOT.length + 1);
      const text = readFileSync(filePath, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, idx) => {
        for (const match of line.matchAll(HEADER_PATTERN)) {
          const normalized = normalizeHeader(match[0]);
          if (!CANONICAL_NAMES.has(normalized)) {
            drift.push(
              `${relPath}:${idx + 1}: header '${match[0]}' (canonical '${normalized}') is not in the manifest`,
            );
          }
        }
        for (const match of line.matchAll(EVENT_PATTERN)) {
          const raw = match[0];
          const canonical = normalizeEventToCanonical(raw);
          if (
            !CANONICAL_NAMES.has(canonical) &&
            !DISTINGUISHER_STRIPPED_CANONICALS.has(canonical)
          ) {
            drift.push(
              `${relPath}:${idx + 1}: event '${raw}' (canonical '${canonical}') is not in the manifest`,
            );
          }
        }
        for (const match of line.matchAll(CANONICAL_BODY_FIELD_LITERAL)) {
          if (!BODY_FIELD_CANONICAL_TOKENS.has(match[0])) {
            drift.push(
              `${relPath}:${idx + 1}: body-field '${match[0]}' is not in the manifest`,
            );
          }
        }
      });
    }
  }
  return drift;
}

function main() {
  const ssotIssues = checkManifestSsotDrift();
  if (ssotIssues.length > 0) {
    console.error("manifest.js ↔ manifest.ts drift:");
    for (const issue of ssotIssues) console.error(`  - ${issue}`);
    process.exit(2);
  }

  const drift = checkProductionSource();
  if (drift.length > 0) {
    console.error("Manifest-vs-source drift:");
    for (const line of drift) console.error(`  - ${line}`);
    console.error(
      `\nResolution: add the offending reference to shared/failure-simulation/manifest.{js,ts} ` +
        `with a non-empty rationale and an explicit contractTestAlternativeConsidered choice.`,
    );
    process.exit(1);
  }

  console.log(
    `failure-simulation drift-check: clean (${CANONICAL_NAMES.size} canonical names scanned)`,
  );
}

main();
