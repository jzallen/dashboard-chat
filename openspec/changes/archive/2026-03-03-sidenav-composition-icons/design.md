# Design: SideNav Composition + Icon Library

## Decision 1: SideNav as a children-accepting shell

**Approach**: SideNav renders `{children}` in its body area. AppShell forks based on `projectId` and passes the appropriate child.

**Rejected alternatives**:
- *Router-level fork* — would require splitting AppShell into two layout components, duplicating shell chrome. Overkill for two modes.
- *Context provider (shadcn SidebarProvider pattern)* — OrgNav and ProjectNav are direct children, not deeply nested. Props are sufficient. Can promote to context later if a third consumer emerges.
- *Render props* — syntactic overhead for no benefit in application code.

**SideNav shell interface**:
```tsx
interface SideNavProps {
  orgName: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  children: React.ReactNode;
}
```

**OrgNav interface**:
```tsx
interface OrgNavProps {
  projects: Project[];
  activeProjectId: string | null;
  collapsed: boolean;
  onSelectProject: (id: string) => void;
}
```

**ProjectNav interface**:
```tsx
interface ProjectNavProps {
  project: Project;
  datasets: DatasetSparse[];
  activeDatasetId: string | null;
  collapsed: boolean;
  onSelectProject: () => void;
  onSelectDataset: (id: string) => void;
}
```

**File layout**:
```
SideNav/
  index.tsx        — shell only (nav, header, collapse toggle, {children})
  OrgNav.tsx       — promoted from OrgBody
  ProjectNav.tsx   — promoted from ProjectBody
  DatasetNavItem.tsx  — unchanged
  ProjectNavItem.tsx  — unchanged
  SideNav.module.css  — unchanged
```

## Decision 2: @heroicons/react over alternatives

**Why Heroicons**: The codebase already uses HeroIcons paths verbatim. The library produces pixel-identical output. Zero visual regression risk. Best bundle efficiency at ~14 icons (~1-2 KB gzipped). Made by Tailwind Labs, natural fit with the Tailwind stack. Both 20/solid and 24/outline styles supported.

**Rejected alternatives**:
- *lucide-react* — stroke-only, cannot replicate the 20x20 solid mini icons currently used in SideNav
- *react-icons* — documented tree-shaking failures with Vite barrel files
- *@phosphor-icons/react* — 16x bundle overhead ratio

**Import convention**: Import directly from style-specific paths. No barrel re-exports.
```tsx
import { ChevronLeftIcon } from "@heroicons/react/20/solid";
import { XMarkIcon } from "@heroicons/react/24/outline";
```

## Decision 3: No custom Icon wrapper component

Named component imports (`<ChevronLeftIcon />`) are the community standard. A generic `<Icon name="chevron-left" />` wrapper would break tree-shaking or require dynamic imports. Each icon is self-documenting via its component name.

## Icon Inventory

| Current Location | Icon | Library Import |
|---|---|---|
| SideNav/index.tsx | chevron-right (collapsed) | `ChevronRightIcon` from `20/solid` |
| SideNav/index.tsx | chevron-left (expanded) | `ChevronLeftIcon` from `20/solid` |
| SideNav/index.tsx (ProjectBody) | folder | `FolderIcon` from `20/solid` |
| SideNav/ProjectNavItem.tsx | folder | `FolderIcon` from `20/solid` |
| SideNav/DatasetNavItem.tsx | table-cells | `TableCellsIcon` from `20/solid` |
| DatasetCarousel/index.tsx | chevron-left | `ChevronLeftIcon` from `20/solid` |
| DatasetCarousel/index.tsx | chevron-right | `ChevronRightIcon` from `20/solid` |
| DatasetView/ViewModeToggle.tsx | squares-2x2 | `Squares2X2Icon` from `20/solid` |
| DatasetView/ViewModeToggle.tsx | table-cells | `TableCellsIcon` from `20/solid` |
| DatasetView/index.tsx | arrow-down-tray | `ArrowDownTrayIcon` from `24/outline` |
| DatasetView/index.tsx | circle-stack | `CircleStackIcon` from `24/outline` |
| DatasetView/index.tsx | clock | `ClockIcon` from `24/outline` |
| DatasetView/index.tsx | cog-6-tooth | `Cog6ToothIcon` from `24/outline` |
| DatasetView/index.tsx | check | `CheckIcon` from `24/outline` |
| DatasetView/index.tsx | arrow-path | `ArrowPathIcon` from `24/outline` |
| TransformSettings/index.tsx | x-mark | `XMarkIcon` from `24/outline` |
| TransformSettings/TransformCard/DeleteButton.tsx | trash | `TrashIcon` from `24/outline` |
