# Startup Welcome Handwriting Design

## Goal

Show a centered, Mac-style handwriting welcome moment every time the desktop app starts from a closed state.

## Behavior

- Create a temporary `welcome` Tauri window during app startup.
- The window is transparent, borderless, centered, always on top, and skipped from the taskbar.
- The window renders only the welcome animation, then closes itself after the animation finishes.
- The main pet window continues to initialize normally.
- The welcome text defaults to `Louis`.
- Users can change the text in Settings. Blank text falls back to `Louis`.
- Users can choose between the original colorful handwriting animation and a sequential stroke-order animation.
- Both animation modes use the same system-level always-on-top welcome window and an in-window top-layer root.

## Architecture

- Rust owns the temporary startup window lifecycle.
- Vue owns the welcome page rendering and animation.
- A small frontend utility normalizes welcome text so the setting is predictable and testable.
- The existing config payload gains `personal.startup_welcome_text` and `personal.startup_welcome_mode`.

## Testing

- Add Node unit tests for welcome text normalization.
- Add Rust unit coverage for the default config value.
- Run the focused tests and the frontend build.
