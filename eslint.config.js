import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tanstackQuery from "@tanstack/eslint-plugin-query";
import testingLibrary from "eslint-plugin-testing-library";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import uiStateConventions from "./ui-state/lib/eslint-plugin-ui-state-conventions/index.js";

export default [
  // ── Global ignores ──────────────────────────────────────────────────
  // Python backend has its own linter (ruff); e2e/openspec are not TS source
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "backend/**",
      "e2e/**",
      "openspec/**",
      "playwright-report/**",
      "tmp/**",
    ],
  },

  // ── Base config for all TS/JS files ─────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      // Keep imports organized: group by external → internal → relative
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",
      // Allow console.warn/error/debug but flag console.log (use structured logging)
      "no-console": ["warn", { allow: ["warn", "error", "debug"] }],
      // Flag untyped escape hatches — warn so they're visible but not blocking
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars are errors by default; allow _-prefixed intentional ignores
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // ── Frontend (React) — production source files ──────────────────────
  // react-hooks rules catch misused hooks (rules-of-hooks) and stale closures
  // (exhaustive-deps) — high value for complex components like ChatContext
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    ignores: ["frontend/src/test/**"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Ensure components are compatible with React Fast Refresh (HMR)
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // ── TanStack Query rules for frontend ───────────────────────────────
  // Catches missing query key dependencies and unstable query client creation
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    ignores: ["frontend/src/test/**"],
    plugins: { "@tanstack/query": tanstackQuery },
    rules: {
      "@tanstack/query/exhaustive-deps": "warn",
      "@tanstack/query/stable-query-client": "error",
    },
  },

  // ── Frontend test files ─────────────────────────────────────────────
  // Testing Library best practices: prefer screen queries, avoid unnecessary act()
  {
    files: ["frontend/src/**/*.test.{ts,tsx}", "frontend/src/**/__tests__/**/*.{ts,tsx}", "frontend/src/test/**/*.{ts,tsx}"],
    plugins: { "testing-library": testingLibrary },
    rules: {
      "testing-library/await-async-queries": "error",
      "testing-library/no-unnecessary-act": "warn",
      "testing-library/prefer-screen-queries": "warn",
      "testing-library/no-debugging-utils": "warn",
      // Tests legitimately use `any` for mocking — don't warn
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // ── Worker files ────────────────────────────────────────────────────
  // Hono runs in Node.js — enable Node globals (process, Buffer, etc.)
  {
    files: ["worker/**/*.ts"],
    ignores: ["worker/**/*.test.ts"],
    languageOptions: { globals: globals.node },
  },

  // ── Shared files ────────────────────────────────────────────────────
  // Shared chat handler used by both frontend and worker — no special config
  {
    files: ["shared/**/*.ts"],
  },

  // ── ADR-039 ui-state vocabulary conventions (C4, C7, C12) ───────────
  // Custom rules under `ui-state/lib/eslint-plugin-ui-state-conventions/`
  // mechanically enforce the lint-tier (E1) conventions from ADR-039.
  // Each rule has a probe under `ui-state/lib/lint-probes/` that contains
  // a deliberate violation; the plugin's test suite asserts the rule
  // fires on its probe (Earned Trust principle 12).
  //
  // Initial severity is `warn` for all three because pre-existing
  // violations are present in projection.ts and will be cleaned up by
  // follow-up MRs:
  //   - C7 violations (intent_session_id, intent_resource_*) clean up in
  //     MR-D (audit §8); the rule flips to `error` after MR-D lands.
  //   - C12 violations (session_chat_project_id, session_chat_project_name)
  //     clean up in MR-H (audit §8); the rule flips to `error` after MR-H
  //     lands.
  // C4 has no current violations in production code; it remains `warn`
  // here for consistency with the other two and is safe to upgrade to
  // `error` independently in a follow-up.
  {
    files: ["ui-state/**/*.ts"],
    ignores: ["**/*.test.ts"],
    plugins: { "ui-state-conventions": uiStateConventions },
    rules: {
      "ui-state-conventions/no-failure-sim-event-prefix-outside-allowlist":
        "warn",
      "ui-state-conventions/intent-prefix-deeplink-only": "warn",
      "ui-state-conventions/no-machine-name-prefix-on-projection-fields":
        "warn",
    },
  },

  // ── DWD-3 single-writer guard for X-Active-Scope ────────────────────
  // The X-Active-Scope header is the agent's authoritative scope contract
  // (ADR-029 §4 + DWD-3). It MUST be set exclusively by
  // `activeScopeHeader(projection)` exported from
  // `frontend/app/lib/ui-state-client.ts` so the header value's
  // construction has a single audit point. Manual sets via `headers:{...}`
  // would let stale projections leak into chat turns mid-switch, breaking
  // the IC-J002-4 atomicity contract.
  //
  // The rule flags any literal containing "X-Active-Scope" (case-insensitive)
  // outside the small allowlist of files that legitimately produce/consume
  // it (the writer, the agent reader, the harness, and tests).
  {
    files: [
      "frontend/**/*.{ts,tsx}",
      "ui-state/**/*.{ts,tsx}",
      "auth-proxy/**/*.{ts,tsx}",
    ],
    ignores: [
      "**/*.test.ts",
      "**/*.test.tsx",
      // Single writer:
      "frontend/app/lib/ui-state-client.ts",
      // Type-only declarations + tests are allowed:
      "frontend/src/test/**",
      "frontend/app/**/__tests__/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/^[Xx]-[Aa]ctive-[Ss]cope$/], TemplateElement[value.raw=/[Xx]-[Aa]ctive-[Ss]cope/]",
          message:
            "Manual X-Active-Scope header writes are forbidden (DWD-3). " +
            "Use activeScopeHeader(projection) from frontend/app/lib/ui-state-client.ts.",
        },
      ],
    },
  },
];
