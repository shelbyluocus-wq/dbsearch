# Table Freeze Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add hover-triggered freeze controls to the table view so users can freeze columns up to a selected field and rows up to a selected row.

**Architecture:** Keep the existing single-table structure in `src/App.vue` and add minimal state for the current column and row freeze boundaries. Extract sticky offset/range calculations into a pure helper module so the layout math is testable before wiring it into the Vue template and CSS.

**Tech Stack:** Vue 3 `<script setup>`, Tauri frontend, CSS sticky positioning, Node.js built-in test runner.

---

### Task 1: Add pure freeze layout helpers

**Files:**
- Create: `src/tableFreeze.js`
- Create: `src/tableFreeze.test.js`

**Step 1: Write the failing tests**

Create `src/tableFreeze.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFrozenColumnMeta,
  buildFrozenRowMeta,
  normalizeFreezeBoundary,
} from './tableFreeze.js';

test('normalizeFreezeBoundary toggles an existing boundary off', () => {
  assert.equal(normalizeFreezeBoundary('name', 'name'), null);
  assert.equal(normalizeFreezeBoundary('name', 'age'), 'age');
  assert.equal(normalizeFreezeBoundary(null, 'id'), 'id');
});

test('buildFrozenColumnMeta returns sticky offsets up to frozen column', () => {
  const columns = ['id', 'name', 'age'];
  const widths = { id: 80, name: 160, age: 120 };
  const meta = buildFrozenColumnMeta({
    columns,
    columnWidths: widths,
    frozenColumnName: 'name',
    leadingWidth: 18,
  });

  assert.deepEqual(meta.id, { frozen: true, left: 18, edge: false });
  assert.deepEqual(meta.name, { frozen: true, left: 98, edge: true });
  assert.deepEqual(meta.age, { frozen: false, left: null, edge: false });
});

test('buildFrozenColumnMeta includes edit checkbox leading width', () => {
  const meta = buildFrozenColumnMeta({
    columns: ['id', 'name'],
    columnWidths: { id: 80, name: 160 },
    frozenColumnName: 'id',
    leadingWidth: 40,
  });

  assert.deepEqual(meta.id, { frozen: true, left: 40, edge: true });
  assert.deepEqual(meta.name, { frozen: false, left: null, edge: false });
});

test('buildFrozenColumnMeta ignores missing frozen column', () => {
  const meta = buildFrozenColumnMeta({
    columns: ['id', 'name'],
    columnWidths: { id: 80, name: 160 },
    frozenColumnName: 'missing',
    leadingWidth: 18,
  });

  assert.deepEqual(meta.id, { frozen: false, left: null, edge: false });
  assert.deepEqual(meta.name, { frozen: false, left: null, edge: false });
});

test('buildFrozenRowMeta returns sticky top offsets up to frozen row', () => {
  const meta = buildFrozenRowMeta({ rowCount: 4, frozenRowIndex: 2, headerHeight: 34, rowHeight: 31 });

  assert.deepEqual(meta[0], { frozen: true, top: 34, edge: false });
  assert.deepEqual(meta[1], { frozen: true, top: 65, edge: false });
  assert.deepEqual(meta[2], { frozen: true, top: 96, edge: true });
  assert.deepEqual(meta[3], { frozen: false, top: null, edge: false });
});

test('buildFrozenRowMeta ignores invalid frozen row', () => {
  const meta = buildFrozenRowMeta({ rowCount: 2, frozenRowIndex: 5, headerHeight: 34, rowHeight: 31 });

  assert.deepEqual(meta[0], { frozen: false, top: null, edge: false });
  assert.deepEqual(meta[1], { frozen: false, top: null, edge: false });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/tableFreeze.test.js
```

Expected: FAIL because `src/tableFreeze.js` does not exist.

**Step 3: Write minimal implementation**

Create `src/tableFreeze.js`:

