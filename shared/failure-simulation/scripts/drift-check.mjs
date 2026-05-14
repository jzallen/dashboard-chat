#!/usr/bin/env node
// Failure-simulation manifest-vs-source drift check.
//
// Enforces CA-1 (`docs/feature/failure-simulation-consolidation/design/handoff-design-to-distill.md`):
// every failure-simulation knob-name pattern that appears in production source
// under `ui-state/` and `agent/` must correspond to a manifest entry (matched
// by canonical name or `legacyAlias.transportValue`).
//
// Patterns scanned (mirrors driver.grep_production_source_for_knob_patterns
// in tests/acceptance/failure-simulation-consolidation/driver.py):
//   - HTTP header names matching `X-Force-*`
//   - XState event names matching `__force_*__` or `__expire_*__`
//   - Legacy body-field keys matching `harness_force_*`
//   - The literal canonical body-field key `force_reissue_failures`
//
// The body-field pattern is intentionally narrow — `force_*` is too generic
// (`force_restart`, etc. live in source for unrelated reasons). Adding a new
// body-field knob means extending both this script's body-field allow-list
// and the driver's `grep_production_source_for_knob_patterns` patterns.
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
const LEGACY_ALIAS_VALUES = new Set(
  manifest
    .filter((entry) => entry.legacyAlias != null)
    .map((entry) => entry.legacyAlias.transportValue),
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
  const tsLegacy = new Set(
    [...tsSource.matchAll(/transportValue:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
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
  for (const value of LEGACY_ALIAS_VALUES) {
    if (!tsLegacy.has(value)) {
      mismatches.push(`manifest.js carries legacyAlias '${value}' missing from manifest.ts`);
    }
  }
  for (const value of tsLegacy) {
    if (!LEGACY_ALIAS_VALUES.has(value)) {
      mismatches.push(`manifest.ts carries legacyAlias '${value}' missing from manifest.js`);
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
const LEGACY_BODY_FIELD_PATTERN = /\bharness_force_[a-z0-9_]+\b/g;
const CANONICAL_BODY_FIELD_LITERAL = /\bforce_reissue_failures\b/g;

function normalizeHeader(token) {
  return token.startsWith("X-") ? token.slice(2).toLowerCase() : token.toLowerCase();
}

function normalizeEventToCanonical(token) {
  return token.replace(/^__|__$/g, "").replace(/_/g, "-");
}

function normalizeBodyFieldToCanonical(token) {
  return token.replace(/_/g, "-");
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
          if (LEGACY_ALIAS_VALUES.has(raw)) continue;
          const canonical = normalizeEventToCanonical(raw);
          if (!CANONICAL_NAMES.has(canonical)) {
            drift.push(
              `${relPath}:${idx + 1}: event '${raw}' (canonical '${canonical}') is not in the manifest`,
            );
          }
        }
        for (const match of line.matchAll(LEGACY_BODY_FIELD_PATTERN)) {
          const raw = match[0];
          if (LEGACY_ALIAS_VALUES.has(raw)) continue;
          const canonical = normalizeBodyFieldToCanonical(raw);
          if (!CANONICAL_NAMES.has(canonical)) {
            drift.push(
              `${relPath}:${idx + 1}: legacy body-field '${raw}' (canonical '${canonical}') is not in the manifest`,
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
    `failure-simulation drift-check: clean (${CANONICAL_NAMES.size} canonical names, ${LEGACY_ALIAS_VALUES.size} legacy aliases scanned)`,
  );
}

main();
