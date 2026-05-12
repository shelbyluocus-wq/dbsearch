# Fast Table Grid Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Excel-like fast read-only table grid that makes full-table browsing smooth by rendering only the visible viewport.

**Architecture:** Keep the current DOM table as the edit-mode path. Add pure grid geometry helpers and a Canvas-based read-only browse surface that reuses the existing `tableView`, seamless block loading, and `tableDataCache` data flow. `App.vue` switches to the fast grid only for full-table browsing when edit mode is off, while edit mode continues using the existing DOM `<table>` unchanged.

**Tech Stack:** Vue 3 Composition API, Canvas 2D API, Tauri IPC through existing `invoke("get_table_data")`, Node.js built-in test runner.

---

## Rules for execution

- Use TDD: write each test first, run it and confirm the expected failure, then implement the smallest code that passes.
- Do not commit during this implementation unless the user explicitly asks.
- Preserve the existing edit mode path. If `editMode` is true, the existing DOM table and text panel must remain active.
- Keep the first version read-focused. Do not add editable Canvas cells.
- For UI changes, run the frontend tests, build, then manually try the table browser in the app if the environment allows it.

### Task 1: Add pure fast-grid geometry helpers

**Files:**
- Create: `src/fastTableGrid.js`
- Create: `src/fastTableGrid.test.js`

**Step 1: Write failing tests**

Create `src/fastTableGrid.test.js` with tests for viewport row range, visible columns, scroll size, and hit testing.

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFastGridScrollSize,
  getVisibleFastGridRows,
  getVisibleFastGridColumns,
  hitTestFastGrid,
} from "./fastTableGrid.js";

test("buildFastGridScrollSize returns full virtual table dimensions", () => {
  assert.deepEqual(
    buildFastGridScrollSize({
      totalRows: 2400,
      rowHeight: 31,
      columns: [{ column_name: "id" }, { column_name: "name" }],
      getColumnWidth: (name) => (name === "id" ? 80 : 160),
      headerHeight: 34,
      rowNumberWidth: 52,
    }),
    { width: 292, height: 74434 },
  );
});

test("getVisibleFastGridRows overscans the viewport and clamps to table bounds", () => {
  assert.deepEqual(
    getVisibleFastGridRows({ totalRows: 100, rowHeight: 31, scrollTop: 310, clientHeight: 93, overscan: 2 }),
    { start: 8, end: 15 },
  );
});

test("getVisibleFastGridColumns returns visible columns with x positions", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];
  assert.deepEqual(
    getVisibleFastGridColumns({
      columns,
      scrollLeft: 70,
      clientWidth: 180,
      rowNumberWidth: 52,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180 })[name],
      overscan: 0,
    }),
    [
      { column: columns[0], index: 0, x: 52, width: 80 },
      { column: columns[1], index: 1, x: 132, width: 120 },
    ],
  );
});

test("hitTestFastGrid maps viewport coordinates to row and column", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }];
  assert.deepEqual(
    hitTestFastGrid({
      x: 150,
      y: 70,
      scrollLeft: 0,
      scrollTop: 31,
      rowHeight: 31,
      headerHeight: 34,
      rowNumberWidth: 52,
      totalRows: 100,
      columns,
      getColumnWidth: (name) => (name === "id" ? 80 : 120),
    }),
    { region: "cell", rowIndex: 2, columnIndex: 1, columnName: "name" },
  );
});
```

**Step 2: Run tests and verify failure**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: fails with `ERR_MODULE_NOT_FOUND` because `src/fastTableGrid.js` does not exist.

**Step 3: Implement minimal helpers**

Create `src/fastTableGrid.js`.

```js
function toPositiveInteger(value, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveColumnWidth(column, getColumnWidth, fallbackWidth) {
  const name = column?.column_name ?? "";
  const width = typeof getColumnWidth === "function" ? getColumnWidth(name, column) : fallbackWidth;
  return toPositiveInteger(width, fallbackWidth);
}

export function buildFastGridScrollSize({
  totalRows = 0,
  rowHeight = 31,
  headerHeight = 34,
  rowNumberWidth = 52,
  columns = [],
  getColumnWidth,
  fallbackColumnWidth = 120,
} = {}) {
  const rows = Math.max(0, Math.floor(Number(totalRows) || 0));
  const bodyHeight = rows * toPositiveInteger(rowHeight, 31);
  const bodyWidth = (Array.isArray(columns) ? columns : []).reduce(
    (sum, column) => sum + resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth),
    0,
  );
  return {
    width: toPositiveInteger(rowNumberWidth, 52) + bodyWidth,
    height: toPositiveInteger(headerHeight, 34) + bodyHeight,
  };
}

