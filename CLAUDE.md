# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DB Scout (鹰捷)** — A Tauri 2 + Vue 3 desktop tool for MySQL database searching, featuring a pixel-art pet widget that expands into a search panel. Chinese-language UI throughout.

## Commands

```bash
# Full dev environment (Vite frontend + Cargo backend)
npm run tauri dev

# Frontend only (Vite on port 1430)
npm run dev

# Frontend build
npm run build

# Production build (NSIS installer)
npm run tauri build

# Run frontend unit tests (Node.js built-in test runner)
node --test src/panelChrome.test.js
node --test src/weatherSkin.test.js
node --test src/syncWorkspace.test.js

# Run all frontend tests
node --test src/*.test.js
```

`npm run tauri dev` auto-triggers `npm run dev`. The `predev` script kills any process on port 1430 before starting.

## Windows MSVC Build Environment

Cargo config at `src-tauri/.cargo/config.toml` sets MSVC linker paths. If you hit `LNK1181: cannot open kernel32.lib`, set these in your shell:

```bash
export LIB="E:\\Program Files (x86)\\ms\\VC\\Tools\\MSVC\\14.44.35207\\lib\\x64;C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.22621.0\\um\\x64;C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.22621.0\\ucrt\\x64"
export INCLUDE="E:\\Program Files (x86)\\ms\\VC\\Tools\\MSVC\\14.44.35207\\include;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\ucrt;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\shared;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\um"
```

## Architecture

### Single-file-heavy design

The codebase intentionally uses very large single files rather than many small modules:
- `src/App.vue` (~80KB) — entire frontend UI, all three window modes in one component
- `src-tauri/src/lib.rs` (~44KB) — all Rust backend logic: Tauri commands, DB operations, search, window management
- `src/styles.css` — all CSS with design system custom properties

### Multi-window structure

Four Tauri windows, all rendered by the same `App.vue` which branches on `getCurrentWindow().label`:

| Window label | Purpose |
|---|---|
| `main` | Floating pixel pet widget (always-on-top, transparent, borderless) |
| `panel` | Main search/results panel (780×860) |
| `pet_menu` | Pet right-click context menu (212×184) |
| `sync_workspace` | Sync workspace panel (760×640) |

`App.vue` uses `isPetWindow`, `isPanelWindow`, `isMenuWindow`, `isSyncWindow` flags to conditionally render the appropriate UI.

### Frontend → Backend communication

All DB/system operations go through Tauri IPC: frontend calls `invoke()` from `@tauri-apps/api/core`, backend handlers are `#[tauri::command]` async functions in `lib.rs`. Search progress and sync progress are pushed back via Tauri events (`listen()`).

Key command groups in `lib.rs`:
- **DB**: `connect_db`, `disconnect_db`, `get_connection_status`, `refresh_schema`
- **Search**: `search` (cancelable with progress events), `cancel_search`
- **Data**: `get_table_data`, `save_table_changes`, `list_tables`
- **Export**: `export_tables_xlsx`, `export_tables_xlsx_batch`
- **Config**: `get_config`, `save_config`
- **Windows**: `show_panel_window`, `hide_panel_window`, `toggle_panel_window`, `show_pet_menu`, `hide_pet_menu`, `show_sync_workspace_window`, etc.
- **Hotkeys**: `register_hotkey`, `register_quick_date_hotkey`, `register_sync_window_hotkey`
- **Pet skins**: `detect_sprite_dimensions`, `import_skin_sprites`, `list_custom_skins`, `delete_custom_skin`
- **Sync**: `run_sync_profile` (in `sync_workspace.rs`)
- **Weather**: `get_weather`

### Rust state management

`AppState` wraps `Arc<tokio::sync::Mutex<RuntimeState>>` in Tauri managed state. `RuntimeState` holds:
- `pool`: `Option<MySqlPool>` (sqlx connection pool)
- `schema_cache`: cached table/column metadata
- `config`: `AppConfig` (persisted to `config.json` in app data dir)
- `registered_hotkey` / `registered_quick_date_hotkey` / `registered_sync_window_hotkey`: currently registered global shortcuts
- `sync_running`: prevents concurrent sync operations

Cancel tokens for search use a separate `AtomicU64` (`cancel_seq`) outside the mutex.

### Frontend state

Vue 3 Composition API (`<script setup>`) with reactive `ref`/`reactive`. No external state management (no Pinia/Vuex). All state lives in `App.vue` component scope.

### Extracted frontend modules

Pure logic extracted from `App.vue` for testability:
- `src/panelChrome.js` — panel tab merging (`buildPanelTabs`), table folder chips, background opacity normalization
- `src/weatherSkin.js` — weather category mapping, skin state resolution, weather presentation (colors/classes per theme+weather)
- `src/weatherEngine.js` — Canvas 2D particle engine for rain/snow/sun/cloud effects (class `WeatherEngine`)
- `src/syncWorkspace.js` — sync profile normalization, hotkey normalization, timeline event reduction

Tests (Node built-in `node:test`) exist for `panelChrome`, `weatherSkin`, and `syncWorkspace`.

### Config persistence

`AppConfig` has two sections: `shared` (DB credentials, search settings, DB templates) and `personal` (UI preferences, hotkeys, pet settings, sync profiles). Serialized as JSON to `config.json` in the Tauri app data directory. Loaded at startup via `get_config`.

## Adding a new Tauri command

1. Define an `async fn` with `#[tauri::command]` in `src-tauri/src/lib.rs`
2. Register it in `.invoke_handler(tauri::generate_handler![...])` (around line 2546)
3. Call from frontend with `invoke('command_name', { args })`
4. If the command needs window permissions, add to `src-tauri/capabilities/default.json`

## Design system

CSS custom properties in `styles.css`:
- `--accent: #0284c7` (primary blue, overridden by theme selection via `UI_THEME_ACCENTS` in `weatherSkin.js`)
- `--bg-panel: rgba(255,255,255,0.98)` with `backdrop-filter: blur(20px)` for frosted glass
- Fonts: `"Noto Sans SC"`, `"Microsoft YaHei"` (Chinese UI)
- `--px: 5px` base spacing unit
- Weather system adds dynamic surface tones, sky classes, and glass mix variables
