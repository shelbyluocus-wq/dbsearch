# Excel-style Column Resize Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an Excel-like horizontal resize cursor whenever the pointer is near any resizable field/header boundary.

**Architecture:** Reuse the app's existing resize handles for DOM tables and the existing `hitTestFastGridColumnResize()` helper for the canvas fast grid. Add a small pure helper for cursor decisions so the canvas behavior is testable without browser APIs, then wire it into `App.vue` pointer movement.

**Tech Stack:** Vue 3 Composition API in `src/App.vue`, CSS in `src/styles.css`, pure JavaScript helpers/tests with Node's built-in `node:test` runner.

---

## File Structure

- Modify `src/fastTableGrid.js`: add `resolveFastGridColumnResizeCursor()` beside `hitTestFastGridColumnResize()`.
- Modify `src/fastTableGrid.test.js`: add tests for edge and non-edge cursor decisions.
- Modify `src/App.vue`: import the new helper and add `@pointermove` / `@pointerleave` handlers on the fast grid viewport.
- Modify `src/styles.css`: make DOM resize handles slightly easier to hit while keeping the same visual surface.

---

### Task 1: Add testable fast-grid resize cursor decision

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify: `src/fastTableGrid.js`

- [ ] **Step 1: Write the failing tests**

Update the import block at the top of `src/fastTableGrid.test.js` to include `resolveFastGridColumnResizeCursor`:

```js
import {
  buildFastGridDrawModel,
  buildFastGridScrollSize,
  getVisibleFastGridColumns,
  getVisibleFastGridRows,
  hitTestFastGrid,
  hitTestFastGridColumnResize,
  resolveFastGridCellScrollTarget,
  resolveFastGridColumnResizeCursor,
  truncateFastGridText,
} from "./fastTableGrid.js";
```

Add these tests immediately after the existing `hitTestFastGridColumnResize detects header resize handles` test:

```js
test("resolveFastGridColumnResizeCursor returns col-resize on header edges", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }];

  assert.equal(
    resolveFastGridColumnResizeCursor({
      x: 130,
      y: 18,
      scrollLeft: 0,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
      handleWidth: 6,
    }),
    "col-resize",
  );
});

test("resolveFastGridColumnResizeCursor returns default outside header edges", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }];

  assert.equal(
    resolveFastGridColumnResizeCursor({
      x: 90,
      y: 18,
      scrollLeft: 0,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
      handleWidth: 6,
    }),
    "default",
  );
  assert.equal(
    resolveFastGridColumnResizeCursor({
      x: 130,
      y: 40,
      scrollLeft: 0,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
      handleWidth: 6,
    }),
    "default",
  );
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL because `resolveFastGridColumnResizeCursor` is not exported from `src/fastTableGrid.js`.

- [ ] **Step 3: Add the minimal helper**

Add this function in `src/fastTableGrid.js` immediately after `hitTestFastGridColumnResize()`:

```js
export function resolveFastGridColumnResizeCursor(options = {}) {
  return hitTestFastGridColumnResize(options) ? "col-resize" : "default";
}
```

- [ ] **Step 4: Run the targeted test and verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS for all tests in `src/fastTableGrid.test.js`.

- [ ] **Step 5: Commit this task**

Only commit if the user has explicitly authorized commits in the current session. If authorized, run:

```bash
git add src/fastTableGrid.js src/fastTableGrid.test.js
git commit -m "feat: add fast grid resize cursor helper"
```

---

### Task 2: Wire fast-grid pointer cursor behavior

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Update the fast-grid import**

In `src/App.vue`, update the import from `./fastTableGrid.js` so it includes `resolveFastGridColumnResizeCursor`:

```js
import {
  buildFastGridDrawModel,
  buildFastGridScrollSize,
  getVisibleFastGridColumns,
  getVisibleFastGridRows,
  hitTestFastGrid,
  hitTestFastGridColumnResize,
  resolveFastGridCellScrollTarget,
  resolveFastGridColumnResizeCursor,
  truncateFastGridText,
} from "./fastTableGrid.js";
```

- [ ] **Step 2: Add cursor update handlers**

In `src/App.vue`, add these functions immediately after `resolveFastTableGridHit(event)`:

```js
function setFastTableGridCursor(cursor) {
  const viewport = fastTableGridViewportRef.value;
  if (viewport instanceof HTMLElement) viewport.style.cursor = cursor;
}

