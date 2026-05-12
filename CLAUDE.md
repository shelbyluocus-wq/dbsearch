# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DB Scout (鹰捷)** is a Tauri 2 + Vue 3 Windows desktop tool for MySQL database searching. The UI is Chinese-language and centers on a pixel-art pet widget that opens database search, table browsing/editing, sync, migration, update, and settings workspaces.

## Commands

```bash
# Install dependencies
npm install

# Full dev environment (Tauri starts Vite through beforeDevCommand)
npm run tauri dev

# Frontend only (Vite on port 1430; predev also syncs version and clears the port)
npm run dev

# Frontend production build
npm run build

# Preview built frontend
npm run preview

# Production Tauri build / NSIS installer
npm run tauri build

# Signed local Windows build for updater artifacts
npm run build:signed

# Prepare a release version across package/Cargo/Tauri files
npm run release:prepare -- 5.5.9

# Sync version fields without releasing
npm run sync:version
```

### Tests and checks

```bash
# Run all frontend unit tests (Node.js built-in test runner)
node --test src/*.test.js

# Run a single frontend test file
node --test src/tableGridFocus.test.js

# Run script/release helper tests
node --test scripts/*.test.mjs

# Rust tests / compile checks for the Tauri backend
cd src-tauri && cargo test
cd src-tauri && cargo check

# Optional OCR feature check if touching OCR-gated code
cd src-tauri && cargo check --features ocr
```

The README says basic validation is `npm run build` plus `cargo test`. `npm run tauri dev` invokes Tauri's `beforeDevCommand`, which runs `npm run dev`; the `predev` script runs `scripts/sync-version.mjs` and kills any process already listening on port 1430.

## Windows MSVC Build Environment

Cargo config at `src-tauri/.cargo/config.toml` sets MSVC linker paths. If Windows Rust builds fail with `LNK1181: cannot open kernel32.lib`, set `LIB` and `INCLUDE` to the installed Visual Studio Build Tools / Windows SDK paths. The README lists required components: Visual Studio Build Tools 2022, `Desktop development with C++`, `MSVC v143`, and Windows 10/11 SDK.

## Architecture

### Single-file-heavy design

This codebase intentionally keeps the main UI and backend in large files, with pure frontend logic extracted only where it improves testability:

- `src/App.vue` — the main Vue component for all window modes and most live UI state.
- `src/styles.css` — global visual system, pixel pet styling, panel styles, and weather/theme variables.
- `src-tauri/src/lib.rs` — primary Tauri backend: commands, MySQL search/data operations, config, updater/window/hotkey/pet/system/weather logic.
- `src-tauri/src/sync_workspace.rs` — sync profile execution.
- `src-tauri/src/db_migration.rs` — DB migration logic.

### Multi-window structure

Tauri has one configured startup window (`main`) and creates the other windows dynamically. All windows render the same `App.vue`, which branches by `getCurrentWindow().label` using flags such as `isPetWindow`, `isPanelWindow`, `isMenuWindow`, `isSyncWorkspaceWindow`, `isWelcomeWindow`, `isUpdateAnnouncementWindow`, and `isDbMigrationWorkspaceWindow`.

| Window label | Purpose |
|---|---|
| `main` | Floating transparent pixel pet widget |
| `welcome` | Startup welcome screen |
| `update_announcement` | Update announcement popup |
| `panel` | Main search/results/table panel |
| `pet_menu` | Pet right-click context menu |
| `sync_workspace` | Sync workspace panel |
| `db_migration_workspace` | DB migration workspace panel |

### Frontend/backend communication

Frontend code calls Tauri commands with `invoke()` from `@tauri-apps/api/core`; backend handlers are `#[tauri::command]` functions registered in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`. Search and sync progress are pushed back to the frontend with Tauri events and `listen()`.

Main backend command groups include:

- DB connection/schema/search/table data/export commands.
- Config persistence and UI preference commands.
- Window show/hide/toggle and pet positioning/hitbox commands.
- Global hotkey registration commands.
- Sync workspace and DB migration commands.
- Updater, autostart, weather, custom skin, and system integration commands.

When adding a new Tauri command:

1. Define the async command function with `#[tauri::command]`.
2. Register it in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
3. Call it from the frontend with `invoke('command_name', { args })`.
4. If the command needs permissions, update `src-tauri/capabilities/default.json`.

### Rust state management

`AppState` wraps shared runtime state in `Arc<tokio::sync::Mutex<RuntimeState>>`. `RuntimeState` holds the MySQL pool, schema cache, persisted `AppConfig`, registered global shortcuts, and sync-running guard. Search cancellation uses a separate `AtomicU64` cancel sequence outside the mutex.

`AppConfig` is persisted as JSON in the Tauri app data directory and is split into `shared` database/search settings and `personal` UI/hotkey/pet/sync preferences.

### Frontend state and extracted modules

`App.vue` uses Vue 3 Composition API (`ref`/`reactive`) with no Pinia/Vuex. Extracted `src/*.js` modules contain pure logic covered by `node:test`; keep UI side effects in `App.vue` and prefer putting reusable deterministic logic in these modules when it is testable.

Important extracted areas include:

- Panel chrome, settings modal, startup welcome, update manager, app identity/version.
- Weather/skin presentation and `WeatherEngine` canvas particles.
- Sync workspace/center state helpers.
- DB migration workspace helpers.
- Pet menu and quick paste helpers.
- Table dialog layout, data cache, seamless scroll, freeze columns, tab order/drag, column collapse, cell viewer.
- Edit-mode helpers for navigation, row selection, rectangular ranges, text panel, changes, cell click editing, batch import, find/search, fast table grid behavior.

### Edit mode grid model

Edit mode in `App.vue` has a Navicat-style cell focus and rectangular range layer on top of row selection:

- `gridFocus`: focused page/insert cell.
- `gridRange`: rectangular selection with anchor/head in one row kind.
- `editingCell`: current in-place editor.
- `editChanges`: pending updates/inserts/deletes.
- `editSelectedRows`: row-level selection stored as a `Ref<Set>` with whole-set replacement so checkbox bindings rerender.
- `textPanel*`: F4 bottom text panel state.

`handleGridFocusKeydown(event)` is the main edit-mode keyboard dispatcher and runs early from the global window keydown handler after modal/dialog bailouts.

## Release and updater notes

The app uses Tauri updater with Gitee as the configured endpoint in `src-tauri/tauri.conf.json`. `npm run build:signed` reads the local updater private key from `C:\Users\Administrator\.tauri\dbsearch.key` and may read `dbsearch.key.password` beside it. Do not commit local signing keys or passwords.

`npm run release:prepare -- <version>` synchronizes version data across `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` when applicable, and Tauri title/product fields. Release tags should match the code version, e.g. code `5.5.9` uses tag `v5.5.9`.

## Design system

The visual system is defined through CSS custom properties in `src/styles.css`, with `--accent` overridden by theme selection via `UI_THEME_ACCENTS` in `src/weatherSkin.js`. The UI uses Chinese fonts such as `Noto Sans SC` and `Microsoft YaHei`, frosted glass panels, `--px` as a base spacing unit, and weather-driven surface/sky variables.