export function getVisibleFastGridRows({
  totalRows = 0,
  rowHeight = 31,
  scrollTop = 0,
  clientHeight = 0,
  overscan = 2,
} = {}) {
  const total = Math.max(0, Math.floor(Number(totalRows) || 0));
  if (total === 0) return { start: 0, end: -1 };
  const rowPx = toPositiveInteger(rowHeight, 31);
  const extra = Math.max(0, Math.floor(Number(overscan) || 0));
  const first = Math.floor(Math.max(0, Number(scrollTop) || 0) / rowPx);
  const last = Math.ceil((Math.max(0, Number(scrollTop) || 0) + Math.max(0, Number(clientHeight) || 0)) / rowPx);
  return {
    start: clamp(first - extra, 0, total - 1),
    end: clamp(last + extra, 0, total - 1),
  };
}

export function getVisibleFastGridColumns({
  columns = [],
  scrollLeft = 0,
  clientWidth = 0,
  rowNumberWidth = 52,
  getColumnWidth,
  fallbackColumnWidth = 120,
  overscan = 1,
} = {}) {
  const list = Array.isArray(columns) ? columns : [];
  const left = Math.max(0, Number(scrollLeft) || 0);
  const right = left + Math.max(0, Number(clientWidth) || 0);
  const rowHandleWidth = toPositiveInteger(rowNumberWidth, 52);
  const extra = Math.max(0, Math.floor(Number(overscan) || 0));
  const visible = [];
  let cursor = rowHandleWidth;

  list.forEach((column, index) => {
    const width = resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth);
    const columnLeft = cursor;
    const columnRight = cursor + width;
    if (columnRight >= left - extra * width && columnLeft <= right + extra * width) {
      visible.push({ column, index, x: columnLeft, width });
    }
    cursor = columnRight;
  });

  return visible;
}

export function hitTestFastGrid({
  x = 0,
  y = 0,
  scrollLeft = 0,
  scrollTop = 0,
  rowHeight = 31,
  headerHeight = 34,
  rowNumberWidth = 52,
  totalRows = 0,
  columns = [],
  getColumnWidth,
  fallbackColumnWidth = 120,
} = {}) {
  const headerPx = toPositiveInteger(headerHeight, 34);
  const rowHandleWidth = toPositiveInteger(rowNumberWidth, 52);
  const rowPx = toPositiveInteger(rowHeight, 31);
  const pointX = Math.max(0, Number(x) || 0);
  const pointY = Math.max(0, Number(y) || 0);
  const virtualX = pointX + Math.max(0, Number(scrollLeft) || 0);

  if (pointY < headerPx) {
    if (pointX < rowHandleWidth) return { region: "corner" };
    const column = findColumnAtX({ columns, x: virtualX, rowNumberWidth: rowHandleWidth, getColumnWidth, fallbackColumnWidth });
    return column ? { region: "header", ...column } : { region: "empty" };
  }

  const rowIndex = Math.floor((pointY - headerPx + Math.max(0, Number(scrollTop) || 0)) / rowPx);
  if (rowIndex < 0 || rowIndex >= Math.max(0, Math.floor(Number(totalRows) || 0))) return { region: "empty" };
  if (pointX < rowHandleWidth) return { region: "row-header", rowIndex };

  const column = findColumnAtX({ columns, x: virtualX, rowNumberWidth: rowHandleWidth, getColumnWidth, fallbackColumnWidth });
  return column ? { region: "cell", rowIndex, ...column } : { region: "empty" };
}

