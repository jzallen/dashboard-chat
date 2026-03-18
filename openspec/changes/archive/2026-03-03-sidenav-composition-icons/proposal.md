## Why

The SideNav component has two architectural problems:

1. **Conditional branching via discriminated union props.** `SideNav` accepts a `mode: "org" | "project"` union that forces it to own routing logic for both views. This violates composition-over-configuration: the shell knows about its domain content. Adding a third mode (e.g., settings, admin) would compound the branching. The `OrgBody` and `ProjectBody` private functions already contain the right separation — they just need to be promoted to standalone components.

2. **17 inline SVG magic strings across 8 files.** Every icon is a copy-pasted HeroIcons v2 SVG path (`d` attribute). The same folder icon path appears 3 times. These are unreadable, undiscoverable, and unmaintainable — you can't tell what `M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72...` represents without rendering it.

## What Changes

### Part 1: SideNav Composition Refactor

- **SideNav becomes a layout shell** that accepts `children`. It owns: `<nav>` chrome, header (org name + collapse toggle), scrollable body wrapper, expanded/collapsed CSS transitions.
- **OrgNav** (new exported component): owns project list rendering, skeleton loading, project click navigation. Currently the private `OrgBody` function.
- **ProjectNav** (new exported component): owns project heading, dataset list, section labels, dataset click navigation. Currently the private `ProjectBody` function.
- **AppShell forks early**: instead of passing `mode` to SideNav, it renders `<SideNav><OrgNav .../></SideNav>` or `<SideNav><ProjectNav .../></SideNav>`.

### Part 2: Replace Inline SVGs with @heroicons/react

- Install `@heroicons/react` — the library these paths already come from (confirmed by matching path data).
- Replace all 17 inline SVGs across 8 files with named component imports (`ChevronLeftIcon`, `FolderIcon`, etc.).
- Two import paths: `@heroicons/react/20/solid` for mini filled icons (SideNav, Carousel), `@heroicons/react/24/outline` for outline icons (DatasetView toolbar, TransformSettings).

## Scope

- Frontend only. No backend, worker, or shared changes.
- No visual changes — `@heroicons/react` produces identical SVG output to the current inline paths.
- No new features. Pure structural refactor.
