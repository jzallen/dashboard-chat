import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tanstackQuery from "@tanstack/eslint-plugin-query";
import testingLibrary from "eslint-plugin-testing-library";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";

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
];
