# Pet Drag Run Design

## Goal

Make the floating Jiedi pet behave like Codex while dragged: it should play running frames for the whole drag gesture, with left/right direction following movement.

## Current State

The project already has the Codex-style 8x9 pet atlas, Jiedi sprite sheet, frame timing, Tauri drag start, window moved listener, and `resolvePetState()`. Dragging currently falls back to `jumping` when no immediate left/right direction is available, so the pet can stop looking like it is running during drag.

## Approach

Use the existing atlas and animation loop. Treat dragging as a high-priority pet state that always resolves to a run animation:

- Active movement to the left uses `running-left`.
- Active movement to the right uses `running-right`.
- If the pointer is still held but movement direction is temporarily unavailable, keep the last known drag facing.
- If there is no previous facing, default to `running-right`.

This keeps the change small and compatible with the current incomplete pet system.

## Components

- `src/petAtlas.js`: normalize drag direction and map drag state to Codex run rows.
- `src/petAtlas.test.js`: cover the no-direction and last-direction drag cases.
- `src/App.vue`: remember the last drag facing while the Tauri window emits move events.

## Testing

Run the focused pet atlas tests first, then the full frontend test suite if practical. The focused regression should fail before implementation because dragging without a direction currently returns `jumping`.