```js
export function normalizeFreezeBoundary(currentBoundary, nextBoundary) {
  return currentBoundary === nextBoundary ? null : nextBoundary;
}

export function buildFrozenColumnMeta({ columns, columnWidths, frozenColumnName, leadingWidth = 0 }) {
  const frozenIndex = columns.indexOf(frozenColumnName);
  let left = leadingWidth;

  return Object.fromEntries(columns.map((columnName, index) => {
    if (frozenIndex < 0 || index > frozenIndex) {
      return [columnName, { frozen: false, left: null, edge: false }];
    }

    const meta = { frozen: true, left, edge: index === frozenIndex };
    left += Number(columnWidths[columnName]) || 0;
    return [columnName, meta];
  }));
}

export function buildFrozenRowMeta({ rowCount, frozenRowIndex, headerHeight, rowHeight }) {
  return Array.from({ length: rowCount }, (_, index) => {
    if (!Number.isInteger(frozenRowIndex) || frozenRowIndex < 0 || index > frozenRowIndex || frozenRowIndex >= rowCount) {
      return { frozen: false, top: null, edge: false };
    }

    return {
      frozen: true,
      top: headerHeight + index * rowHeight,
      edge: index === frozenRowIndex,
    };
  });
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/tableFreeze.test.js
```

Expected: PASS.

**Step 5: Commit**

Only commit if the user explicitly asks for commits. Otherwise skip this step and keep changes local.

```bash
git add src/tableFreeze.js src/tableFreeze.test.js
git commit -m "feat: add table freeze layout helpers"
```

---

### Task 2: Wire freeze state and computed metadata into App.vue

**Files:**
- Modify: `src/App.vue`

**Step 1: Write the failing integration points**

Modify the `<script setup>` imports in `src/App.vue` to import the helpers:

```js
import { buildFrozenColumnMeta, buildFrozenRowMeta, normalizeFreezeBoundary } from './tableFreeze.js';
```

Add state near the existing table/grid refs around the current `gridFocus`, `gridRange`, or table state area:

```js
const frozenColumnName = ref(null);
const frozenRowIndex = ref(null);
```

Add constants and computed values near the table-view computed helpers:

```js
const TABLE_ROW_HANDLE_WIDTH = 18;
const TABLE_EDIT_CHECKBOX_WIDTH = 22;
const TABLE_HEADER_HEIGHT = 34;
const TABLE_ROW_HEIGHT = 31;

const tableLeadingStickyWidth = computed(() => (
  editMode.value
    ? TABLE_ROW_HANDLE_WIDTH + TABLE_EDIT_CHECKBOX_WIDTH
    : TABLE_ROW_HANDLE_WIDTH
));

const frozenColumnMeta = computed(() => buildFrozenColumnMeta({
  columns: tableView.value.columns.map((column) => column.column_name),
  columnWidths: Object.fromEntries(
    tableView.value.columns.map((column) => [column.column_name, getColumnWidth(column.column_name)]),
  ),
  frozenColumnName: frozenColumnName.value,
  leadingWidth: tableLeadingStickyWidth.value,
}));

const frozenRowMeta = computed(() => buildFrozenRowMeta({
  rowCount: tableView.value.rows.length,
  frozenRowIndex: frozenRowIndex.value,
  headerHeight: TABLE_HEADER_HEIGHT,
  rowHeight: TABLE_ROW_HEIGHT,
}));
```

If `getColumnWidth(columnName)` does not already exist, add it beside `getColumnStyle(columnName)` and make it return the numeric width currently used by `getColumnStyle`.

Add handlers:

```js
function toggleFrozenColumn(columnName) {
  frozenColumnName.value = normalizeFreezeBoundary(frozenColumnName.value, columnName);
}

function toggleFrozenRow(rowIndex) {
  frozenRowIndex.value = normalizeFreezeBoundary(frozenRowIndex.value, rowIndex);
}
```

Add a reset helper:

```js
function resetTableFreeze() {
  frozenColumnName.value = null;
  frozenRowIndex.value = null;
}
```

**Step 2: Run tests to expose missing references**

Run:

