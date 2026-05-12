# Crisp Table Ctrl+Wheel Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix blurry table rendering after Ctrl+wheel zoom by making the table content render at its real scaled layout size instead of relying on CSS `zoom` raster scaling.

**Architecture:** Keep the existing global `config.personal.ui_scale` value and shortcut behavior, but change the table content path to expose a table layout scale and use CSS variables for real dimensions. The fast canvas grid will size its backing store with `devicePixelRatio` only, because the viewport and drawing dimensions will already be scaled in CSS pixels.

**Tech Stack:** Vue 3 Composition API in `src/App.vue`, CSS custom properties in `src/styles.css`, Node.js built-in test runner in `src/fastTableGrid.test.js`.

---

## File Structure

- Modify `src/fastTableGrid.test.js`: replace the current source-text assertion for canvas crispness with tests that prove table zoom is implemented through layout CSS variables and that the fast grid canvas does not multiply by the visual scale after layout scaling.
- Modify `src/App.vue`: add scaled table dimension computed values, feed them into fast grid sizing/drawing/hit testing, and keep Ctrl+wheel using the existing `setUiScale` flow.
- Modify `src/styles.css`: remove CSS `zoom` from `.table-content-scale` and apply `--table-scale` to table paddings, fonts, headers, rows, gutters, borders, and fast grid sizing.

### Task 1: Lock the crisp zoom contract with failing tests

**Files:**
- Modify: `src/fastTableGrid.test.js:297-308`
- Test: `src/fastTableGrid.test.js`

- [ ] **Step 1: Replace the existing canvas scale test**

Replace the test that starts with:

```js
test("App.vue sizes the fast grid canvas by content scale so zoomed tables stay crisp", async () => {
```

with this exact test block:

```js
test("App.vue lets table zoom change real layout metrics instead of CSS zooming pixels", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  const tableScaleStyleStart = appVue.indexOf("const tableContentScaleStyle = computed");
  const tableScaleStyleEnd = appVue.indexOf("const hitOnlySchemaColumns", tableScaleStyleStart);
  const tableScaleStyleBody = appVue.slice(tableScaleStyleStart, tableScaleStyleEnd);
  const tableContentScaleRule = styles.match(/\.table-content-scale\s*\{[\s\S]*?\n\}/)?.[0] || "";

  assert.notEqual(tableScaleStyleStart, -1);
  assert.notEqual(tableScaleStyleEnd, -1);
  assert.match(tableScaleStyleBody, /"--table-scale": String\(tableVisualScale\.value\)/);
  assert.doesNotMatch(tableContentScaleRule, /\bzoom\s*:/);
});

test("App.vue draws the fast grid at scaled layout size without double-applying table zoom", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const drawStart = appVue.indexOf("function drawFastTableGrid()");
  const drawEnd = appVue.indexOf("function readFastTableGridCssValue");
  const drawBody = appVue.slice(drawStart, drawEnd);

  assert.notEqual(drawStart, -1);
  assert.notEqual(drawEnd, -1);
  assert.match(drawBody, /const ratio = window\.devicePixelRatio \|\| 1/);
  assert.doesNotMatch(drawBody, /devicePixelRatio \|\| 1\) \* visualScale/);
  assert.match(drawBody, /rowHeight: scaledTableRowHeight\.value/);
  assert.match(drawBody, /headerHeight: scaledTableHeaderHeight\.value/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL. The failure should mention missing `"--table-scale": String(tableVisualScale.value)`, or that the `.table-content-scale` rule still contains `zoom`, or that the draw function still multiplies `devicePixelRatio` by `visualScale`.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/fastTableGrid.test.js
git commit -m "test: capture crisp table zoom contract"
```

### Task 2: Move table scaling from CSS zoom to CSS variables

**Files:**
- Modify: `src/App.vue:3838-3852`
- Modify: `src/styles.css:3206-3240`, `src/styles.css:3431-3450`, `src/styles.css:3501-3616`, `src/styles.css:3639-3658`
- Test: `src/fastTableGrid.test.js`

- [ ] **Step 1: Add the table scale variable in App.vue**

Replace the current `tableContentScaleStyle` computed value in `src/App.vue` with:

```js
const tableVisualScale = computed(() => normalizeUiScale(config.personal.ui_scale));
const tableContentScaleStyle = computed(() => ({
  "--table-scale": String(tableVisualScale.value),
}));
```

Keep the existing `contentScaleStyle` computed value unchanged for non-table panel scaling.

- [ ] **Step 2: Remove CSS zoom and add scaled table variables**

Replace the `.table-content-scale` rule in `src/styles.css` with:

