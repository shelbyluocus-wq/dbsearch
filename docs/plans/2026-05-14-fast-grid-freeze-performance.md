# Fast Grid Freeze Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep read-only table browsing on the fast canvas grid when columns or rows are frozen, so frozen browsing stays as fast as the unfrozen path.

**Architecture:** The current performance cliff comes from `App.vue` disabling `shouldUseFastTableGrid` whenever `frozenColumnName` or `frozenRowIndex` is set. Extend `src/fastTableGrid.js` so the canvas path can model frozen columns/rows, then wire `App.vue` to pass freeze boundaries into visible-column selection, draw-model construction, hit testing, resize hit testing, and table-find scroll targeting. Keep edit mode and freeze-pick mode on the DOM table path.

**Tech Stack:** Vue 3 Composition API in `src/App.vue`, pure JavaScript table helpers in `src/fastTableGrid.js`, Node.js built-in test runner.

---

## Constraints

- Follow TDD: write each failing test first, run it, then implement the minimal code.
- Do not commit unless the user explicitly asks.
- Do not change edit-mode rendering; edit mode must stay on the DOM table.
- Do not add a second virtualization system; reuse the existing fast canvas grid.
- Use scaled layout metrics already present in `App.vue`.

## Task 1: Add frozen column visibility model

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify: `src/fastTableGrid.js`

**Step 1: Write the failing test**

Add a test near the existing `getVisibleFastGridColumns` tests:

```js
test("getVisibleFastGridColumns keeps frozen columns fixed while virtualizing scrollable columns", () => {
  const columns = [
    { column_name: "id" },
    { column_name: "name" },
    { column_name: "email" },
    { column_name: "role" },
  ];

  assert.deepEqual(
    getVisibleFastGridColumns({
      columns,
      scrollLeft: 260,
      clientWidth: 220,
      rowNumberWidth: 52,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180, role: 140 })[name],
      frozenColumnName: "name",
      overscan: 0,
    }),
    [
      { column: columns[0], index: 0, x: 52, width: 80, frozen: true, edge: false },
      { column: columns[1], index: 1, x: 132, width: 120, frozen: true, edge: true },
      { column: columns[2], index: 2, x: 252, width: 180, frozen: false },
      { column: columns[3], index: 3, x: 432, width: 140, frozen: false },
    ],
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL because `getVisibleFastGridColumns` ignores `frozenColumnName` and does not add `frozen`/`edge` metadata.

**Step 3: Implement minimal code**

In `src/fastTableGrid.js`, update `getVisibleFastGridColumns`:

- Accept `frozenColumnName = ""`.
- Find the frozen boundary index with `columns.findIndex`.
- Always include columns from index `0` through the frozen boundary.
- Mark included frozen columns with `{ frozen: true, edge: index === frozenIndex }`.
- Continue returning scrollable visible columns for all non-frozen columns using the existing virtual coordinates and overscan logic.
- Avoid duplicates when a frozen column also intersects the scroll window.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

---

## Task 2: Draw frozen columns at fixed viewport x positions

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify: `src/fastTableGrid.js`

**Step 1: Write the failing test**

Add near `buildFastGridDrawModel includes only visible cells`:

```js
test("buildFastGridDrawModel keeps frozen column cells fixed during horizontal scroll", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];
  const rows = [{ id: "1", name: "Alice", email: "a@example.test" }];

  const model = buildFastGridDrawModel({
    rows,
    rowStartIndex: 0,
    visibleColumns: [
      { column: columns[0], index: 0, x: 52, width: 80, frozen: true, edge: false },
      { column: columns[1], index: 1, x: 132, width: 120, frozen: true, edge: true },
      { column: columns[2], index: 2, x: 252, width: 180, frozen: false },
    ],
    rowHeight: 31,
    headerHeight: 34,
    scrollTop: 0,
    scrollLeft: 200,
  });

  assert.deepEqual(model.cells, [
    { rowIndex: 0, columnName: "id", text: "1", x: 52, y: 34, width: 80, height: 31, frozenColumn: true, frozenColumnEdge: false },
    { rowIndex: 0, columnName: "name", text: "Alice", x: 132, y: 34, width: 120, height: 31, frozenColumn: true, frozenColumnEdge: true },
    { rowIndex: 0, columnName: "email", text: "a@example.test", x: 52, y: 34, width: 180, height: 31 },
  ]);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL because frozen cells currently subtract `scrollLeft` like normal cells and do not expose frozen metadata.

**Step 3: Implement minimal code**

In `buildFastGridDrawModel`:

- For each visible column, if `columnInfo.frozen` is true, set `cell.x = x` instead of `x - scrollLeft`.
- Add `frozenColumn: true` and `frozenColumnEdge: Boolean(edge)` only for frozen columns.
- Leave non-frozen cell shape unchanged to avoid breaking existing tests.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