function findColumnAtX({ columns, x, rowNumberWidth, getColumnWidth, fallbackColumnWidth }) {
  let cursor = rowNumberWidth;
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    const width = resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth);
    if (x >= cursor && x < cursor + width) {
      return { columnIndex: index, columnName: column.column_name };
    }
    cursor += width;
  }
  return null;
}
```

**Step 4: Run tests and verify pass**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: all `fastTableGrid` tests pass.

**Step 5: Checkpoint**

Do not commit. Report that Task 1 is ready for review.

### Task 2: Add testable Canvas drawing command builder

**Files:**
- Modify: `src/fastTableGrid.js`
- Modify: `src/fastTableGrid.test.js`

**Step 1: Write failing tests**

Append tests that describe the draw model without using a real Canvas context.

```js
import { buildFastGridDrawModel } from "./fastTableGrid.js";

test("buildFastGridDrawModel includes only visible cells", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }];
  const rows = [
    { id: "1", name: "Alice" },
    { id: "2", name: "Bob" },
  ];

  const model = buildFastGridDrawModel({
    rows,
    rowStartIndex: 10,
    columns,
    visibleColumns: [
      { column: columns[1], index: 1, x: 132, width: 120 },
    ],
    rowHeight: 31,
    headerHeight: 34,
    scrollTop: 310,
    scrollLeft: 0,
    rowNumberWidth: 52,
  });

  assert.deepEqual(model.cells, [
    { rowIndex: 10, columnName: "name", text: "Alice", x: 132, y: 34, width: 120, height: 31 },
    { rowIndex: 11, columnName: "name", text: "Bob", x: 132, y: 65, width: 120, height: 31 },
  ]);
});