```css
.table-content-scale {
  --table-scale: 1;
  --table-padding: calc(12px * var(--table-scale));
  --table-gap: calc(8px * var(--table-scale));
  --table-font-size: calc(12px * var(--table-scale));
  --table-cell-px: calc(8px * var(--table-scale));
  --table-cell-py: calc(6px * var(--table-scale));
  --table-header-height: calc(34px * var(--table-scale));
  --table-row-height: calc(31px * var(--table-scale));
  --table-row-handle-width: calc(36px * var(--table-scale));
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

- [ ] **Step 3: Scale table spacing and schema table text**

Replace the shared form/table padding rule:

```css
.form-group,
.schema-box,
.data-box {
  padding: 12px;
}
```

with:

```css
.form-group,
.schema-box,
.data-box {
  padding: 12px;
}

.table-content-scale .schema-box,
.table-content-scale .data-box {
  padding: var(--table-padding);
}
```

Replace the `.section-body` rule with:

```css
.section-body {
  margin-top: 8px;
}

.table-content-scale .section-body {
  margin-top: var(--table-gap);
}
```

Replace the `.schema-table` rule with:

```css
.schema-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  font-size: 12px;
}

.table-content-scale .schema-table {
  margin-top: var(--table-gap);
  font-size: var(--table-font-size);
}
```

Replace the `.schema-table th, .schema-table td` rule with:

```css
.schema-table th,
.schema-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.table-content-scale .schema-table th,
.table-content-scale .schema-table td {
  padding: var(--table-cell-py) var(--table-cell-px);
}
```

- [ ] **Step 4: Scale data header, grid wrappers, and table cells**

In `src/styles.css`, replace `.data-head` with:

```css
.data-head {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.table-content-scale .data-head {
  margin-top: var(--table-gap);
  gap: calc(10px * var(--table-scale));
  font-size: var(--table-font-size);
}
```

Replace `.grid-wrap` with:

```css
.grid-wrap {
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: auto;
  flex: 1;
  min-height: 140px;
  max-height: none;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.table-content-scale .grid-wrap {
  margin-top: var(--table-gap);
  border-radius: calc(10px * var(--table-scale));
  min-height: calc(140px * var(--table-scale));
}
```

Replace `.fast-table-grid` with:

```css
.fast-table-grid {
  --table-header-bg: color-mix(in srgb, var(--surface-card-strong) 92%, var(--bg-panel) 8%);
  --table-row-header-bg: color-mix(in srgb, var(--bg-panel) 96%, transparent);
  position: relative;
  flex: 1;
  min-height: 140px;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-panel) 96%, transparent);
}

