## Context

The platform's upload pipeline is currently hardcoded for CSV: `upload_file.py` validates `.csv` extension, calls `parse_and_clean_csv()` (pandas), then `create_dataset_from_upload` runs schema inference, column profiling, and Parquet conversion via DuckDB. The pipeline is split into two atomic steps chained in a single `POST /api/uploads` request, with outbox event sourcing (`UploadFileReceived`) tracking state.

The codebase already uses Protocol-based plugin patterns (`AuthProvider` in `backend/app/auth/provider.py`) with config-driven factory selection, and dependency injection via `RepositoryContainer` with lazy loading and test overrides. The design extends these patterns to file format processing.

The requirements doc (`docs/requirements/file-format-plugin-system.md`) poses five open questions. This design resolves each.

## Goals / Non-Goals

**Goals:**
- Define a `FileFormatPlugin` Protocol with minimal required surface and optional extension points
- Answer all five open questions from the requirements (discovery, interactive processing, extension conflicts, resource limits, platform access)
- Design a generic ingestion pipeline that delegates format-specific work to plugins while keeping storage, profiling, and metadata in the platform
- Maintain backward compatibility — CSV behavior is identical after refactoring into a plugin
- Keep plugins testable in isolation without platform dependencies

**Non-Goals:**
- Plugin marketplace, packaging, or distribution — plugins are Python modules in the codebase
- Hot-reload or runtime plugin registration — startup only
- Streaming/incremental processing — plugins receive complete file bytes
- Content-based format detection — extension-based routing only
- Frontend plugins or client-side processing

## Decisions

### D1: Plugin Protocol — Pure Functions Returning Data

**Decision**: Plugins are pure data processors. They receive file bytes (and optional user choices) and return a pandas DataFrame. They do NOT receive platform services (no LakeRepository, no metadata access).

**Rationale**: The requirements state "The plugin is only responsible for step 1 (DataFrame production)." Giving plugins access to platform internals would create coupling, complicate testing, and expand the security surface. The platform handles storage, profiling, metadata, and Parquet conversion generically after the plugin produces its DataFrame.

**Alternative considered**: Context object with platform services (like RepositoryContainer injection). Rejected because it violates isolation (NFR-1), complicates testing (NFR-2), and is unnecessary — no plugin needs to write to S3 or query metadata.

**Protocol shape**:
```python
class FileFormatPlugin(Protocol):
    name: str
    extensions: list[str]  # e.g., [".csv"]

    def validate(self, file_content: bytes, filename: str) -> None:
        """Raise ValidationError if file is invalid."""
        ...

    def detect_choices(self, file_content: bytes, filename: str) -> list[PluginChoice] | None:
        """Return choices the user must make, or None if processing can proceed directly."""
        ...

    def process(self, file_content: bytes, filename: str, choices: dict[str, str] | None = None) -> ProcessingResult:
        """Convert file bytes to tabular data. Receives user choices if detect_choices returned any."""
        ...
```

Where `ProcessingResult` is:
```python
@dataclass
class ProcessingResult:
    df: pd.DataFrame
    schema_hints: dict[str, str] | None = None        # Override type inference
    default_transforms: list[dict] | None = None       # Auto-apply transforms
    dbt_macros: dict[str, str] | None = None           # {"macro_name": "sql_body"}
    chat_guidance: str | None = None                    # Injected into LLM context
```

### D2: Plugin Discovery — Explicit Registration in a Registry Module

**Decision**: Plugins are registered explicitly in a `backend/app/plugins/__init__.py` registry module. No magic scanning, no entry points.

**Rationale**: This project is a small-team product. Entry points and file-scanning add complexity for discoverability that isn't needed when all plugins live in the same codebase. Explicit registration is readable, debuggable, and follows the `RepositoryContainer` pattern where available implementations are listed in a dict.

**Alternative considered**:
- Python entry points (`importlib.metadata`) — overkill for in-tree plugins, harder to debug
- File-based scanning (`importlib.import_module` on `plugins/` directory) — implicit, easy to break with naming changes
- Config-based (`PLUGINS=csv,excel` in env vars) — unnecessary indirection for built-in plugins

**Registry shape**:
```python
class PluginRegistry:
    _plugins: dict[str, FileFormatPlugin]  # extension → plugin instance
    _by_name: dict[str, FileFormatPlugin]  # plugin name → plugin instance

    def __init__(self, plugins: list[FileFormatPlugin]):
        # Validate no extension conflicts, build lookup maps
        ...

    def get_for_extension(self, ext: str) -> FileFormatPlugin | None: ...
    def supported_extensions(self) -> list[str]: ...
    def get_by_name(self, name: str) -> FileFormatPlugin | None: ...

def create_plugin_registry() -> PluginRegistry:
    """Factory function called at app startup. Explicit registration."""
    return PluginRegistry([
        CsvPlugin(),
        ExcelPlugin(),
        Hl7v2Plugin(),
        FhirPlugin(),
    ])
```