test("buildFastGridDrawModel marks focused and hit cells", () => {
  const columns = [{ column_name: "id" }];
  const model = buildFastGridDrawModel({
    rows: [{ id: "1" }],
    rowStartIndex: 0,
    columns,
    visibleColumns: [{ column: columns[0], index: 0, x: 52, width: 80 }],
    focusedCell: { rowIndex: 0, columnName: "id" },
    isCellHit: ({ rowIndex, columnName }) => rowIndex === 0 && columnName === "id",
  });

  assert.equal(model.cells[0].focused, true);
  assert.equal(model.cells[0].hit, true);
});
```

**Step 2: Run tests and verify failure**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: fails because `buildFastGridDrawModel` is not exported.

**Step 3: Implement minimal draw model builder**

Add to `src/fastTableGrid.js`.

```js
export function buildFastGridDrawModel({
  rows = [],
  rowStartIndex = 0,
  visibleColumns = [],
  rowHeight = 31,
  headerHeight = 34,
  scrollTop = 0,
  scrollLeft = 0,
  focusedCell = null,
  isCellHit = () => false,
  formatCellValue = (value) => String(value ?? ""),
} = {}) {
  const rowPx = toPositiveInteger(rowHeight, 31);
  const headerPx = toPositiveInteger(headerHeight, 34);
  const top = Math.max(0, Number(scrollTop) || 0);
  const left = Math.max(0, Number(scrollLeft) || 0);
  const firstRow = Math.max(0, Math.floor(Number(rowStartIndex) || 0));
  const list = Array.isArray(rows) ? rows : [];
  const columns = Array.isArray(visibleColumns) ? visibleColumns : [];

  const cells = [];
  list.forEach((row, localIndex) => {
    const rowIndex = firstRow + localIndex;
    const y = headerPx + rowIndex * rowPx - top;
    columns.forEach(({ column, x, width }) => {
      const columnName = column?.column_name ?? "";
      const cell = {
        rowIndex,
        columnName,
        text: formatCellValue(row?.[columnName], row, column),
        x: x - left,
        y,
        width,
        height: rowPx,
      };
      if (focusedCell?.rowIndex === rowIndex && focusedCell?.columnName === columnName) cell.focused = true;
      if (isCellHit({ row, rowIndex, columnName, column })) cell.hit = true;
      cells.push(cell);
    });
  });

  return { cells };
}
```

**Step 4: Run tests and verify pass**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: all `fastTableGrid` tests pass.

**Step 5: Checkpoint**

Do not commit. Report that Task 2 is ready for review.

### Task 3: Add App.vue wiring assertions for fast-grid mode selection

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify later: `src/App.vue`

**Step 1: Write failing integration assertions**

Append an App.vue source assertion test to `src/fastTableGrid.test.js`.

```js
test("App.vue wires fast table grid only for read-only full-table browsing", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /fastTableGridCanvasRef/);
  assert.match(appVue, /shouldUseFastTableGrid/);
  assert.match(appVue, /!editMode\.value/);
  assert.match(appVue, /drawFastTableGrid/);
  assert.match(appVue, /hitTestFastGrid/);
  assert.match(appVue, /v-if="shouldUseFastTableGrid"/);
  assert.match(appVue, /v-else[\s\S]*<table class="data-table">/);
});
```

**Step 2: Run tests and verify failure**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: fails because `App.vue` does not contain the fast-grid wiring yet.

**Step 3: Add imports and state in App.vue**

Modify `src/App.vue` near the existing table imports:

```js
import {
  buildFastGridDrawModel,
  buildFastGridScrollSize,
  getVisibleFastGridColumns,
  getVisibleFastGridRows,
  hitTestFastGrid,
} from "./fastTableGrid.js";
```

Add state near `tableGridWrapRef` and seamless table state:

```js
const fastTableGridCanvasRef = ref(null);
const fastTableGridViewportRef = ref(null);
const fastTableGridScroll = reactive({ left: 0, top: 0, width: 0, height: 0 });
const fastTableGridFocus = reactive({ rowIndex: -1, columnName: "" });
let fastTableGridRaf = 0;
```

Add computed switch near `shouldUseSeamlessTable`:

```js
const shouldUseFastTableGrid = computed(() =>
  tableOpen.value &&
  tableDetailView.value === "full" &&
  !editMode.value &&
  !dataCollapsed.value &&
  tableView.columns.length > 0,
);
```

**Step 4: Add minimal draw scheduler**

Add functions near the existing `flushTableGridScroll()` functions. This first implementation may only clear the canvas and draw text; Task 4 will refine rendering.

```js
function scheduleFastTableGridDraw() {
  if (!shouldUseFastTableGrid.value) return;
  if (!fastTableGridRaf) {
    fastTableGridRaf = requestAnimationFrame(drawFastTableGrid);
  }
}

function drawFastTableGrid() {
  fastTableGridRaf = 0;
  const canvas = fastTableGridCanvasRef.value;
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(fastTableGridScroll.width));
  const height = Math.max(1, Math.floor(fastTableGridScroll.height));
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#0f172a";
  context.font = "12px Microsoft YaHei, sans-serif";
  context.fillText(tableView.tableName || "", 12, 22);
}

function onFastTableGridScroll(event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  fastTableGridScroll.left = target.scrollLeft;
  fastTableGridScroll.top = target.scrollTop;
  fastTableGridScroll.width = target.clientWidth;
  fastTableGridScroll.height = target.clientHeight;
  pendingTableGridScroll.scrollTop = target.scrollTop;
  pendingTableGridScroll.clientHeight = target.clientHeight;
  if (!tableGridScrollRaf) {
    tableGridScrollRaf = requestAnimationFrame(flushTableGridScroll);
  }
  scheduleFastTableGridDraw();
}
```

In `onBeforeUnmount`, cancel `fastTableGridRaf` next to `tableGridScrollRaf` cleanup.

```js
if (fastTableGridRaf) {
  cancelAnimationFrame(fastTableGridRaf);
  fastTableGridRaf = 0;
}
```

**Step 5: Run tests and verify pass**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: all `fastTableGrid` tests pass.

**Step 6: Checkpoint**

Do not commit. Report that Task 3 is ready for review.

### Task 4: Add the read-only fast-grid template and styles

**Files:**
- Modify: `src/App.vue`
- Modify: `src/styles.css`
- Modify: `src/fastTableGrid.test.js`

**Step 1: Write failing source assertions for template and styles**

Append tests to `src/fastTableGrid.test.js`.

```js
test("App.vue renders the fast grid viewport before the DOM table fallback", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /class="fast-table-grid"/);
  assert.match(appVue, /ref="fastTableGridViewportRef"/);
  assert.match(appVue, /@scroll="onFastTableGridScroll"/);
  assert.match(appVue, /ref="fastTableGridCanvasRef"/);
  assert.match(appVue, /@dblclick="onFastTableGridDoubleClick"/);
});

