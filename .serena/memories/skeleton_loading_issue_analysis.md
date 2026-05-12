# Skeleton Loading Issue Analysis

## Problem Summary
ProjectNav shows a skeleton loader inside OrgView even though:
1. `/orgs/me` API request succeeds (org data loaded)
2. `/api/projects` API request succeeds (projects data received)

## Root Cause: Data Structure Mismatch

### What the Frontend Expects
The frontend `Project` interface requires a `datasets` array:
```typescript
// reverse-proxy/src/lib/api/projects.ts
export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  datasets: DatasetSparse[];  // ← REQUIRED
}
```

### What the Backend Returns for `list_projects`
The `/api/projects` endpoint (`MetadataRepository.list_projects()`) returns projects WITHOUT the `datasets` field:
```python
# backend/app/repositories/metadata/repository.py
def _project_to_dict(project: ProjectRecord) -> dict[str, Any]:
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "org_id": project.org_id,
        "created_by": project.created_by,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
        # ← NO "datasets" KEY
    }
```

In contrast, `get_project()` DOES include datasets:
```python
# backend/app/repositories/metadata/repository.py (lines 80-89)
if include_datasets:
    project_dict["datasets"] = [
        {
            "id": ds.id,
            "name": ds.name,
            "link": f"/api/datasets/{ds.id}",
            "description": ds.description,
            "schema_config": ds.schema_config,
        }
        for ds in project.datasets
    ]
```

## Why the Skeleton Shows

### Component Chain
1. **AppShell** (`reverse-proxy/src/lib/ui/components/AppShell/index.tsx`, line 34):
   - Calls `useOrgProjectsQuery()` which fetches `/api/projects`
   - The query succeeds and returns project data (unwrapped by API client)
   - But the returned projects have `undefined` datasets

2. **SideNav** (`reverse-proxy/src/lib/ui/components/SideNav/index.tsx`, line 65):
   - Receives `projects={projects ?? []}` from AppShell
   - When in "org" mode, passes projects to `OrgBody`

3. **OrgBody** (`reverse-proxy/src/lib/ui/components/SideNav/index.tsx`, lines 89-99):
   - **Skeleton condition: `if (projects.length === 0)`**
   - However, since projects are received but with missing `datasets` field
   - The `ProjectNavItem` still renders but with incomplete data
   - The actual rendering of individual items appears to work

### The Real Issue
The condition that shows the skeleton is:
```typescript
// reverse-proxy/src/lib/ui/components/SideNav/index.tsx, lines 89-99
if (projects.length === 0) {
    return (
        <>
            {[1, 2, 3].map((i) => (
                <div key={i} className={styles.skeleton}>
                    <div className={`...skeleton bars...`} />
                </div>
            ))}
        </>
    );
}
```

**This shows the skeleton ONLY when `projects.length === 0`**

## Additional Notes

### API Response Wrapping
The frontend API client unwraps responses at `client.ts` lines 52-54:
```typescript
if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
}
```
So the backend's `wrap_success({ data: [projects] })` is properly unwrapped to just `[projects]`.

### What the User Likely Experiences
If the skeleton is still visible despite successful API calls:
1. The `projects` array is empty (length === 0)
2. OR there's a timing issue where `projects` is `null` and `projects ?? []` evaluates before the query completes
3. OR the query is failing silently and data is not being set

## Solutions

### Option 1: Backend Fix (Include datasets in list_projects)
Modify `MetadataRepository.list_projects()` to optionally include datasets like `get_project()` does.

### Option 2: Frontend Defensive Code
Add fallback `datasets` field in TypeScript when projects are received without it.

### Option 3: Query Hook Improvement
Check `useOrgProjectsQuery` to ensure it properly manages loading/error states.