The registry instance is created once in `main.py` lifespan and stored in `app.state.plugin_registry`. Use cases receive it as a parameter from the router/controller layer.

### D3: Interactive Processing — Two-Phase Protocol (detect_choices → process)

**Decision**: Interactive processing uses a two-phase model: `detect_choices()` inspects the file and returns required user choices (if any), then `process()` receives the file plus the user's selections. The platform mediates the chat interaction between phases.

**Rationale**: This avoids coroutines, callbacks, or state machines. Each method is a pure function. The platform owns the chat UX and simply passes choices back to the plugin. This maps cleanly onto the existing two-step upload flow (upload → create dataset), extending it to a three-step flow when choices are needed (upload → choose → create dataset).

**Alternative considered**:
- Coroutine yield — elegant but complex to serialize across HTTP requests, breaks the request-per-step model
- Callback/webhook — over-engineered, plugins would need to know about the chat system
- State machine enum — rigid, hard to extend with new choice types

**Choice model**:
```python
@dataclass
class PluginChoice:
    key: str                    # e.g., "sheet_name", "resource_type"
    label: str                  # "Select a sheet to import"
    options: list[str]          # ["Sheet1", "Sheet2", "Sheet3"]
```

**Upload flow with choices**:
1. `POST /api/uploads` — file uploaded, plugin.validate(), plugin.detect_choices()
2. If choices exist: return upload with `status: "awaiting_input"` + choice definitions
3. Frontend renders choices in chat, user selects
4. `POST /api/uploads/{id}/process` — new endpoint, sends `{"choices": {"sheet_name": "Sheet2"}}`
5. Plugin.process() called with choices → DataFrame → normal pipeline continues

For single-choice formats (CSV), `detect_choices()` returns `None` and processing proceeds immediately in step 1 — no behavioral change from today.

### D4: Extension Conflict Resolution — First-Registered Wins, Startup Error on Conflict

**Decision**: The registry raises a startup error if two plugins claim the same extension. No priority system, no runtime resolution. Conflicts are developer errors caught at boot time.

**Rationale**: With only 4 built-in plugins and no third-party distribution, conflicts are bugs, not features. The FHIR `.json` conflict (mentioned in requirements) is resolved by NOT registering `.json` as a FHIR extension — instead, FHIR uses `.ndjson` and `.fhir.json` (compound extension). Plain `.json` remains unclaimed.

If a future generic JSON plugin is needed, the registry can be extended with a priority parameter. But YAGNI — don't design for hypothetical conflicts.

**FHIR extension handling**: `.ndjson` (NDJSON bundles) and `.fhir.json` (single bundles). This avoids hijacking the generic `.json` extension.

### D5: Processing Resource Limits — Async with Timeout, No Memory Caps

**Decision**: Plugin processing runs in `asyncio.to_thread()` (already the pattern for CSV parsing) with a configurable timeout (default 120s). No memory caps — we rely on pandas/openpyxl natural limits and container-level OOM protection.

**Rationale**: The platform already runs CPU-bound parsing in a thread pool. Adding a timeout protects against hung parsers. Memory caps would require multiprocessing (separate address space) which is disproportionate complexity for the current scale. Container memory limits are the appropriate backstop.

**Timeout implementation**: `asyncio.wait_for(asyncio.to_thread(plugin.process, ...), timeout=settings.plugin_timeout)`

### D6: dbt Macro Contribution — Collected at Export Time via Registry

**Decision**: When exporting a dbt project, the generator queries the plugin registry for all plugins that define `dbt_macros`. These are merged into the `macros/` directory alongside the existing utility macros.

**Rationale**: Macros are static SQL strings. There's no need for complex contribution mechanisms — the registry already holds all plugin instances, and `ProcessingResult.dbt_macros` captures format-specific macros at processing time. For export, we also collect any macros defined as class-level attributes on the plugin (for macros that are always relevant, not just per-file).

**Plugin-level macros** (always included when plugin is registered):
```python
class Hl7v2Plugin:
    name = "hl7v2"
    extensions = [".hl7"]
    dbt_macros = {
        "parse_hl7_segment": "CREATE MACRO parse_hl7_segment(msg, seg) AS ..."
    }
```

### D7: Chat Guidance — Injected into Dataset's Column Profiles

**Decision**: Plugin-provided `chat_guidance` (a string) is stored alongside the dataset's `column_profiles` in a new `format_context` field on the `DatasetRecord`. The chat system's prompt builder already injects column profiles — it will additionally inject `format_context` when present.

**Rationale**: No new infrastructure needed. The column profiling system already provides LLM context per-dataset. Adding a field for plugin-contributed context is the minimal extension.

**Schema change**: Add nullable `format_context: Text` column to `datasets` table (Alembic migration). No breaking change — existing datasets have `NULL`.