test("styles.css includes fast table grid viewport styles", async () => {
  const { readFile } = await import("node:fs/promises");
  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.fast-table-grid\s*\{/);
  assert.match(styles, /\.fast-table-grid__viewport\s*\{/);
  assert.match(styles, /\.fast-table-grid__canvas\s*\{/);
  assert.match(styles, /\.fast-table-grid__spacer\s*\{/);
});
```

**Step 2: Run tests and verify failure**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: fails because template and CSS are not present.

**Step 3: Add fast-grid template before the existing DOM table**

In `src/App.vue`, replace the current table wrapper opening area with a conditional fast-grid wrapper followed by the existing DOM wrapper as fallback:

```vue
<div
  v-if="shouldUseFastTableGrid"
  ref="fastTableGridViewportRef"
  class="fast-table-grid__viewport"
  @scroll="onFastTableGridScroll"
  @click="onFastTableGridClick"
  @dblclick="onFastTableGridDoubleClick"
  @contextmenu.prevent="onFastTableGridContextMenu"
>
  <div class="fast-table-grid__spacer" :style="fastTableGridSpacerStyle"></div>
  <canvas ref="fastTableGridCanvasRef" class="fast-table-grid__canvas"></canvas>
  <div v-if="seamlessTable.loading" class="seamless-table-loading">加载更多...</div>
</div>
<div v-else ref="tableGridWrapRef" class="grid-wrap" :class="{ 'freeze-pick-mode': freezePickMode }" @scroll="onTableGridScroll">
  <!-- keep the existing <table class="data-table"> block exactly here -->
</div>
```

Add an outer class if needed around the fast grid block:

```vue
<div v-if="shouldUseFastTableGrid" class="fast-table-grid">
  ...viewport above...
</div>
```

Keep the existing DOM `<table class="data-table">` under `v-else` so edit mode does not use Canvas.

**Step 4: Add spacer style computed**

Near fast-grid state in `src/App.vue`:

```js
const fastTableGridScrollSize = computed(() => buildFastGridScrollSize({
  totalRows: tableView.totalRows,
  rowHeight: TABLE_ROW_HEIGHT,
  headerHeight: TABLE_HEADER_HEIGHT,
  rowNumberWidth: TABLE_ROW_HANDLE_WIDTH,
  columns: tableView.columns,
  getColumnWidth,
  fallbackColumnWidth: TABLE_COLUMN_WIDTH_FALLBACK,
}));

const fastTableGridSpacerStyle = computed(() => ({
  width: `${fastTableGridScrollSize.value.width}px`,
  height: `${fastTableGridScrollSize.value.height}px`,
}));
```

**Step 5: Add styles**

Append to `src/styles.css` near table styles:

```css
.fast-table-grid {
  position: relative;
  flex: 1;
  min-height: 140px;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(248, 250, 252, 0.96);
}

.fast-table-grid__viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 140px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.fast-table-grid__spacer {
  position: relative;
  pointer-events: none;
}

.fast-table-grid__canvas {
  position: sticky;
  left: 0;
  top: 0;
  display: block;
  pointer-events: none;
}
```

**Step 6: Run tests and verify pass**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: all `fastTableGrid` tests pass.

**Step 7: Checkpoint**

Do not commit. Report that Task 4 is ready for review.

### Task 5: Draw visible rows, columns, headers, and selection

**Files:**
- Modify: `src/App.vue`
- Modify: `src/fastTableGrid.test.js`

**Step 1: Write failing source assertions**

Append tests to `src/fastTableGrid.test.js`.

```js
test("App.vue drawFastTableGrid uses visible ranges and draw model", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /getVisibleFastGridRows/);
  assert.match(appVue, /getVisibleFastGridColumns/);
  assert.match(appVue, /buildFastGridDrawModel/);
  assert.match(appVue, /fastTableGridFocus/);
  assert.match(appVue, /context\.fillText/);
  assert.match(appVue, /TABLE_ROW_HEIGHT/);
  assert.match(appVue, /TABLE_HEADER_HEIGHT/);
});
```

**Step 2: Run tests and verify failure**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: fails until the draw function uses the helpers.

**Step 3: Implement visible rows mapping**

Add helper in `src/App.vue` near fast-grid functions:

```js
function getFastTableGridVisibleRows(range) {
  const rows = [];
  for (let globalIndex = range.start; globalIndex <= range.end; globalIndex += 1) {
    const block = getSeamlessBlockNumber({ rowIndex: globalIndex, blockSize: SEAMLESS_TABLE_BLOCK_SIZE });
    const localIndex = globalIndex - (block - 1) * SEAMLESS_TABLE_BLOCK_SIZE;
    const row = seamlessTable.blocks.get(block)?.[localIndex];
    if (row) rows.push(row);
  }
  return rows;
}
```

**Step 4: Replace placeholder draw function**

Update `drawFastTableGrid()` to:

```js
function drawFastTableGrid() {
  fastTableGridRaf = 0;
  const canvas = fastTableGridCanvasRef.value;
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(fastTableGridScroll.width || fastTableGridViewportRef.value?.clientWidth || 1));
  const height = Math.max(1, Math.floor(fastTableGridScroll.height || fastTableGridViewportRef.value?.clientHeight || 1));
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const rowRange = getVisibleFastGridRows({
    totalRows: tableView.totalRows,
    rowHeight: TABLE_ROW_HEIGHT,
    scrollTop: fastTableGridScroll.top,
    clientHeight: height,
    overscan: 3,
  });
  const visibleColumns = getVisibleFastGridColumns({
    columns: tableView.columns,
    scrollLeft: fastTableGridScroll.left,
    clientWidth: width,
    rowNumberWidth: TABLE_ROW_HANDLE_WIDTH,
    getColumnWidth,
    fallbackColumnWidth: TABLE_COLUMN_WIDTH_FALLBACK,
    overscan: 1,
  });

  const rows = getFastTableGridVisibleRows(rowRange);
  const model = buildFastGridDrawModel({
    rows,
    rowStartIndex: rowRange.start,
    visibleColumns,
    rowHeight: TABLE_ROW_HEIGHT,
    headerHeight: TABLE_HEADER_HEIGHT,
    scrollTop: fastTableGridScroll.top,
    scrollLeft: fastTableGridScroll.left,
    focusedCell: fastTableGridFocus.rowIndex >= 0 ? fastTableGridFocus : null,
    isCellHit: ({ row, rowIndex, columnName }) => isDataCellHit(row, columnName) || isTableFindFocusForDisplayedRow(rowIndex - rowRange.start, row),
    formatCellValue: (value) => String(value ?? ""),
  });

  drawFastTableGridHeaders(context, visibleColumns, width);
  drawFastTableGridRows(context, model.cells);
}
```

Add minimal draw helpers:

```js
function drawFastTableGridHeaders(context, visibleColumns, width) {
  context.fillStyle = "#f1f5f9";
  context.fillRect(0, 0, width, TABLE_HEADER_HEIGHT);
  context.strokeStyle = "#e2e8f0";
  context.fillStyle = "#334155";
  context.font = "12px Microsoft YaHei, sans-serif";
  visibleColumns.forEach(({ column, x, width: columnWidth }) => {
    context.strokeRect(x - fastTableGridScroll.left, 0, columnWidth, TABLE_HEADER_HEIGHT);
    context.fillText(String(column.column_name || ""), x - fastTableGridScroll.left + 8, 22);
  });
}

