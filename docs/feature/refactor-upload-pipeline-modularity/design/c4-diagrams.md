<!-- DES-ENFORCEMENT : exempt -->
# C4 Diagrams — Refactor Upload Pipeline Modularity

Two Component-level (L3) diagrams (current vs proposed) plus one sequence diagram for the unified dispatcher flow.

L1 (System Context) and L2 (Container) are unchanged by this refactor — see `docs/product/architecture/brief.md` for the canonical container view. This is a use-case-internal modularity refactor; no container or external-system surface changes.

---

## L3 — Current component shape (`create_dataset_from_upload`)

```mermaid
C4Component
  title Component (current) — create_dataset_from_upload use case
  Container_Boundary(uc, "Use case: create_dataset_from_upload (~174 LOC)") {
    Component(orch, "use-case body", "Python (async)", "Inlines plugin dispatch + branches single/multi terminal blocks")
    Component(helper_single, "_create_single_dataset", "module-level helper", "Per-result dataset creation: analyze + record + parquet")
    Component(helper_sync, "_emit_sync_events", "module-level helper", "Conditional DatasetSyncRequested emission")
  }
  Container_Boundary(pipeline, "_pipeline/ingestion.py (healthy, untouched)") {
    Component(fetch, "fetch_upload_event", "fn", "Loads UploadFileReceived event")
    Component(read, "read_raw_file", "fn", "Reads raw bytes from lake")
    Component(analyze, "analyze_dataframe", "fn", "Schema inference + profiling + preview")
    Component(record, "create_dataset_record", "fn", "Persists dataset metadata")
    Component(write, "write_parquet", "fn", "Writes partitioned parquet")
  }
  Container_Boundary(plugins, "app/plugins (plugin contract — untouched)") {
    Component(registry, "PluginRegistry", "class", "Lookup by name and by filename")
    Component(plugin_proto, "FileFormatPlugin (Protocol)", "Protocol", "process(), validate(), detect_choices()")
    Component(csv_fallback, "csv_parser.parse_and_clean_csv", "fn", "No-registry CSV fallback (legacy)")
  }
  ContainerDb_Ext(lake, "LakeRepository", "Port", "S3/MinIO read+write")
  ContainerDb_Ext(outbox, "OutboxRepository", "Port", "Event log + payload merge + mark_processed")
  ContainerDb_Ext(metadata, "MetadataRepository", "Port", "Dataset metadata persistence")
  ContainerDb_Ext(external_access, "ExternalAccessRepository", "Port", "Active engine_node_id lookup")

  Rel(orch, fetch, "Loads event via")
  Rel(orch, read, "Reads raw file via")
  Rel(orch, registry, "Inlined: looks up plugin via")
  Rel(orch, plugin_proto, "Inlined: invokes process() via to_thread+timeout")
  Rel(orch, csv_fallback, "Inlined: fallback when no registry")
  Rel(orch, lake, "Inlined: persists _converted_content via")
  Rel(orch, outbox, "Inlined: update_payload (multi only) + mark_processed")
  Rel(orch, helper_single, "Calls per result")
  Rel(helper_single, analyze, "")
  Rel(helper_single, record, "")
  Rel(helper_single, write, "")
  Rel(orch, helper_sync, "Emits sync events via")
  Rel(helper_sync, external_access, "Queries engine node via")
  Rel(helper_sync, outbox, "Submits sync event via")
  Rel(record, metadata, "Writes dataset record via")
  UpdateRelStyle(orch, registry, $offsetX="-30", $offsetY="-10")
  UpdateRelStyle(orch, plugin_proto, $offsetX="-30", $offsetY="0")
  UpdateRelStyle(orch, csv_fallback, $offsetX="-30", $offsetY="10")
```

**Smell visible above.** The use-case body has direct edges to `PluginRegistry`, `FileFormatPlugin`, `csv_fallback`, AND inline edges to `LakeRepository` (for `_converted_content` persistence) and `OutboxRepository` (for the multi-only `update_payload`). Five separate concerns hanging off one component.

---

## L3 — Proposed component shape (post-refactor)