### D8: Frontend Format Discovery — New `GET /api/formats` Endpoint

**Decision**: New lightweight endpoint returns registered plugin metadata (name, extensions, labels). The upload widget fetches this once and caches it to build the dynamic file input `accept` attribute.

**Rationale**: The frontend shouldn't hardcode format knowledge. A single API call at widget mount time is negligible overhead and keeps the frontend decoupled from backend plugin configuration.

**Response shape**:
```json
{
  "formats": [
    {"name": "csv", "extensions": [".csv"], "label": "CSV"},
    {"name": "excel", "extensions": [".xlsx", ".xls"], "label": "Excel"},
    {"name": "hl7v2", "extensions": [".hl7"], "label": "HL7v2"},
    {"name": "fhir", "extensions": [".ndjson", ".fhir.json"], "label": "FHIR"}
  ]
}
```

### D9: Package Structure

```
backend/app/plugins/
    __init__.py          # PluginRegistry, create_plugin_registry(), get_plugin_registry()
    protocol.py          # FileFormatPlugin Protocol, ProcessingResult, PluginChoice
    csv_plugin.py        # CsvPlugin (extracted from csv_parser.py)
    excel_plugin.py      # ExcelPlugin
    hl7v2_plugin.py      # Hl7v2Plugin
    fhir_plugin.py       # FhirPlugin
```

Each plugin file is self-contained with its parsing library dependency. The protocol module has zero external dependencies beyond pandas.

## Risks / Trade-offs

**[FHIR `.json` exclusion]** FHIR bundles commonly use plain `.json` extension. Requiring `.fhir.json` or `.ndjson` adds friction for healthcare users.
-> Mitigation: Document clearly in upload dialog. If users demand `.json` support, add a content-sniffing fallback (check for `"resourceType"` key) as a future enhancement.

**[Large file processing]** Excel files with 100k+ rows or large FHIR bundles may timeout or OOM.
-> Mitigation: 120s timeout with clear error message. Container memory limits as backstop. Future: chunked processing or file size limits per format.

**[HL7v2 library maturity]** Python HL7v2 libraries (`hl7apy`, `python-hl7`) vary in quality and maintenance.
-> Mitigation: Evaluate both during implementation. `hl7apy` is more feature-complete but heavier. `python-hl7` is simpler. The plugin interface means we can swap libraries without changing the platform.

**[Two-phase upload adds API complexity]** The `detect_choices → process` flow adds a new endpoint and state management for "awaiting_input" uploads.
-> Mitigation: The outbox pattern already tracks upload state. The new endpoint is a thin layer over the existing `create_dataset_from_upload` use case. For non-interactive formats (CSV), the flow is unchanged — single request, no new endpoint needed.

**[Alembic migration for format_context]** Adding a column to `datasets` requires a migration. Low risk — it's a nullable text column.
-> Mitigation: Standard `ALTER TABLE ADD COLUMN` migration. No data backfill needed.

**[Breaking change: upload validation]** `POST /api/uploads` will accept non-CSV files. Any clients hardcoding CSV assumptions could break.
-> Mitigation: Only the frontend calls this endpoint. The change is coordinated. The response shape doesn't change.

## Migration Plan

1. **Phase 1 — Plugin infrastructure**: Create `backend/app/plugins/` package with protocol, registry, and CsvPlugin. Wire registry into app startup. Refactor `upload_file.py` and `ingestion.py` to use registry. All existing CSV behavior preserved — zero user-facing change.

2. **Phase 2 — Interactive processing**: Add `detect_choices` to protocol, add `POST /api/uploads/{id}/process` endpoint, add `awaiting_input` upload status. CsvPlugin returns no choices (backward compatible). Frontend wired to handle choice rendering.

3. **Phase 3 — New format plugins**: Add ExcelPlugin, Hl7v2Plugin, FhirPlugin. Add `GET /api/formats` endpoint. Update UploadWidget to fetch formats dynamically. Add `format_context` migration.

4. **Phase 4 — dbt macro integration**: Extend `generate_macros_sql()` to collect from registry. Add plugin-level `dbt_macros` to HL7v2 plugin.

Each phase is independently deployable. Phase 1 is the critical refactor — if it breaks, rollback is straightforward since CSV behavior is unchanged.

## Open Questions

- **HL7v2 segment mapping**: Which segments/fields to flatten by default (PID, PV1, OBX, MSH)? Needs healthcare domain input. Start with MSH + PID + PV1 as defaults, let users request more via chat.
- **FHIR flattening depth**: How deeply to unnest nested FHIR resources (e.g., Patient.name[0].given[0])? Start with top-level fields + one level of nesting with dot-notation column names.
- **Upload size limits**: Should plugins declare max file sizes? Currently no limit exists for CSV either. Defer to infrastructure-level limits (nginx/cloudflare body size).