function drawFastTableGridRows(context, cells) {
  context.font = "12px Microsoft YaHei, sans-serif";
  cells.forEach((cell) => {
    context.fillStyle = cell.focused ? "#dbeafe" : cell.hit ? "#fef3c7" : "#ffffff";
    context.fillRect(cell.x, cell.y, cell.width, cell.height);
    context.strokeStyle = "#e2e8f0";
    context.strokeRect(cell.x, cell.y, cell.width, cell.height);
    context.fillStyle = "#0f172a";
    context.fillText(cell.text, cell.x + 8, cell.y + 20, Math.max(10, cell.width - 16));
  });
}
```

**Step 5: Ensure visible blocks are loaded while scrolling**

`onFastTableGridScroll()` already updates `pendingTableGridScroll` and calls `flushTableGridScroll()`. Add a watcher so drawing updates after async block loads:

```js
watch(
  () => [seamlessTable.blocks, tableView.columns, tableView.totalRows, fastTableGridScroll.left, fastTableGridScroll.top],
  () => scheduleFastTableGridDraw(),
  { deep: false },
);
```

**Step 6: Run tests and verify pass**

Run:

```bash
node --test src/fastTableGrid.test.js src/tableSeamlessScroll.test.js
```

Expected: all tests pass.

**Step 7: Checkpoint**

Do not commit. Report that Task 5 is ready for review.

### Task 6: Wire pointer interactions to existing viewer and copy behavior

**Files:**
- Modify: `src/App.vue`
- Modify: `src/fastTableGrid.test.js`

**Step 1: Write failing source assertions**

Append tests to `src/fastTableGrid.test.js`.

```js
test("App.vue fast grid pointer handlers reuse existing cell viewer and row copy", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /function resolveFastTableGridHit/);
  assert.match(appVue, /function onFastTableGridClick/);
  assert.match(appVue, /function onFastTableGridDoubleClick/);
  assert.match(appVue, /function onFastTableGridContextMenu/);
  assert.match(appVue, /openPageCellViewer/);
  assert.match(appVue, /copyRow/);
});
```

**Step 2: Run tests and verify failure**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: fails until handlers are implemented.

**Step 3: Implement hit resolution**

Add in `src/App.vue`:

```js
function getFastTableGridRow(rowIndex) {
  const block = getSeamlessBlockNumber({ rowIndex, blockSize: SEAMLESS_TABLE_BLOCK_SIZE });
  const localIndex = rowIndex - (block - 1) * SEAMLESS_TABLE_BLOCK_SIZE;
  return seamlessTable.blocks.get(block)?.[localIndex] || null;
}

