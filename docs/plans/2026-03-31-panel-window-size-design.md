# Panel Window Size Design

**Date:** 2026-03-31

**Goal:** Persist the current main search panel size so future panel launches reuse that size by default.

## Context

The main search panel is created in `src-tauri/src/lib.rs` with hard-coded `PANEL_WIDTH` and `PANEL_HEIGHT`. The database migration workspace already supports remembered window sizes through config-backed persistence, resize debouncing, and restore-on-create behavior.

## Decisions

1. Reuse the existing database migration window persistence pattern for the main panel window.
2. Save only the normal resized width and height.
3. Ignore maximized size changes so the remembered default stays a regular window size.
4. Clamp persisted values to the existing panel minimum size and monitor bounds when restoring.

## Implementation Notes

- Add a `PanelWindowSize` model to Rust config storage and `AppState`.
- Add sanitizing, defaulting, and restore helpers parallel to the db migration helpers.
- Hook the panel window `Resized` event to a debounced save path.
- Initialize the in-memory cache from loaded config during app startup.

## Verification

- Add unit tests for size sanitization and cache resolution.
- Run focused Rust tests for the new helpers.
