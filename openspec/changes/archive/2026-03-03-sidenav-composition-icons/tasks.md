# Tasks: SideNav Composition + Icon Library

## Phase 1: Install @heroicons/react

- [ ] 1.1 Run `npm install @heroicons/react` at root. Verify it appears in root `package.json` dependencies and `package-lock.json` is updated.

## Phase 2: Replace inline SVGs with Heroicons components

- [ ] 2.1 **SideNav/DatasetNavItem.tsx**: Replace inline table SVG with `import { TableCellsIcon } from "@heroicons/react/20/solid"`. Render `<TableCellsIcon className={styles.navItemIcon} />`.
- [ ] 2.2 **SideNav/ProjectNavItem.tsx**: Replace inline folder SVG with `import { FolderIcon } from "@heroicons/react/20/solid"`. Render `<FolderIcon className={styles.navItemIcon} />`.
- [ ] 2.3 **SideNav/index.tsx**: Replace chevron SVGs in collapse button with `ChevronRightIcon` (collapsed) and `ChevronLeftIcon` (expanded) from `@heroicons/react/20/solid`. Replace folder SVG in ProjectBody with `FolderIcon`.
- [ ] 2.4 **DatasetView/DatasetCarousel/index.tsx**: Replace left/right chevron SVGs with `ChevronLeftIcon` and `ChevronRightIcon` from `@heroicons/react/20/solid`.
- [ ] 2.5 **DatasetView/ViewModeToggle.tsx**: Replace grid SVG with `Squares2X2Icon` and table SVG with `TableCellsIcon` from `@heroicons/react/20/solid`.
- [ ] 2.6 **DatasetView/index.tsx**: Replace 6 inline SVGs with imports from `@heroicons/react/24/outline`: `ArrowDownTrayIcon`, `CircleStackIcon`, `ClockIcon`, `Cog6ToothIcon`, `CheckIcon`, `ArrowPathIcon`.
- [ ] 2.7 **TransformSettings/index.tsx**: Replace close SVG with `XMarkIcon` from `@heroicons/react/24/outline`.
- [ ] 2.8 **TransformSettings/TransformList/TransformCard/DeleteButton.tsx**: Replace trash SVG with `TrashIcon` from `@heroicons/react/24/outline`.
- [ ] 2.9 Run `npm run build` to verify no compilation errors.

## Phase 3: SideNav composition refactor

- [ ] 3.1 Create **SideNav/OrgNav.tsx**: Extract `OrgBody` from `SideNav/index.tsx` into a new exported `OrgNav` component. Props: `projects`, `activeProjectId`, `collapsed`, `onSelectProject`. Move skeleton rendering and `ProjectNavItem` mapping here.
- [ ] 3.2 Create **SideNav/ProjectNav.tsx**: Extract `ProjectBody` from `SideNav/index.tsx` into a new exported `ProjectNav` component. Props: `project`, `datasets`, `activeDatasetId`, `collapsed`, `onSelectProject`, `onSelectDataset`. Move project heading, section label, and `DatasetNavItem` mapping here.
- [ ] 3.3 **Refactor SideNav/index.tsx**: Remove the discriminated union `SideNavProps`. Replace with `{ orgName, collapsed, onToggleCollapse, children }`. Remove `OrgBody`/`ProjectBody` functions. Render `{children}` in the body div.
- [ ] 3.4 **Update AppShell/index.tsx**: Replace the two `<SideNav mode=...>` calls with composition: `<SideNav ...><OrgNav .../></SideNav>` and `<SideNav ...><ProjectNav .../></SideNav>`. Import `OrgNav` and `ProjectNav`.
- [ ] 3.5 **Update SideNav barrel export** if one exists, or ensure OrgNav/ProjectNav are importable.

## Phase 4: Verification

- [ ] 4.1 Run `npm run build` — zero new TypeScript errors.
- [ ] 4.2 Run `cd frontend && npx vitest run` — all tests pass.
- [ ] 4.3 Verify no remaining inline SVG `<path d=` strings in modified files via grep.