```bash
node --test src/tableFreeze.test.js
npm run build
```

Expected: helper tests pass; build may fail until `getColumnWidth` is correctly aligned with existing column style code.

**Step 3: Implement missing column width extraction**

Find the existing `getColumnStyle(columnName)` in `src/App.vue`. Extract the width decision into a numeric helper while preserving current behavior. Use the actual existing width maps/constants from that function.

Target shape:

```js
function getColumnWidth(columnName) {
  // Return the same pixel width used by getColumnStyle(columnName).
}

function getColumnStyle(columnName) {
  const width = getColumnWidth(columnName);
  return {
    width: `${width}px`,
    minWidth: `${width}px`,
    maxWidth: `${width}px`,
  };
}
```

Do not change existing resize/collapse behavior.

**Step 4: Reset freeze state at view-boundary changes**

Call `resetTableFreeze()` in existing flows that replace the current table view:

- table switch/open flow
- refresh data flow
- new search/table result load flow

Use the smallest number of calls that reliably clear stale boundaries. Do not clear on pagination unless the current implementation replaces `tableView.rows` with a different page and stale row indexes would be misleading; if pagination replaces rows, clear row freeze only.

**Step 5: Run checks**

Run:

```bash
node --test src/tableFreeze.test.js
npm run build
```

Expected: both pass.

**Step 6: Commit**

Only commit if the user explicitly asks for commits. Otherwise skip this step.

```bash
git add src/App.vue src/tableFreeze.js src/tableFreeze.test.js
git commit -m "feat: track table freeze boundaries"
```

---

### Task 3: Add freeze buttons and sticky classes to the table template

**Files:**
- Modify: `src/App.vue:13138-13276`

**Step 1: Update the table header template**

In `src/App.vue`, change the header row so there is always a row-handle header column. Keep the checkbox header only in edit mode.

Target shape:

```vue
<th class="edit-row-handle-col table-freeze-corner"></th>
<th v-if="editMode" class="edit-checkbox-col">
  <input type="checkbox" title="选择当前页" @click.stop.prevent="toggleSelectAll" :checked="editAllPageRowsSelected" />
</th>
```

Inside each data column `<th>`, merge the existing classes with freeze classes:

```vue
:class="{
  'hit-col': isDataColumnHit(col.column_name),
  'frozen-col': frozenColumnMeta[col.column_name]?.frozen,
  'frozen-col-edge': frozenColumnMeta[col.column_name]?.edge,
}"
```

Merge sticky style with existing width style:

```vue
:style="getFrozenColumnStyle(col.column_name)"
```

Add the column freeze button inside `.th-content`, after the label and before the collapse badge:

```vue
<button
  class="freeze-btn column-freeze-btn"
  :class="{ active: frozenColumnName === col.column_name }"
  :title="frozenColumnName === col.column_name ? '取消冻结到此列' : '冻结到此列'"
  @click.stop.prevent="toggleFrozenColumn(col.column_name)"
>▥</button>
```

Add helper:

```js
function getFrozenColumnStyle(columnName) {
  const baseStyle = getColumnStyle(columnName);
  const meta = frozenColumnMeta.value[columnName];
  if (!meta?.frozen) return baseStyle;

  return {
    ...baseStyle,
    position: 'sticky',
    left: `${meta.left}px`,
    zIndex: meta.edge ? 5 : 4,
  };
}
```

**Step 2: Update normal data rows**

Always render the row handle cell. In edit mode keep the existing selection behavior; outside edit mode use it only for the freeze button.

Target shape for the first cell in each normal row:

```vue
<td
  class="edit-row-handle-col row-freeze-handle-col"
  :class="{
    'frozen-row': frozenRowMeta[idx]?.frozen,
    'frozen-row-edge': frozenRowMeta[idx]?.edge,
  }"
  :style="getFrozenRowHandleStyle(idx)"
  @mousedown.stop.prevent="editMode && onRowHandleMouseDown(idx, 'page')"
  @mouseenter="editMode && onRowHandleMouseEnter(idx, 'page')"
  title="冻结到此行"
>
  <button
    class="freeze-btn row-freeze-btn"
    :class="{ active: frozenRowIndex === idx }"
    :title="frozenRowIndex === idx ? '取消冻结到此行' : '冻结到此行'"
    @click.stop.prevent="toggleFrozenRow(idx)"
  >▤</button>
  <span v-if="editMode" class="edit-row-handle">⠿</span>
</td>
```

