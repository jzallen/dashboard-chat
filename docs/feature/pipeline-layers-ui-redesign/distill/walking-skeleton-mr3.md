# Walking Skeleton — pipeline-layers-ui-redesign / MR-3

> Notes only. The scenario SSOT is the vitest suite under
> `frontend/src/ui/components/Breadcrumb/` + `.../OrgView/OrgSheet.test.tsx` +
> `.../AppShell/AppShell.test.tsx`. Strategy + decisions live in
> `wave-decisions-mr3.md`.

## Thin slice (the skeleton scenario)
`Breadcrumb.test.tsx > "filters projects by name and navigates to the selected
project's pipeline landing"`.

It exercises the whole MR-3 spine end-to-end through the real route surface:

```
URL /projects/p1/pipeline   (driving port: rendered breadcrumb route via createRoutesStub)
  → useParams → resolveBreadcrumbContext → list context
  → useOrgProjectsQuery (data port, doubled) → project-crumb "Alpha"
  → open ProjectPicker → search "Bet" filters to project-option-p2
  → select p2 → navigate("/projects/p2/pipeline")   (the MR-2 landing target)
  → breadcrumb re-renders in the new context → project-crumb "Beta", picker closed
```

Real route-param wiring + real navigation (not a spy) + real (doubled) data port →
a real user-visible crumb change. This is the minimal proof that the breadcrumb is
wired to the URL and routes into the MR-2 Pipeline landing.

## Suite map (22 RED cases → GREEN in DELIVER)
| File | Cases | Drives step |
|---|---|---|
| `Breadcrumb/breadcrumbContext.test.ts` | 6 | 03-01 (pure resolver) |
| `Breadcrumb/Breadcrumb.test.tsx` | 9 | 03-02 (shell + pickers + org toggle + utility) |
| `OrgView/OrgSheet.test.tsx` | 4 | 03-03 (org settings sheet) |
| `AppShell/AppShell.test.tsx` | 3 | 03-04 (shell swap + SideNav deletion) |

## Driving / data ports (port-to-port)
- **Driving port:** the rendered breadcrumb route surface (`createRoutesStub` at
  `/projects/:projectId/pipeline`, `/view/:viewId`, `…?org=1`). Navigation asserted
  by destination re-render, not a `useNavigate` spy.
- **Data port (driven):** dataCatalog query hooks (`useOrgProjectsQuery`,
  `useDatasets`/`useViewsQuery`/`useReportsQuery`, `useViewQuery`/`useReportQuery`/
  `useDatasetQuery`), doubled at the boundary. NOT the ui-state wire.

## What the doubles cannot model (honesty note)
happy-dom applies no stylesheets → no computed MR-1 token colors, no CSS cascade, no
paint, no real popover positioning. The route doubles model no network latency/errors.
Visual/contrast + real-data verification deferred to MR-8 (Playwright) and live demo.

## RED verification (Mandate 7)
`cd frontend && npx vitest run src/ui/components/Breadcrumb
src/ui/components/OrgView/OrgSheet.test.tsx
src/ui/components/AppShell/AppShell.test.tsx`
→ 22 failed / 22, every failure the `__SCAFFOLD__` throw
("Not yet implemented — RED scaffold (breadcrumb MR-3)"); zero import/resolve
(BROKEN) errors. Confirmed RED, ready for DELIVER.