function resolveFastTableGridHit(event) {
  const viewport = fastTableGridViewportRef.value;
  if (!(viewport instanceof HTMLElement)) return { region: "empty" };
  const rect = viewport.getBoundingClientRect();
  return hitTestFastGrid({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    scrollLeft: fastTableGridScroll.left,
    scrollTop: fastTableGridScroll.top,
    rowHeight: TABLE_ROW_HEIGHT,
    headerHeight: TABLE_HEADER_HEIGHT,
    rowNumberWidth: TABLE_ROW_HANDLE_WIDTH,
    totalRows: tableView.totalRows,
    columns: tableView.columns,
    getColumnWidth,
    fallbackColumnWidth: TABLE_COLUMN_WIDTH_FALLBACK,
  });
}
```

**Step 4: Implement click, double-click, and context-menu handlers**

Add:

```js
function onFastTableGridClick(event) {
  const hit = resolveFastTableGridHit(event);
  if (hit.region !== "cell") return;
  fastTableGridFocus.rowIndex = hit.rowIndex;
  fastTableGridFocus.columnName = hit.columnName;
  scheduleFastTableGridDraw();
}

function onFastTableGridDoubleClick(event) {
  const hit = resolveFastTableGridHit(event);
  if (hit.region !== "cell") return;
  const row = getFastTableGridRow(hit.rowIndex);
  if (!row) return;
  const localIndex = hit.rowIndex - (tableView.page - 1) * tableView.pageSize;
  openPageCellViewer(Math.max(0, localIndex), hit.columnName);
}