---

## Task 3: Add frozen row draw-model support

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify: `src/fastTableGrid.js`

**Step 1: Write the failing test**

Add near the draw-model tests:

```js
test("buildFastGridDrawModel keeps frozen rows fixed during vertical scroll", () => {
  const columns = [{ column_name: "id" }];
  const rows = [{ id: "1" }, { id: "2" }, { id: "3" }];

  const model = buildFastGridDrawModel({
    rows,
    rowStartIndex: 0,
    visibleColumns: [{ column: columns[0], index: 0, x: 52, width: 80 }],
    rowHeight: 31,
    headerHeight: 34,
    scrollTop: 62,
    scrollLeft: 0,
    frozenRowIndex: 1,
  });

  assert.deepEqual(model.cells, [
    { rowIndex: 0, columnName: "id", text: "1", x: 52, y: 34, width: 80, height: 31, frozenRow: true, frozenRowEdge: false },
    { rowIndex: 1, columnName: "id", text: "2", x: 52, y: 65, width: 80, height: 31, frozenRow: true, frozenRowEdge: true },
    { rowIndex: 2, columnName: "id", text: "3", x: 52, y: 34, width: 80, height: 31 },
  ]);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL because `buildFastGridDrawModel` ignores `frozenRowIndex`.

**Step 3: Implement minimal code**

In `buildFastGridDrawModel`:

- Accept `frozenRowIndex = null`.
- Treat rows with `rowIndex <= frozenRowIndex` as frozen only when `frozenRowIndex` is a valid integer.
- For frozen rows, compute `y = headerPx + rowIndex * rowPx` without subtracting `scrollTop`.
- Add `frozenRow: true` and `frozenRowEdge: rowIndex === frozenRowIndex` only for frozen rows.
- Leave non-frozen rows unchanged.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

---

## Task 4: Make hit testing prefer frozen panes

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify: `src/fastTableGrid.js`

**Step 1: Write failing tests**

Add near `hitTestFastGrid maps viewport coordinates to row and column`:

```js
test("hitTestFastGrid maps fixed frozen columns before scrolled columns", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];

  assert.deepEqual(
    hitTestFastGrid({
      x: 150,
      y: 70,
      scrollLeft: 240,
      scrollTop: 0,
      rowHeight: 31,
      headerHeight: 34,
      rowNumberWidth: 52,
      totalRows: 100,
      columns,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180 })[name],
      frozenColumnName: "name",
    }),
    { region: "cell", rowIndex: 1, columnIndex: 1, columnName: "name", frozenColumn: true },
  );
});

test("hitTestFastGrid maps fixed frozen rows before scrolled rows", () => {
  const columns = [{ column_name: "id" }];

  assert.deepEqual(
    hitTestFastGrid({
      x: 70,
      y: 70,
      scrollLeft: 0,
      scrollTop: 310,
      rowHeight: 31,
      headerHeight: 34,
      rowNumberWidth: 52,
      totalRows: 100,
      columns,
      getColumnWidth: () => 80,
      frozenRowIndex: 1,
    }),
    { region: "cell", rowIndex: 1, columnIndex: 0, columnName: "id", frozenRow: true },
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL because hit testing always maps `x + scrollLeft` and `y + scrollTop`.

**Step 3: Implement minimal code**

In `src/fastTableGrid.js`:

- Add a helper that finds a frozen column at viewport x without adding `scrollLeft`.
- Add a helper that maps a viewport y to a frozen row when `y` falls inside the fixed frozen row band.
- In `hitTestFastGrid`, prefer frozen row/column intersections before normal scrolled hit testing.
- For header hits, prefer frozen column headers before normal scrolled headers.
- Include `frozenColumn: true` and/or `frozenRow: true` on hit results only when applicable.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

---

## Task 5: Make column resize hit testing work on frozen headers

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify: `src/fastTableGrid.js`

**Step 1: Write the failing test**

Add near resize tests:

```js
test("hitTestFastGridColumnResize detects frozen header edges without scroll offset", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];

  assert.deepEqual(
    hitTestFastGridColumnResize({
      x: 250,
      y: 18,
      scrollLeft: 300,
      columns,
      rowNumberWidth: 52,
      headerHeight: 34,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180 })[name],
      handleWidth: 6,
      frozenColumnName: "name",
    }),
    { columnIndex: 1, columnName: "name", edgeX: 252, frozenColumn: true },
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL because resize hit testing only checks scrolled virtual edges.

**Step 3: Implement minimal code**

In `hitTestFastGridColumnResize`:

- Accept `frozenColumnName = ""`.
- Before the existing virtual-edge loop, check frozen column edges against viewport `x` with no `scrollLeft` offset.
- Return the same shape as before plus `frozenColumn: true` for frozen hits.
- Keep existing behavior for non-frozen columns.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

---

## Task 6: Keep table-find scroll targets from hiding matches behind frozen panes

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify: `src/fastTableGrid.js`

**Step 1: Write failing tests**

Add near `resolveFastGridCellScrollTarget maps a table-find match`:

```js
test("resolveFastGridCellScrollTarget does not scroll horizontally for frozen columns", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "email" }];

  assert.deepEqual(
    resolveFastGridCellScrollTarget({
      rowIndex: 10,
      columnName: "name",
      rowHeight: 31,
      rowNumberWidth: 52,
      columns,
      getColumnWidth: (name) => ({ id: 80, name: 120, email: 180 })[name],
      frozenColumnName: "name",
      currentScrollLeft: 260,
    }),
    {
      rowIndex: 10,
      columnName: "name",
      scrollTop: 310,
      scrollLeft: 260,
    },
  );
});