```mermaid
C4Component
  title Component (proposed) — create_dataset_from_upload + UploadPluginDispatcher
  Container_Boundary(uc, "Use case: create_dataset_from_upload (~110 LOC)") {
    Component(orch_new, "use-case body", "Python (async)", "Linear pipeline: fetch -> read -> dispatch -> for-each create -> guarded terminal block")
    Component(helper_single, "_create_single_dataset", "module-level helper", "Per-result dataset creation (unchanged)")
    Component(helper_sync, "_emit_sync_events", "module-level helper", "Conditional sync emission (unchanged)")
  }
  Container_Boundary(dispatch, "_pipeline/plugin_dispatch.py (NEW, ~80 LOC)") {
    Component(dispatcher, "UploadPluginDispatcher", "class", "Owns plugin lookup, threading+timeout, _converted_content side channel, CSV fallback. Always returns MultiProcessingResult.")
  }
  Container_Boundary(pipeline, "_pipeline/ingestion.py (healthy, untouched)") {
    Component(fetch, "fetch_upload_event", "fn", "")
    Component(read, "read_raw_file", "fn", "")
    Component(analyze, "analyze_dataframe", "fn", "")
    Component(record, "create_dataset_record", "fn", "")
    Component(write, "write_parquet", "fn", "")
  }
  Container_Boundary(plugins, "app/plugins (untouched, validator relaxed)") {
    Component(registry, "PluginRegistry", "class", "Lookup by name and by filename")
    Component(plugin_proto, "FileFormatPlugin (Protocol)", "Protocol", "")
    Component(csv_fallback, "csv_parser.parse_and_clean_csv", "fn", "Fallback (now reached via dispatcher)")
    Component(multi_result, "MultiProcessingResult", "dataclass", "__post_init__ relaxed: name optional when len(results)==1")
  }
  ContainerDb_Ext(lake, "LakeRepository", "Port", "")
  ContainerDb_Ext(outbox, "OutboxRepository", "Port", "")
  ContainerDb_Ext(metadata, "MetadataRepository", "Port", "")
  ContainerDb_Ext(external_access, "ExternalAccessRepository", "Port", "")

  Rel(orch_new, fetch, "Loads event via")
  Rel(orch_new, read, "Reads raw file via")
  Rel(orch_new, dispatcher, "Delegates plugin dispatch to")
  Rel(orch_new, helper_single, "For each result")
  Rel(orch_new, outbox, "Guarded terminal: update_payload if len>1, then mark_processed")
  Rel(orch_new, helper_sync, "Emits sync events via")
  Rel(dispatcher, registry, "Looks up plugin via")
  Rel(dispatcher, plugin_proto, "Invokes process() under to_thread+timeout")
  Rel(dispatcher, csv_fallback, "Fallback when no registry")
  Rel(dispatcher, lake, "Persists _converted_content via")
  Rel(dispatcher, outbox, "Updates converted_storage_path via")
  Rel(dispatcher, multi_result, "Always returns")
  Rel(helper_single, analyze, "")
  Rel(helper_single, record, "")
  Rel(helper_single, write, "")
  Rel(helper_sync, external_access, "")
  Rel(helper_sync, outbox, "")
  Rel(record, metadata, "")
```

**Improvement visible above.** The use-case body now has *one* edge into the dispatch concern (`UploadPluginDispatcher`) and *one* guarded edge into the outbox terminal block. The plugin/CSV/`_converted_content` knowledge has moved entirely into the dispatcher. Five inlined edges in the current shape collapse to one delegated edge in the proposed shape.

---

## Sequence — Unified dispatcher flow (single and multi as one path)

```mermaid
sequenceDiagram
  autonumber
  participant Caller as HTTPController.post_dataset
  participant UC as create_dataset_from_upload
  participant Dispatcher as UploadPluginDispatcher
  participant Registry as PluginRegistry
  participant Plugin as FileFormatPlugin (concrete, e.g. CsvPlugin)
  participant Lake as LakeRepository
  participant Outbox as OutboxRepository
  participant Helper as _create_single_dataset
  participant Sync as _emit_sync_events

  Caller->>UC: create_dataset_from_upload(upload_id, ...)
  UC->>Outbox: fetch_upload_event(upload_id)
  Outbox-->>UC: UploadFileReceived event
  UC->>Lake: read_raw_file(storage_path)
  Lake-->>UC: raw bytes
  UC->>Dispatcher: dispatch(event, raw, choices)

  alt registry present and plugin matches
    Dispatcher->>Registry: get_by_name(plugin_name) || get_for_filename(name)
    Registry-->>Dispatcher: plugin
    Dispatcher->>Plugin: process(raw, name, choices) [to_thread, 120s timeout]
    Plugin-->>Dispatcher: ProcessingResult OR MultiProcessingResult
    opt plugin sets _converted_content
      Dispatcher->>Lake: write_raw_file(converted_path, content)
      Dispatcher->>Outbox: update_payload(converted_storage_path)
    end
  else no registry (legacy CSV fallback)
    Dispatcher->>Dispatcher: parse_and_clean_csv(raw)
  end

  Note over Dispatcher: Always wrap to MultiProcessingResult
  Dispatcher-->>UC: MultiProcessingResult([r0, r1, ...])

  loop for each ProcessingResult in results
    UC->>Helper: _create_single_dataset(result)
    Helper-->>UC: Dataset
  end

  alt len(results) > 1 (preserves today's silent asymmetry)
    UC->>Outbox: update_payload({dataset_ids: [...], dataset_id: first})
  end
  UC->>Outbox: mark_processed([upload_id])
  UC->>Sync: emit_sync_events(project_id, datasets)
  Sync->>Outbox: submit_dataset_sync_event (one per dataset, conditional)

  alt len(datasets) == 1 (preserves external single-shape return)
    UC-->>Caller: Success(dataset)
  else len(datasets) > 1
    UC-->>Caller: Success([dataset, ...])
  end
```

**Three observations from the sequence.**

1. The **internal** dataset-construction loop runs the same number of iterations regardless of single-vs-multi (length-1 loop for single). The branchy `if isinstance(...)` block in the current code disappears.
2. The outbox `update_payload` step is **explicitly guarded** by `len(results) > 1` — preserving today's silent asymmetry rather than silently aligning it. DISTILL adds an absence-assertion test for the single-path case (see design.md §7 risk #1).
3. The **external** return shape is preserved: single-result -> `Success(dataset)`; multi-result -> `Success([dataset, ...])`. The unification is internal pipeline shape only, never reaches `HTTPController.post_dataset`. The latent multi-dataset HTTP-envelope mishandling stays exactly as it is today.