For each normal data `<tr>`, add classes and style:

```vue
:class="{
  ...existingClasses,
  'frozen-row': frozenRowMeta[idx]?.frozen,
  'frozen-row-edge': frozenRowMeta[idx]?.edge,
}"
:style="getFrozenRowStyle(idx)"
```

For each normal data `<td>`, change style to merge row and column sticky behavior:

```vue
:style="getFrozenCellStyle(idx, col.column_name)"
```

Add helpers:

```js
function getFrozenRowStyle(rowIndex) {
  const meta = frozenRowMeta.value[rowIndex];
  if (!meta?.frozen) return null;
  return {
    position: 'sticky',
    top: `${meta.top}px`,
    zIndex: meta.edge ? 3 : 2,
  };
}

function getFrozenRowHandleStyle(rowIndex) {
  const rowStyle = getFrozenRowStyle(rowIndex) || {};
  return {
    ...rowStyle,
    position: 'sticky',
    left: '0px',
    zIndex: frozenRowMeta.value[rowIndex]?.frozen ? 7 : 3,
  };
}

function getFrozenCellStyle(rowIndex, columnName) {
  const columnStyle = getFrozenColumnStyle(columnName);
  const rowMeta = frozenRowMeta.value[rowIndex];
  const columnMeta = frozenColumnMeta.value[columnName];

  if (!rowMeta?.frozen) return columnStyle;

  return {
    ...columnStyle,
    position: 'sticky',
    top: `${rowMeta.top}px`,
    zIndex: columnMeta?.frozen ? 8 : rowMeta.edge ? 3 : 2,
  };
}
```

If sticky `<tr>` is unreliable in Chromium/Tauri for this table, remove `getFrozenRowStyle` from `<tr>` and apply `getFrozenCellStyle()` to every row cell plus `getFrozenRowHandleStyle()` to the handle cell. Prefer sticky cells over sticky rows if behavior differs.

**Step 3: Update insert rows**

Keep insert rows unfrozen. Because normal mode now always has a row handle column, ensure insert rows still align:

- Insert rows already have row handle and checkbox/remove columns in edit mode.
- No change is needed for non-edit mode because insert rows only render in edit mode.

**Step 4: Run checks**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 5: Commit**

Only commit if the user explicitly asks for commits. Otherwise skip this step.

```bash
git add src/App.vue
git commit -m "feat: add table freeze controls"
```

---

### Task 4: Add visual styles for freeze controls and boundaries

**Files:**
- Modify: `src/styles.css:3448-3527`
- Modify: `src/styles.css:5071-5089`

**Step 1: Add button and hover styles**

Add near the existing table header styles:

```css
.freeze-btn {
  width: 16px;
  height: 16px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--accent-line);
  border-radius: 4px;
  background: color-mix(in srgb, var(--surface-card) 86%, transparent);
  color: var(--text-sub);
  font-size: 10px;
  line-height: 1;
  opacity: 0;
  cursor: pointer;
  user-select: none;
  transition: opacity 140ms ease, background 140ms ease, color 140ms ease, border-color 140ms ease, transform 140ms ease;
}

.freeze-btn:hover,
.freeze-btn.active {
  background: var(--accent-tint);
  color: var(--accent-text);
  border-color: var(--accent-line);
  opacity: 1;
  transform: translateY(-1px);
}

.data-table th:hover .column-freeze-btn,
.data-table tr:hover .row-freeze-btn,
.freeze-btn.active {
  opacity: 0.95;
}
```

**Step 2: Add frozen region styles**

Add near table state styles:

