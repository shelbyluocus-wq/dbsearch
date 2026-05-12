# Fast Table Grid Design

## Goal

Make full-table browsing feel closer to Excel by removing the current DOM `<table>` rendering bottleneck from the read-only browse path.

## Recommendation

Build a read-first hybrid grid:

- Use Canvas for the high-frequency read-only table viewport: headers, row numbers, cell text, grid lines, highlights, selection, frozen rows, and frozen columns.
- Keep lightweight DOM overlays for scrolling, hit testing, column resizing handles, tooltips, and future focused inputs.
- Keep the current DOM table for edit mode in the first version.

This gives the browsing path the largest performance gain while avoiding a risky rewrite of edit mode.

## Current bottleneck

`src/App.vue` currently renders full-table browsing and editing through the same DOM table. Even after seamless block loading and caching, each visible window still runs many Vue bindings per cell: classes, styles, hit highlighting, find state, freeze state, edit state, and HTML rendering. For a few thousand rows and a dozen columns, this DOM and reactive work dominates the user-visible stutter.

## Scope

### In scope

- Read-only full-table browsing when the table dialog is open, data is expanded, and edit mode is off.
- Vertical and horizontal virtual scrolling.
- Reuse the existing table block cache and `get_table_data` loading path.
- Draw visible rows and visible columns only.
- Preserve current behaviors that matter in browsing:
  - row numbers
  - column headers
  - column width changes
  - frozen row and frozen column display
  - find/highlight indication
  - hit row/cell indication
  - single-cell focus/selection
  - double-click cell viewer
  - context-menu copy row

### Out of scope for first version

- Rewriting edit mode.
- Replacing the bottom text edit panel.
- Multi-cell edit operations in Canvas.
- Persisted whole-table local cache or table hash validation.

## Architecture

Create a small fast-grid module that computes viewport geometry and hit testing from plain inputs. `App.vue` owns application state, data loading, and event wiring. A Vue component or isolated render helper owns Canvas drawing.

Recommended files:

- `src/fastTableGrid.js` — pure geometry helpers for visible rows/columns, scroll dimensions, hit testing, and text clipping inputs.
- `src/fastTableGrid.test.js` — Node tests for the geometry and hit-test helpers.
- `src/App.vue` — chooses fast grid for read-only full-table browsing and keeps the existing DOM table for edit mode.
- `src/styles.css` — container, overlay, and canvas styles.

## Data flow

1. Opening a table still calls the existing `loadTablePage()` / seamless block path.
2. The fast grid reads from `seamlessViewport`, `tableView.columns`, column widths, frozen state, and highlight/find state.
3. On scroll, the grid updates scroll offsets with `requestAnimationFrame` and asks the existing seamless loader for needed blocks.
4. Canvas draws only the rows and columns intersecting the viewport.
5. Pointer events convert screen coordinates to `{ rowIndex, columnName }` using pure hit-test helpers.
6. Cell viewer and row copy reuse existing App.vue actions.

## Rendering model

- One scrollable shell owns the native scrollbar.
- A large inner spacer represents total table width and height.
- Canvas is positioned over the viewport and resized to device pixel ratio.
- Drawing phases:
  1. background
  2. body grid cells
  3. row numbers and headers
  4. frozen panes
  5. highlights/focus/selection
  6. loading indicator overlay when blocks are pending

## Edit-mode boundary

When `editMode` is true, `App.vue` should use the existing DOM table unchanged. This avoids breaking current edit features such as inline input, rectangular selection, copy/paste, undo/redo, insert rows, save dialog, and the bottom text panel.

## Testing

- Add pure unit tests for viewport geometry:
  - visible row range from scrollTop/clientHeight/rowHeight/totalRows
  - visible column range from scrollLeft/clientWidth/column widths
  - frozen row/column partitioning
  - pointer hit testing for body/header/row-number areas
- Add App.vue integration assertions that:
  - fast grid is imported/wired for read-only full view
  - edit mode keeps the existing DOM table path
  - scroll handling stays `requestAnimationFrame` based
- Existing tests must continue passing: `node --test src/*.test.js`.
- Build must pass: `npm run build`.

## Risks

- Canvas text measurement can differ from DOM text layout. Keep first version simple: single-line clipped cells matching current row height.
- High-DPI rendering must scale canvas dimensions by `devicePixelRatio`.
- Frozen panes are easy to get subtly wrong. Test geometry in pure helpers before wiring the UI.
- Manual UI testing in Tauri is required because browser-only Vite cannot fully exercise Tauri APIs.