function onFastTableGridContextMenu(event) {
  const hit = resolveFastTableGridHit(event);
  if (hit.region !== "cell" && hit.region !== "row-header") return;
  const row = getFastTableGridRow(hit.rowIndex);
  if (row) copyRow(row);
}
```

If `openPageCellViewer()` only works for the current `tableView.rows` page, add a small read-only viewer path that fills `cellViewer` directly from `row` instead of forcing page-local state. Do not change edit-mode save behavior in this task.

**Step 5: Run tests and verify pass**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: all tests pass.

**Step 6: Checkpoint**

Do not commit. Report that Task 6 is ready for review.

### Task 7: Protect edit mode and existing seamless behavior

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify if needed: `src/App.vue`

**Step 1: Write regression assertions**

Append tests:

```js
test("App.vue keeps edit mode on the DOM table path", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /const shouldUseFastTableGrid = computed/);
  assert.match(appVue, /!editMode\.value/);
  assert.match(appVue, /<div v-else ref="tableGridWrapRef" class="grid-wrap"/);
  assert.match(appVue, /<input v-if="editingCell\.active/);
  assert.match(appVue, /v-if="editMode" class="edit-bottom-stack"/);
});

test("App.vue keeps seamless loading available for fast grid scrolling", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /pendingTableGridScroll\.scrollTop = target\.scrollTop/);
  assert.match(appVue, /requestAnimationFrame\(flushTableGridScroll/);
  assert.match(appVue, /loadVisibleSeamlessBlocks/);
});
```

**Step 2: Run tests and verify failure or pass**

Run:

```bash
node --test src/fastTableGrid.test.js src/tableSeamlessScroll.test.js
```

Expected: pass if prior tasks preserved the boundary; if a test fails, fix only the boundary it identifies.

**Step 3: Fix only identified boundary issues**

If needed:

- Ensure `shouldUseFastTableGrid` includes `!editMode.value`.
- Ensure the current DOM table is under `v-else`.
- Ensure `onFastTableGridScroll()` still schedules `flushTableGridScroll()`.

**Step 4: Run tests and verify pass**

Run:

```bash
node --test src/fastTableGrid.test.js src/tableSeamlessScroll.test.js
```

Expected: all tests pass.

**Step 5: Checkpoint**

Do not commit. Report that Task 7 is ready for review.

### Task 8: Full verification and manual UI check

**Files:**
- No planned source changes unless verification finds a bug.

**Step 1: Run focused tests**

Run:

```bash
node --test src/fastTableGrid.test.js src/tableDataCache.test.js src/tableSeamlessScroll.test.js
```

Expected: all tests pass.

**Step 2: Run all frontend tests**

Run:

```bash
node --test src/*.test.js
```

Expected: all tests pass.

**Step 3: Run frontend build**

Run:

```bash
npm run build
```

Expected: build succeeds. Existing Vite chunk-size warnings are acceptable; new errors are not.

**Step 4: Start the app for manual testing**

Run:

```bash
npm run tauri dev
```

Expected: Vite and Tauri app start. If MSVC linker fails with `kernel32.lib`, apply the `LIB` and `INCLUDE` exports from `CLAUDE.md`, then retry.

**Step 5: Manual table browsing checklist**

In the running app:

- Open a table with around 2000 rows.
- Confirm full-table browsing scrolls vertically without the previous DOM stutter.
- Scroll down and back up; previously loaded blocks should reuse cache.
- Scroll horizontally across columns.
- Double-click a cell and confirm the existing cell viewer opens with the correct value.
- Right-click a row/cell and confirm row copy still works.
- Toggle edit mode and confirm the old DOM edit grid appears with inline editing and bottom text panel intact.
- Exit edit mode and confirm fast browsing returns.

**Step 6: Report actual verification evidence**

Report the commands run, pass/fail counts, build result, and whether manual Tauri UI testing was completed. Do not claim manual UI success unless it was actually tested.

**Step 7: Checkpoint**

Do not commit. Ask the user whether to keep iterating, commit, or adjust the design.