```css
.data-table th.frozen-col,
.data-table td.frozen-col {
  background: color-mix(in srgb, var(--surface-card) 94%, var(--accent-soft));
}

.data-table th.frozen-col-edge,
.data-table td.frozen-col-edge {
  box-shadow: inset -2px 0 0 var(--accent-line);
}

.data-table tr.frozen-row > td,
.data-table tr.frozen-row > th,
.data-table td.frozen-row {
  background: color-mix(in srgb, var(--surface-card) 92%, var(--accent-soft));
}

.data-table tr.frozen-row-edge > td,
.data-table td.frozen-row-edge {
  box-shadow: inset 0 -2px 0 var(--accent-line);
}
```

If this overwrites existing hit/find/edit backgrounds too aggressively, narrow the selectors or use `background-color` only on non-hit cells.

**Step 3: Add row handle behavior**

Add near `.edit-row-handle-col`:

```css
.row-freeze-handle-col {
  background: rgba(226, 236, 248, 0.96);
  z-index: 2;
}

.row-freeze-handle-col .row-freeze-btn {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
}

.row-freeze-handle-col .row-freeze-btn:hover,
.row-freeze-handle-col .row-freeze-btn.active {
  transform: translate(-50%, -50%);
}

.row-freeze-handle-col .edit-row-handle {
  transition: opacity 140ms ease;
}

.row-freeze-handle-col:hover .edit-row-handle,
.row-freeze-handle-col:has(.row-freeze-btn.active) .edit-row-handle {
  opacity: 0;
}
```

If `:has()` support is a concern in the bundled WebView, replace the last selector with a Vue class such as `row-freeze-active`.

**Step 4: Run checks**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 5: Commit**

Only commit if the user explicitly asks for commits. Otherwise skip this step.

```bash
git add src/styles.css
git commit -m "style: add table freeze visuals"
```

---

### Task 5: Run full frontend tests and browser validation

**Files:**
- Verify: `src/App.vue`
- Verify: `src/styles.css`
- Verify: `src/tableFreeze.js`
- Verify: `src/tableFreeze.test.js`

**Step 1: Run all frontend unit tests**

Run:

```bash
node --test src/*.test.js
```

Expected: PASS.

**Step 2: Build frontend**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 3: Start the frontend or Tauri dev app**

Preferred full validation:

```bash
npm run tauri dev
```

If Tauri build is blocked by local MSVC environment, use frontend-only validation:

```bash
npm run dev
```

Expected: app starts successfully. If `LNK1181: cannot open kernel32.lib` occurs, set `LIB` and `INCLUDE` from `CLAUDE.md` and retry.

**Step 4: Manual validation checklist**

In the table panel:

1. Open a table with enough columns for horizontal scrolling.
2. Hover a field header and confirm the freeze button appears.
3. Click a field freeze button and scroll horizontally; columns through that field stay visible.
4. Click the same field freeze button again; column freeze is removed.
5. Open a table with enough rows for vertical scrolling.
6. Hover a row handle and confirm the freeze button appears.
7. Click a row freeze button and scroll vertically; rows through that row stay below the header.
8. Click the same row freeze button again; row freeze is removed.
9. Enable edit mode and verify row selection, checkbox selection, cell editing, grid focus, and range selection still work.
10. Freeze a row and a column at the same time; the intersection cells should stay visible and not flicker.
11. Switch table or refresh data; freeze state should clear.

**Step 5: Fix any regressions**

If any test or manual check fails, fix the smallest affected area and rerun the relevant check before continuing.

**Step 6: Final verification**

Run:

```bash
node --test src/*.test.js
npm run build
```

Expected: PASS.

**Step 7: Commit**

Only commit if the user explicitly asks for commits. Otherwise skip this step.

```bash
git add src/App.vue src/styles.css src/tableFreeze.js src/tableFreeze.test.js docs/plans/2026-05-11-table-freeze-design.md docs/plans/2026-05-11-table-freeze.md
git commit -m "feat: add table freeze controls"
```
