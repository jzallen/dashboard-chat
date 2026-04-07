# Tool Call Registry

The chat agent exposes different tool sets depending on the active context. Tools are defined as Zod schemas and passed to Groq's tool-calling API.

## Context Routing

| Context | Condition | Tools Available |
|---------|-----------|-----------------|
| **Conversational** | No dataset/view active | `resolve_dataset` |
| **Dataset** | Dataset selected, schema available | Table + cleaning tools |
| **View** | View selected | View management tools |

## Conversational Tools

### `resolve_dataset`
Resolve a dataset by name when the user references one in conversation without an active context.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Dataset name the user is referring to |

The frontend intercepts this tool call via SSE stream transformation, searches for a matching dataset, and resubmits the request with the resolved schema.

## Dataset Tools — Table Operations

### `filterTable`
Add a filter condition to the table.

| Parameter | Type | Description |
|-----------|------|-------------|
| `column` | enum (column IDs) | Column to filter by |
| `operator` | enum | `equals`, `notEquals`, `contains`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `between` |
| `value` | any | Comparison value. Array of two numbers for `between`. |

### `replaceColumnFilter`
Replace all existing filters on a column with new conditions. Preserves filters on other columns.

| Parameter | Type | Description |
|-----------|------|-------------|
| `column` | enum (column IDs) | Column to replace filters on |
| `filters` | array | Array of `{operator, value}` objects |

### `sortTable`
Sort the table by a column.

| Parameter | Type | Description |
|-----------|------|-------------|
| `column` | enum (column IDs) | Column to sort by |
| `direction` | enum | `asc` or `desc` |

### `addRow`
Add a new row to the table.

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | object | Key-value pairs matching column IDs |

### `deleteRow`
Delete a row by searching for matching text across all columns.

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Text to match against any column value |

### `clearFilters`
Remove all active filters. No parameters.

### `clearSort`
Remove current sorting. No parameters.

## Dataset Tools — Data Cleaning

All cleaning tools (except `renameColumn`) produce a **preview** — they must be paired with `applyCleaningTransform` to persist the change.

### `trimWhitespace`
Trim leading and trailing whitespace from a text column.

| Parameter | Type | Description |
|-----------|------|-------------|
| `column` | enum (text columns) | Column to trim |

### `standardizeCase`
Standardize text casing in a column.

| Parameter | Type | Description |
|-----------|------|-------------|
| `column` | enum (text columns) | Column to standardize |
| `mode` | enum | `upper`, `lower`, `title`, `snake`, `kebab` |

### `fillNulls`
Fill null or empty values with a specified value.

| Parameter | Type | Description |
|-----------|------|-------------|
| `column` | enum (column IDs) | Column to fill |
| `fillValue` | string | Replacement value |

### `mapValues`
Map specific values to new values (exact match replacement).

| Parameter | Type | Description |
|-----------|------|-------------|
| `column` | enum (text columns) | Column to map |
| `mappings` | array | Array of `{from, to}` objects |

### `renameColumn`
Rename a column's display name (creates an alias). Applies immediately without preview.

| Parameter | Type | Description |
|-----------|------|-------------|
| `column` | enum (column IDs) | Column to rename |
| `newName` | string | New display name |

### `applyCleaningTransform`
Persist a previously previewed cleaning operation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `column` | enum (column IDs) | Target column |
| `operation` | enum | `trim`, `upper`, `lower`, `title`, `snake`, `kebab`, `fill_null`, `map_values` |
| `config` | object | Operation configuration |

### `undoCleaningTransform`
Undo a cleaning transform by disabling or deleting it.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | enum | `disable` (reversible) or `delete` (permanent) |
| `transformId` | string? | Target transform ID, or most recent if omitted |

### `reEnableCleaningTransform`
Re-enable a previously disabled transform.

| Parameter | Type | Description |
|-----------|------|-------------|
| `transformId` | string? | Target transform ID, or most recently disabled if omitted |

## View Tools

### `createView`
Create a new view from source datasets/views.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | View name |
| `sourceRefs` | string[] | Source dataset/view names |
| `description` | string? | Optional description |

### `addColumn`
Add a column to the view from a source.

| Parameter | Type | Description |
|-----------|------|-------------|
| `sourceRef` | string | Source name |
| `sourceColumn` | string | Column in source |
| `displayType` | enum | `text`, `category`, `id`, `serial`, `integer`, `decimal`, `boolean`, `date`, `time`, `datetime` |
| `alias` | string? | Optional display alias |

### `removeColumn`
Remove a column from the view.

| Parameter | Type | Description |
|-----------|------|-------------|
| `columnName` | string | Column to remove |

### `addJoin`
Add a join between sources.

| Parameter | Type | Description |
|-----------|------|-------------|
| `rightRef` | string | Right-side source |
| `leftColumn` | string | Left join column |
| `rightColumn` | string | Right join column |
| `joinType` | enum? | `INNER`, `LEFT`, `RIGHT`, `FULL` (default: INNER) |

### `removeJoin`
Remove a join by right-side source name.

### `addFilter` / `removeFilter`
Add or remove filter conditions on the view.

### `renameView`
Rename the current view.

### `deleteView`
Delete a view by ID.

### `setMaterialization`
Set materialization strategy: `view`, `table`, `ephemeral`, or `incremental`.

### `castColumn`
Change a column's display type.

### `setGrain`
Set the view's grain (time dimension + grouping dimensions).

| Parameter | Type | Description |
|-----------|------|-------------|
| `timeColumn` | string | Time-typed column |
| `dimensions` | string[] | Dimension columns |
