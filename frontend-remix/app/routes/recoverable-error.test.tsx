// Unit tests for the RecoverableError route component.
//
// Behavior budget for this file (B5): 1 behavior × 2 = 2 tests max.
// The four cause-tag variants are parametrized in a single test.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { RecoverableError } from "./recoverable-error.tsx";
import { COPY_VARIANTS } from "./copy-variants.ts";
import type { UnderlyingCauseTag } from "./copy-variants.ts";

describe("RecoverableError component (B5)", () => {
  afterEach(() => cleanup());

  it.each<[UnderlyingCauseTag]>([
    ["transient"],
    ["cookie-blocked"],
    ["partial-setup"],
    ["workos-profile-corrupt"],
  ])(
    "renders the %s copy variant with title, body, CTA and reference code",
    (tag) => {
      const refCode = "R-7a4f-901c";
      render(
        <RecoverableError
          underlyingCauseTag={tag}
          correlationId={refCode}
        />,
      );
      const variant = COPY_VARIANTS[tag];
      expect(screen.getByRole("heading", { name: variant.title })).toBeTruthy();
      expect(screen.getByText(variant.body)).toBeTruthy();
      // Try-again CTA is rendered for every recoverable variant.
      expect(screen.getByRole("button", { name: variant.cta })).toBeTruthy();
      // Reference code visibly present (Maya can read + share it).
      expect(screen.getByText(refCode)).toBeTruthy();
    },
  );

  it("provides distinct copy for each variant", () => {
    const titles = new Set(
      Object.values(COPY_VARIANTS).map((v) => v.title),
    );
    // Each cause tag MUST have a unique title so Maya gets specific
    // guidance, not a generic page.
    expect(titles.size).toBe(4);
  });
});