function onFastTableGridPointerMove(event) {
  const viewport = fastTableGridViewportRef.value;
  if (!(viewport instanceof HTMLElement)) return;
  const rect = viewport.getBoundingClientRect();
  setFastTableGridCursor(resolveFastGridColumnResizeCursor({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    scrollLeft: fastTableGridScroll.left,
    headerHeight: TABLE_HEADER_HEIGHT,
    rowNumberWidth: TABLE_ROW_HANDLE_WIDTH,
    columns: tableView.columns,
    getColumnWidth,
    fallbackColumnWidth: TABLE_COLUMN_WIDTH_FALLBACK,
  }));
}

function onFastTableGridPointerLeave() {
  setFastTableGridCursor("default");
}
```

- [ ] **Step 3: Attach handlers to the fast-grid viewport**

In the `<div class="fast-table-grid__viewport" ...>` block in `src/App.vue`, add `@pointermove` and `@pointerleave` beside the existing pointer/click handlers:

```vue
<div
  ref="fastTableGridViewportRef"
  class="fast-table-grid__viewport"
  @scroll="onFastTableGridScroll"
  @pointermove="onFastTableGridPointerMove"
  @pointerleave="onFastTableGridPointerLeave"
  @pointerdown="onFastTableGridPointerDown"
  @click="onFastTableGridClick"
  @dblclick="onFastTableGridDoubleClick"
  @contextmenu.prevent="onFastTableGridContextMenu"
>
```

- [ ] **Step 4: Run the fast-grid tests**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

Only commit if the user has explicitly authorized commits in the current session. If authorized, run:

```bash
git add src/App.vue
git commit -m "feat: show resize cursor on fast grid edges"
```

---

### Task 3: Improve DOM table resize handle hit zones

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Update schema resize handle CSS**

Replace the existing `.schema-col-resize-handle` rule in `src/styles.css` with:

```css
.schema-col-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  z-index: 2;
}
```

Keep the existing hover rule unchanged:

```css
.schema-col-resize-handle:hover {
  background: rgba(2, 132, 199, 0.2);
}
```

- [ ] **Step 2: Update data table resize handle CSS**

Replace the existing `.col-resize-handle` rule in `src/styles.css` with:

```css
.col-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  z-index: 2;
}
```

Keep the existing hover rule unchanged:

```css
.col-resize-handle:hover {
  background: rgba(2, 132, 199, 0.2);
}
```

- [ ] **Step 3: Run frontend unit tests that cover table layout/grid behavior**

Run:

```bash
node --test src/fastTableGrid.test.js src/tableDialogLayout.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit this task**

Only commit if the user has explicitly authorized commits in the current session. If authorized, run:

```bash
git add src/styles.css
git commit -m "style: widen column resize cursor handles"
```

---

### Task 4: Browser verification

**Files:**
- No planned file changes.

- [ ] **Step 1: Start the frontend dev server**

Run:

```bash
npm run dev
```

Expected: Vite starts on port 1430 after the predev script syncs version and clears the port.

- [ ] **Step 2: Open the app in a browser**

Navigate to:

```text
http://localhost:1430
```

Expected: The Vue app loads without console errors caused by this change.

- [ ] **Step 3: Verify DOM table cursor behavior**

Use a table view that renders `.data-table` or `.schema-table`. Move the pointer across field header text and then onto the left/right divider edge.

Expected: Header text area keeps the normal cursor; the field edge shows the horizontal resize cursor; dragging still resizes the column.

- [ ] **Step 4: Verify fast-grid cursor behavior**

Use enough rows/columns to trigger the fast table grid. Move the pointer across the canvas header and onto a column divider.

Expected: The viewport cursor changes to `col-resize` only near the divider and returns to default away from dividers or below the header.

- [ ] **Step 5: Stop the dev server**

Stop the `npm run dev` process with Ctrl+C after verification.

---

## Self-Review

- Spec coverage: DOM tables and fast virtual grid are both covered. Edge hit zone, default cursor restoration, no resize redesign, and testing are covered.
- Placeholder scan: No TBD/TODO/fill-in placeholders remain.
- Type consistency: `resolveFastGridColumnResizeCursor` is introduced in Task 1, imported and used with the same name in Task 2.
