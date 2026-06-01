// Acceptance suite — MR-1 design-token foundation + dark-mode plumbing.
// Feature: pipeline-layers-ui-redesign (DISTILL wave).
//
// Strategy C (real local I/O): the only "ports" are the browser's localStorage
// and the document root, both exercised for real under happy-dom — no mocks.
//
// happy-dom does NOT apply external stylesheets, so these tests assert the
// theme CLASS on the root (the no-flash contract + the gate for token values),
// not computed colors. Token color values are verified visually / by a future
// Playwright pass (see distill/wave-decisions.md DWD-3). The true SSR-ingress
// first-paint check is authored as a deferred adapter-integration scenario in
// tests/acceptance/pipeline-ui-design-tokens/ (blocked by the SSR asset-hash
// issue — distill/upstream-issues.md UI-1).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AESTHETIC_CLASS,
  applyThemeClass,
  DARK_CLASS,
  DEFAULT_MODE,
  initThemeFromStorage,
  readStoredMode,
  THEME_STORAGE_KEY,
  themeInitScript,
} from "./theme";
import { ThemeToggle } from "./ThemeToggle";

/** Exercise the pre-hydration init exactly as the browser would before first
 *  paint — apply the stored preference to the real documentElement. Real I/O:
 *  reads the real localStorage, mutates the real root. (We call the pure init
 *  logic directly rather than eval-ing the inline script string — see the
 *  separate "no-flash wiring" assertion below for the script seam.) */
function runInitScriptOnFirstPaint(): void {
  initThemeFromStorage(document.documentElement, localStorage);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
});

// ─── AC1 — WALKING SKELETON @walking_skeleton @real-io ────────────────────────
// First paint applies the SSR-safe default (Neobrutalist light) with no flash.
describe("AC1 first-paint default theme (walking skeleton)", () => {
  it("applies Neobrutalist light on the root when no preference is stored", () => {
    // Given a first-time visitor — nothing persisted
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    // When the pre-hydration init script runs (the browser's first action)
    runInitScriptOnFirstPaint();

    // Then the root carries the single aesthetic class and is NOT dark —
    // first paint matches the default, so there is no flash.
    const root = document.documentElement;
    expect(root.classList.contains(AESTHETIC_CLASS)).toBe(true);
    expect(root.classList.contains(DARK_CLASS)).toBe(false);
    expect(DEFAULT_MODE).toBe("light");
  });
});

// ─── AC1b — the no-flash seam exists (inline pre-hydration script) ────────────
// The Layout must inject an inline <head> script so the class is set BEFORE
// paint (a client-effect-applied class would flash). Assert the seam without
// evaluating it: the script body references the persisted-preference key AND the
// theme class constants it must apply (containment assertions — deferred MR-1
// nit, applied MR-8). These are happy-dom-honorable string checks, not color.
describe("AC1b no-flash inline script seam", () => {
  it("exposes a non-empty pre-hydration script body that reads the stored preference", () => {
    const body = themeInitScript();
    expect(typeof body).toBe("string");
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain(THEME_STORAGE_KEY);
  });

  it("wires the aesthetic + dark class constants into the script body", () => {
    const body = themeInitScript();
    // The script always applies the single aesthetic class and conditionally the
    // dark class — both constants must appear in the serialized body so the seam
    // cannot silently drift from the source constants.
    expect(body).toContain(AESTHETIC_CLASS);
    expect(body).toContain(DARK_CLASS);
  });
});

// ─── AC3 — persistence across reload @real-io ─────────────────────────────────
// A stored dark preference is applied on first paint of the next load (no flash).
describe("AC3 persisted preference applied before hydration", () => {
  it("applies dark on first paint when the stored preference is dark", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");

    runInitScriptOnFirstPaint();

    const root = document.documentElement;
    expect(root.classList.contains(DARK_CLASS)).toBe(true);
    expect(root.classList.contains(AESTHETIC_CLASS)).toBe(true);
  });
});

// ─── AC4 — edge: corrupt/missing preference degrades gracefully @real-io ──────
describe("AC4 graceful fallback on corrupt preference", () => {
  it("falls back to the light default without error when the stored value is corrupt", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");

    expect(() => runInitScriptOnFirstPaint()).not.toThrow();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    expect(readStoredMode(localStorage)).toBe("light");
  });
});

// ─── AC2 — toggle flips the root theme and persists @real-io ──────────────────
describe("AC2 dark-mode toggle (org-view appearance control)", () => {
  it("flips the root to dark and persists the choice, then back to light", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByTestId("dark-mode-toggle");

    // first paint: light
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});

// ─── supporting units on the preference + class primitives ────────────────────
describe("readStoredMode", () => {
  it("returns the light default when no preference is stored", () => {
    expect(readStoredMode(localStorage)).toBe(DEFAULT_MODE);
  });

  it("returns the stored mode when it is a valid value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredMode(localStorage)).toBe("dark");
  });
});

describe("applyThemeClass", () => {
  it("adds the dark class for dark mode while always keeping the aesthetic class", () => {
    const root = document.createElement("div");
    applyThemeClass(root, "dark");
    expect(root.classList.contains(AESTHETIC_CLASS)).toBe(true);
    expect(root.classList.contains(DARK_CLASS)).toBe(true);
  });

  it("removes the dark class when switching to light", () => {
    const root = document.createElement("div");
    root.classList.add(AESTHETIC_CLASS, DARK_CLASS);
    applyThemeClass(root, "light");
    expect(root.classList.contains(AESTHETIC_CLASS)).toBe(true);
    expect(root.classList.contains(DARK_CLASS)).toBe(false);
  });
});
