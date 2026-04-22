# Tool Call Registry

The chat agent exposes different tool sets depending on the active context. Tools are defined as Zod schemas and passed to Groq's tool-calling API via the Vercel AI SDK.

## Context Routing

| Context | Condition | Tools Available |
|---------|-----------|-----------------|
| **Conversational** | No dataset/view/report active | `resolve_dataset` |
| **Dataset** | Dataset selected, schema available | Table operations + cleaning tools |
| **View** | View selected | View management tools |
| **Report** | Report (mart-layer model) selected | Report CRUD + dimension/measure/filter/join tools |

## Conversational Tools

| Tool | Description |
|------|-------------|
| [resolve_dataset](resolve-dataset.md) | Resolve a dataset by name from conversation |

## Dataset Tools — Table Operations

| Tool | Description |
|------|-------------|
| [filterTable](filter-table.md) | Add a filter condition to the table |
| [replaceColumnFilter](replace-column-filter.md) | Replace all filters on a column |
| [sortTable](sort-table.md) | Sort by a column |
| [addRow](add-row.md) | Add a new row |
| [deleteRow](delete-row.md) | Delete a row by search text |
| [clearFilters](clear-filters.md) | Remove all filters |
| [clearSort](clear-sort.md) | Remove sorting |

## Dataset Tools — Data Cleaning

All cleaning tools (except `renameColumn`) produce a **preview**. Use `applyCleaningTransform` to persist.

| Tool | Description |
|------|-------------|
| [trimWhitespace](trim-whitespace.md) | Trim whitespace from text column |
| [standardizeCase](standardize-case.md) | Standardize text casing |
| [fillNulls](fill-nulls.md) | Fill null values |
| [mapValues](map-values.md) | Map specific values to new values |
| [renameColumn](rename-column.md) | Rename column (applies immediately) |
| [applyCleaningTransform](apply-cleaning-transform.md) | Persist a previewed cleaning operation |
| [undoCleaningTransform](undo-cleaning-transform.md) | Disable or delete a transform |
| [reEnableCleaningTransform](re-enable-cleaning-transform.md) | Re-enable a disabled transform |

## View Tools

| Tool | Description |
|------|-------------|
| [createView](create-view.md) | Create a new view from sources |
| [addColumn](add-column.md) | Add a column from a source |
| [removeColumn](remove-column.md) | Remove a column |
| [addJoin](add-join.md) | Join two sources |
| [removeJoin](remove-join.md) | Remove a join |
| [addFilter](add-filter.md) | Add a view filter |
| [removeFilter](remove-filter.md) | Remove a view filter |
| [renameView](rename-view.md) | Rename the view |
| [deleteView](delete-view.md) | Delete a view |
| [setMaterialization](set-materialization.md) | Set materialization strategy |
| [castColumn](cast-column.md) | Change column display type |
| [setGrain](set-grain.md) | Set time dimension and grain |

## Report Tools

Report tools operate on mart-layer models (dbt fact/dimension entities). Tool names that collide with view tools (e.g. `addFilter`) have report-specific docs prefixed with `report-`.

| Tool | Description |
|------|-------------|
| [createReport](create-report.md) | Create a new report (fact or dimension mart model) |
| [renameReport](rename-report.md) | Rename the report |
| [deleteReport](delete-report.md) | Delete the report |
| [addDimension](add-dimension.md) | Add a dimension column to the report |
| [removeDimension](remove-dimension.md) | Remove a dimension column |
| [addMeasure](add-measure.md) | Add a measure column to the report |
| [removeMeasure](remove-measure.md) | Remove a measure column |
| [addFilter](report-add-filter.md) | Add a WHERE clause to the report SQL |
| [removeFilter](report-remove-filter.md) | Remove a WHERE clause from the report SQL |
| [addJoin](report-add-join.md) | Add a join to another source |
| [removeJoin](report-remove-join.md) | Remove a join |
| [setMaterialization](report-set-materialization.md) | Set the report's materialization strategy |
| [setDomain](set-domain.md) | Set the report's business domain |
| [setReportType](set-report-type.md) | Set report type (fact or dimension) |
| [suggestStructure](suggest-structure.md) | Suggest dimension/measure assignments for source columns |