test("resolveFastGridCellScrollTarget does not scroll vertically for frozen rows", () => {
  const columns = [{ column_name: "id" }];

  assert.deepEqual(
    resolveFastGridCellScrollTarget({
      rowIndex: 1,
      columnName: "id",
      rowHeight: 31,
      rowNumberWidth: 52,
      columns,
      getColumnWidth: () => 80,
      frozenRowIndex: 1,
      currentScrollTop: 620,
    }),
    {
      rowIndex: 1,
      columnName: "id",
      scrollTop: 620,
      scrollLeft: 0,
    },
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL because the helper always scrolls to the target row/column.

**Step 3: Implement minimal code**

In `resolveFastGridCellScrollTarget`:

- Accept `frozenColumnName = ""`, `frozenRowIndex = null`, and `currentScrollTop = 0`.
- If the target column is within the frozen column boundary, keep `scrollLeft = currentScrollLeft`.
- If the target row is within the frozen row boundary, keep `scrollTop = currentScrollTop`.
- Preserve existing behavior for non-frozen targets.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

---

## Task 7: Wire frozen fast-grid support into App.vue

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify: `src/App.vue`

**Step 1: Write failing App.vue structure tests**

Replace the current test named `App.vue keeps freeze states on the DOM table path while allowing fullscreen fast grid` with:

```js
test("App.vue keeps frozen read-only browsing on the fast grid path", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const guardStart = appVue.indexOf("const shouldUseFastTableGrid = computed");
  const guardEnd = appVue.indexOf("const fastTableGridScrollSize = computed");
  const guard = appVue.slice(guardStart, guardEnd);

  assert.notEqual(guardStart, -1);
  assert.notEqual(guardEnd, -1);
  assert.match(guard, /!freezePickMode\.value/);
  assert.doesNotMatch(guard, /!frozenColumnName\.value/);
  assert.doesNotMatch(guard, /frozenRowIndex\.value === null/);
  assert.match(guard, /!editMode\.value/);
});

test("App.vue passes frozen boundaries into fast grid helpers", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const visibleStart = appVue.indexOf("function drawFastTableGrid()");
  const visibleEnd = appVue.indexOf("function readFastTableGridCssValue", visibleStart);
  const drawBody = appVue.slice(visibleStart, visibleEnd);
  const hitStart = appVue.indexOf("function resolveFastTableGridHit");
  const hitEnd = appVue.indexOf("function onFastTableGridPointerDown", hitStart);
  const hitBody = appVue.slice(hitStart, hitEnd);
  const focusStart = appVue.indexOf("async function focusTableFindMatch");
  const focusEnd = appVue.indexOf("async function runTableFind", focusStart);
  const focusBody = appVue.slice(focusStart, focusEnd);

  assert.match(drawBody, /frozenColumnName: frozenColumnName\.value/);
  assert.match(drawBody, /frozenRowIndex: frozenRowIndex\.value/);
  assert.match(hitBody, /frozenColumnName: frozenColumnName\.value/);
  assert.match(hitBody, /frozenRowIndex: frozenRowIndex\.value/);
  assert.match(focusBody, /frozenColumnName: frozenColumnName\.value/);
  assert.match(focusBody, /frozenRowIndex: frozenRowIndex\.value/);
  assert.match(focusBody, /currentScrollLeft: viewport\.scrollLeft/);
  assert.match(focusBody, /currentScrollTop: viewport\.scrollTop/);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL because `shouldUseFastTableGrid` still excludes frozen states and helper calls do not pass freeze boundaries.

**Step 3: Implement minimal App.vue changes**

In `src/App.vue`:

- Remove `!frozenColumnName.value` and `frozenRowIndex.value === null` from `shouldUseFastTableGrid`.
- Keep `!freezePickMode.value` and `!editMode.value` so selection and editing remain DOM-backed.
- Pass `frozenColumnName: frozenColumnName.value` into `getVisibleFastGridColumns`, `hitTestFastGrid`, `hitTestFastGridColumnResize`, `resolveFastGridColumnResizeCursor`, and `resolveFastGridCellScrollTarget`.
- Pass `frozenRowIndex: frozenRowIndex.value` into `buildFastGridDrawModel`, `hitTestFastGrid`, and `resolveFastGridCellScrollTarget`.
- Pass `currentScrollLeft: viewport.scrollLeft` and `currentScrollTop: viewport.scrollTop` to table-find scroll targeting.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

---

## Task 8: Draw frozen panes above scrollable cells in App.vue

**Files:**
- Modify: `src/fastTableGrid.test.js`
- Modify: `src/App.vue`

**Step 1: Write failing structure test**

Add near `App.vue draws fixed fast grid headers and the row-number gutter`:

```js
test("App.vue draws scrollable fast-grid cells before frozen panes", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  const rowsStart = appVue.indexOf("function drawFastTableGridRows");
  const rowsEnd = appVue.indexOf("function drawFastTableGridRowHeaders", rowsStart);
  const rowsBody = appVue.slice(rowsStart, rowsEnd);

  assert.notEqual(rowsStart, -1);
  assert.notEqual(rowsEnd, -1);
  assert.match(rowsBody, /const scrollableCells = cells\.filter/);
  assert.match(rowsBody, /const frozenCells = cells\.filter/);
  assert.match(rowsBody, /scrollableCells\.forEach/);
  assert.match(rowsBody, /frozenCells\.forEach/);
  assert.ok(rowsBody.indexOf("scrollableCells.forEach") < rowsBody.indexOf("frozenCells.forEach"));
  assert.match(rowsBody, /cell\.frozenColumnEdge/);
  assert.match(rowsBody, /cell\.frozenRowEdge/);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: FAIL because App.vue draws cells in one pass.

**Step 3: Implement minimal drawing changes**

In `drawFastTableGridRows` in `src/App.vue`:

- Split cells into `scrollableCells` and `frozenCells`, where frozen means `cell.frozenColumn || cell.frozenRow`.
- Draw scrollable cells first, frozen cells second.
- Keep existing fill/text/focus/hit rendering behavior.
- For `frozenColumnEdge` and `frozenRowEdge`, draw a subtle boundary line using the existing border color.
- Do not add shadows or expensive effects.

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/fastTableGrid.test.js
```

Expected: PASS.

---

## Task 9: Verify targeted tests and build

**Files:**
- No code changes expected.

**Step 1: Run helper tests**

Run:

```bash
node --test src/fastTableGrid.test.js src/tableFreeze.test.js
```

Expected: PASS.

**Step 2: Run all frontend tests**

Run:

```bash
node --test src/*.test.js
```

Expected: PASS.

**Step 3: Run frontend build**

Run:

```bash
npm run build
```

Expected: PASS.

---

## Task 10: Manual UI verification

**Files:**
- No code changes expected unless verification finds a defect.

**Step 1: Start the app**

Run:

```bash
npm run tauri dev
```

Expected: Vite starts on port 1430 and Tauri opens DB Scout.

**Step 2: Verify unfrozen browsing baseline**

- Open a large table in read-only full-table browsing.
- Scroll horizontally and vertically.
- Confirm the fast grid behaves as before.

**Step 3: Verify frozen column browsing**

- Enter freeze-pick mode.
- Freeze a column after the first few columns.
- Confirm the app remains on the fast canvas grid after applying freeze.
- Scroll horizontally and vertically.
- Confirm frozen columns stay fixed and browsing remains smooth.
- Click and double-click frozen cells to confirm cell viewer behavior still works.
- Resize a frozen column header and confirm the width updates.

**Step 4: Verify frozen row browsing**

- Freeze a row.
- Scroll vertically.
- Confirm frozen rows stay fixed and browsing remains smooth.
- Click frozen row cells and row headers.

**Step 5: Verify fallback paths**

- Enter edit mode and confirm the DOM table path still appears.
- Enter freeze-pick mode and confirm preview selection still works.
- Clear freeze and confirm normal fast-grid browsing still works.

---

## Success Criteria

- `shouldUseFastTableGrid` remains true for read-only full table browsing with active frozen columns/rows.
- Frozen columns and rows are drawn at fixed viewport positions in canvas.
- Hit testing, double click, context menu, table-find focus, and column resize work on frozen panes.
- Edit mode and freeze-pick mode remain DOM-based.
- `node --test src/*.test.js` and `npm run build` pass.
- Manual UI verification confirms frozen browsing is smooth.