.table-content-scale .fast-table-grid {
  min-height: calc(140px * var(--table-scale));
  margin-top: var(--table-gap);
  border-radius: calc(10px * var(--table-scale));
}
```

Replace `.fast-table-grid__viewport` with:

```css
.fast-table-grid__viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 140px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.table-content-scale .fast-table-grid__viewport {
  min-height: calc(140px * var(--table-scale));
}
```

Replace `.data-table` with:

```css
.data-table {
  --table-header-bg: rgba(226, 236, 248, 0.98);
  --table-freeze-cell-bg: color-mix(in srgb, var(--bg-panel) 99%, #eef6ff 1%);
  --table-freeze-header-bg: color-mix(in srgb, var(--table-header-bg) 94%, #ffffff 6%);
  --table-freeze-row-bg: color-mix(in srgb, var(--bg-panel) 98%, #e0f2fe 2%);
  --table-freeze-row-header-bg: color-mix(in srgb, var(--table-header-bg) 90%, #e0f2fe 10%);
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}

.table-content-scale .data-table {
  font-size: var(--table-font-size);
}
```

Replace `.data-table th, .data-table td` with:

```css
.data-table th,
.data-table td {
  box-sizing: border-box;
  text-align: left;
  white-space: nowrap;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  border-right: 1px solid rgba(255, 255, 255, 0.04);
}

.table-content-scale .data-table th,
.table-content-scale .data-table td {
  padding: var(--table-cell-py) var(--table-cell-px);
}
```

- [ ] **Step 5: Run the focused test and verify the CSS contract passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: the first new test passes. The second new test may still fail because the fast grid draw code still uses unscaled constants.

- [ ] **Step 6: Commit CSS layout scaling**

```bash
git add src/App.vue src/styles.css src/fastTableGrid.test.js
git commit -m "fix: render table zoom with layout scaling"
```

### Task 3: Use scaled metrics for fast grid geometry and drawing

**Files:**
- Modify: `src/App.vue:2082-2094`, `src/App.vue:3848-3852`, `src/App.vue:8781-8957`
- Test: `src/fastTableGrid.test.js`

- [ ] **Step 1: Add scaled metric computed values**

In `src/App.vue`, immediately after the `tableContentScaleStyle` computed value, add:

```js
const scaledTableHeaderHeight = computed(() => Math.round(TABLE_HEADER_HEIGHT * tableVisualScale.value));
const scaledTableRowHeight = computed(() => Math.round(TABLE_ROW_HEIGHT * tableVisualScale.value));
const scaledTableRowHandleWidth = computed(() => Math.round(TABLE_ROW_HANDLE_WIDTH * tableVisualScale.value));
```

- [ ] **Step 2: Use scaled metrics in fast grid scroll size**

Replace the `fastTableGridScrollSize` computed value with:

```js
const fastTableGridScrollSize = computed(() => buildFastGridScrollSize({
  totalRows: tableView.totalRows,
  rowHeight: scaledTableRowHeight.value,
  headerHeight: scaledTableHeaderHeight.value,
  rowNumberWidth: scaledTableRowHandleWidth.value,
  columns: tableView.columns,
  getColumnWidth,
  fallbackColumnWidth: Math.round(TABLE_COLUMN_WIDTH_FALLBACK * tableVisualScale.value),
}));
```

- [ ] **Step 3: Change fast grid canvas backing ratio**

In `drawFastTableGrid()`, replace:

```js
const visualScale = normalizeUiScale(config.personal.ui_scale);
const ratio = (window.devicePixelRatio || 1) * visualScale;
```

with:

```js
const ratio = window.devicePixelRatio || 1;
```

- [ ] **Step 4: Use scaled metrics in visible row and column model calls**

In `drawFastTableGrid()`, replace every fast grid geometry constant used inside the function with scaled values:

```js
rowHeight: scaledTableRowHeight.value,
```

```js
headerHeight: scaledTableHeaderHeight.value,
```

```js
rowNumberWidth: scaledTableRowHandleWidth.value,
```

```js
fallbackColumnWidth: Math.round(TABLE_COLUMN_WIDTH_FALLBACK * tableVisualScale.value),
```

This applies to the calls to `getVisibleFastGridRows`, `getVisibleFastGridColumns`, and `buildFastGridDrawModel`.

- [ ] **Step 5: Use scaled metrics in header and row-header drawing**

Replace `drawFastTableGridHeaders` with:

```js
function drawFastTableGridHeaders(context, visibleColumns, width, theme) {
  const headerHeight = scaledTableHeaderHeight.value;
  const rowNumberWidth = scaledTableRowHandleWidth.value;
  context.fillStyle = theme.headerBackground;
  context.fillRect(0, 0, width, headerHeight);
  context.strokeStyle = theme.border;
  context.strokeRect(0, 0, rowNumberWidth, headerHeight);
  context.fillStyle = theme.headerText;
  context.font = theme.font;
  visibleColumns.forEach(({ column, x, width: columnWidth }) => {
    const drawX = x - fastTableGridScroll.left;
    const text = truncateFastGridText(column.column_name || "", Math.max(10, columnWidth - 16 * tableVisualScale.value), context);
    context.strokeRect(drawX, 0, columnWidth, headerHeight);
    context.fillText(text, drawX + 8 * tableVisualScale.value, Math.round(22 * tableVisualScale.value));
  });
}
```

Replace `drawFastTableGridRowHeaders` with:

```js
function drawFastTableGridRowHeaders(context, rowRange, height, theme) {
  const headerHeight = scaledTableHeaderHeight.value;
  const rowHeight = scaledTableRowHeight.value;
  const rowNumberWidth = scaledTableRowHandleWidth.value;
  context.font = theme.font;
  for (let rowIndex = rowRange.start; rowIndex <= rowRange.end; rowIndex += 1) {
    const y = headerHeight + rowIndex * rowHeight - fastTableGridScroll.top;
    if (y + rowHeight < headerHeight || y > height) continue;
    context.fillStyle = theme.rowHeaderBackground;
    context.fillRect(0, y, rowNumberWidth, rowHeight);
    context.strokeStyle = theme.border;
    context.strokeRect(0, y, rowNumberWidth, rowHeight);
    context.fillStyle = theme.headerText;
    const text = String(rowIndex + 1);
    context.fillText(text, 8 * tableVisualScale.value, y + Math.round(20 * tableVisualScale.value));
  }
}
```

Replace `drawFastTableGridRows` with:

```js
function drawFastTableGridRows(context, cells, theme) {
  const textInset = 8 * tableVisualScale.value;
  const textMaxInset = 16 * tableVisualScale.value;
  const textBaselineOffset = Math.round(20 * tableVisualScale.value);
  context.font = theme.font;
  cells.forEach((cell) => {
    context.fillStyle = cell.focused ? theme.focusBackground : cell.hit ? theme.hitBackground : theme.cellBackground;
    context.fillRect(cell.x, cell.y, cell.width, cell.height);
    context.strokeStyle = theme.border;
    context.strokeRect(cell.x, cell.y, cell.width, cell.height);
    context.fillStyle = theme.cellText;
    const text = truncateFastGridText(cell.text, Math.max(10, cell.width - textMaxInset), context);
    context.fillText(text, cell.x + textInset, cell.y + textBaselineOffset);
  });
}
```

- [ ] **Step 6: Scale the fast grid font**

In `getFastTableGridTheme(canvas)`, replace:

```js
font: `12px ${fontFamily}`,
```

with:

```js
font: `${Math.round(12 * tableVisualScale.value)}px ${fontFamily}`,
```

- [ ] **Step 7: Use scaled metrics in hit testing**

In `resolveFastTableGridHit(event)`, replace the geometry constants with:

```js
rowHeight: scaledTableRowHeight.value,
headerHeight: scaledTableHeaderHeight.value,
rowNumberWidth: scaledTableRowHandleWidth.value,
fallbackColumnWidth: Math.round(TABLE_COLUMN_WIDTH_FALLBACK * tableVisualScale.value),
```

In `onFastTableGridPointerDown(event)`, replace the geometry constants in the `hitTestFastGridColumnResize` call with:

```js
headerHeight: scaledTableHeaderHeight.value,
rowNumberWidth: scaledTableRowHandleWidth.value,
fallbackColumnWidth: Math.round(TABLE_COLUMN_WIDTH_FALLBACK * tableVisualScale.value),
```

- [ ] **Step 8: Run the focused test and verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit fast grid scaled geometry**

```bash
git add src/App.vue src/fastTableGrid.test.js
git commit -m "fix: draw fast table grid with scaled metrics"
```

### Task 4: Verify UI behavior and full frontend build

**Files:**
- Verify: `src/App.vue`
- Verify: `src/styles.css`
- Verify: `src/fastTableGrid.test.js`

- [ ] **Step 1: Run all frontend unit tests**

Run:

```bash
node --test src/*.test.js
```

Expected: PASS for all frontend test files.

- [ ] **Step 2: Run the frontend production build**

Run:

```bash
npm run build
```

Expected: PASS. Vite should finish without Vue compile errors.

- [ ] **Step 3: Start the frontend dev server**

Run:

```bash
npm run dev
```

Expected: Vite starts on port 1430 and reports a local URL. Keep the command running while testing in the browser.

- [ ] **Step 4: Manually test table zoom crispness**

Open the panel in the running app or browser preview, navigate to a large full table such as `demo_audit_logs`, place the pointer over the table data area, then press Ctrl and scroll up several notches.

Expected:
- Table text becomes larger without blurry raster scaling.
- Header text, row numbers, and cell text stay aligned.
- Horizontal and vertical scrollbars still move the correct content.
- Clicking a cell opens or focuses the expected row/column.
- Column resize handles still align with header boundaries.

- [ ] **Step 5: Manually test zoom down and non-table UI scope**

With the same table open, Ctrl+scroll down to return near the normal scale.

Expected:
- Table text remains crisp while shrinking.
- Search panel buttons and window chrome do not receive a separate table-only distortion.
- Edit mode still falls back to the DOM table path and remains usable.

- [ ] **Step 6: Stop the dev server**

Stop the `npm run dev` process with Ctrl+C in the terminal that is running it.

- [ ] **Step 7: Commit verification-safe final state**

```bash
git add src/App.vue src/styles.css src/fastTableGrid.test.js
git commit -m "fix: keep table zoom rendering crisp"
```

Only run this commit if Task 4 required additional code changes after Task 3. If no files changed after Task 3, skip this commit.

---

## Self-Review

- Spec coverage: The plan covers replacing CSS `zoom`, scaling DOM table layout, scaling fast grid dimensions, scaling canvas drawing and font metrics, preserving Ctrl+wheel behavior, and verifying tests/build/manual UI behavior.
- Placeholder scan: No TBD/TODO/fill-in-later placeholders remain.
- Type consistency: The plan consistently uses `tableVisualScale`, `scaledTableHeaderHeight`, `scaledTableRowHeight`, and `scaledTableRowHandleWidth` across tests, layout, drawing, and hit testing.
