# Design Sources — Pipeline Layers UI Redesign

The design handoff bundles are **not committed to this repo** (they're large binary archives — prototype HTML/CSS/JS, full chat transcripts, 100+ screenshots, plus a snapshot of real frontend components). Worker agents **pull them on demand** into a temp folder when implementing/refactoring, and discard them after.

## Links

| Bundle | Role | Link |
|---|---|---|
| **Remix** (production target) | Neobrutalist + Comic assistant / Solarized-dark TUI; adds cold storage, dark mode, detached upload. **This is the design we are building.** | `https://api.anthropic.com/v1/design/h/_ecyoU4WhCT47E-q1FnkfQ?open_file=dashboard-chat-layers%2FDashboard+Chat+-+Layers.html` |
| **Base** | The "Studio" (warm) design the remix forked from — the validated core behaviors before the aesthetic exploration. Reference only. | `https://api.anthropic.com/v1/design/h/WDcqA6U2rnbOUV3sN2D-sw` |

The locked production direction (single Neobrutalist aesthetic, retained Studio behaviors) is recorded in `path-forward.md` §9. Read that first; pull the bundles only when you need pixel-level detail.

## How a worker agent pulls a bundle

Plain `curl`/`wget` returns `404 not found` for these links — they are only retrievable via the **WebFetch tool**, which downloads the response and saves the raw bytes to the session's `tool-results/` directory.

1. Call **WebFetch** on the link (any prompt — the content is binary so the answer text is irrelevant). The tool result ends with a line like:
   `Binary content (application/gzip, 2.6MB) also saved to <abs-path>/tool-results/webfetch-<ts>-<rand>.bin`
   Note that `.bin` path.
2. Extract it into a temp folder:
   ```bash
   mkdir -p /tmp/design-pull && cd /tmp/design-pull
   cp "<abs-path-from-step-1>.bin" bundle.gz
   gunzip -f bundle.gz            # -> POSIX tar archive named "bundle"
   mkdir -p out && tar -xf bundle -C out
   find out -type f | grep -vE '/(screens|uploads)/'   # source files (skip the screenshots)
   ```
3. The extracted tree (remix shown; base omits `upload.*` and `themes.css`):
   - `*/README.md` — handoff instructions ("recreate visual output, don't copy prototype structure").
   - `*/chats/chat1.md` — the full designer↔user transcript (the intent lives here).
   - `*/project/dashboard-chat-layers/` — the **throwaway prototype** (`app.jsx`, `data.js`, `lineage.jsx`, `detail.jsx`, `chat.jsx`, `upload.jsx`, `ui.jsx`, `tweaks-panel.jsx`, `theme.css`, `themes.css`, `lineage.css`, `detail.css`, `chat.css`, `upload.css`, `Dashboard Chat - Layers.html`).
   - `*/project/frontend/` — a **point-in-time snapshot of real repo components** the designer imported (`ChatView`, `OrgView`, `DatasetView`+`SchemaTable`/`DatasetCarousel`/`Breadcrumb`, `ReportDetailView`, `app/root.tsx`, etc.). These mirror live paths under `frontend/src/ui/components/` — **the live repo is authoritative; treat the snapshot as reference only (it may be stale).**
   - `*/project/screens/` — 100+ reference screenshots (per the README, don't open unless source dimensions/colors are insufficient).

Discard `/tmp/design-pull` when done — nothing from the bundle should be committed.
