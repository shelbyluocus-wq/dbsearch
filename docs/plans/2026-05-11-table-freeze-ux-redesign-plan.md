# Table Freeze UX Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace noisy per-header/per-row freeze buttons with one toolbar-driven freeze mode that previews a selected cell/row/column and applies freezing only after a second toolbar click.

**Architecture:** Keep the existing freeze helper module and sticky layout math, but move user activation from table-internal buttons to toolbar state. `App.vue` owns pick-mode state and routes header/row/cell clicks to preview selection only while pick mode is active; normal table/edit interactions remain unchanged outside pick mode.

**Tech Stack:** Vue 3 `<script setup>`, existing single-file `src/App.vue`, CSS sticky positioning in `src/styles.css`, Node.js built-in test runner.

---

### Task 1: Update integration tests for toolbar freeze mode

**Files:**
- Modify: `E:/project/dbsearch/src/tableFreeze.test.js`

**Step 1: Write failing tests**

Update or add tests that assert the new UX contract against source text without depending on line numbers:

```js
test('App.vue uses toolbar freeze mode instead of table-internal freeze buttons', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8');

  assert.match(source, /freezePickMode/);
  assert.match(source, /toggleFreezePickMode/);
  assert.match(source, /确认冻结/);
  assert.doesNotMatch(source, /class="column-freeze-btn"/);
  assert.doesNotMatch(source, /class="row-freeze-btn"/);
});

test('App.vue selects freeze preview from header, row handle, and data cells', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8');

  assert.match(source, /selectFreezeColumn\(col\.column_name\)/);
  assert.match(source, /selectFreezeRow\(idx\)/);
  assert.match(source, /selectFreezeCell\(idx, col\.column_name\)/);
});

test('styles.css removes table-internal freeze button styling and keeps frozen edge styles', () => {
  const source = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /\.column-freeze-btn/);
  assert.doesNotMatch(source, /\.row-freeze-btn/);
  assert.match(source, /\.freeze-pick-mode/);
  assert.match(source, /\.freeze-preview-column/);
  assert.match(source, /\.freeze-preview-row/);
});
```

Keep existing helper behavior tests, especially the `frozenRowIndex: null` regression and leading-width tests.

**Step 2: Run tests to verify failure**

Run:

```bash
cd E:/project/dbsearch && node --test src/tableFreeze.test.js
```

Expected: FAIL because `App.vue` still contains table-internal freeze buttons and lacks pick-mode wiring.

**Step 3: Commit**

Only commit if the user explicitly asks for commits. Otherwise skip.

---

### Task 2: Add freeze pick-mode state and actions

**Files:**
- Modify: `E:/project/dbsearch/src/App.vue`

**Step 1: Add state near existing freeze refs**

Find existing `frozenColumnName` / `frozenRowIndex` refs and add:

```js
const freezePickMode = ref(false);
const freezePreview = reactive({ columnName: null, rowIndex: null, source: null });
```

**Step 2: Add derived labels near freeze computed helpers**

Add:

```js
const freezePreviewText = computed(() => {
  const parts = [];
  if (freezePreview.rowIndex !== null) parts.push(`第 ${freezePreview.rowIndex + 1} 行`);
  if (freezePreview.columnName) parts.push(`${freezePreview.columnName} 列`);
  return parts.length ? parts.join(' / ') : '请选择单元格、字段或行';
});

const freezeAppliedText = computed(() => {
  const parts = [];
  if (frozenRowIndex.value !== null) parts.push(`第 ${frozenRowIndex.value + 1} 行`);
  if (frozenColumnName.value) parts.push(`${frozenColumnName.value} 列`);
  return parts.length ? `已冻结：${parts.join(' / ')}` : '';
});

const freezeToolbarLabel = computed(() => {
  if (!freezePickMode.value) return freezeAppliedText.value || '冻结';
  return hasFreezePreview.value ? '确认冻结' : '选择冻结位置…';
});

const hasFreezePreview = computed(() => freezePreview.rowIndex !== null || Boolean(freezePreview.columnName));
```

If declaration order causes a reference-before-initialization issue, place `hasFreezePreview` before `freezeToolbarLabel`.

**Step 3: Add actions**

Add near existing `toggleFrozenColumn` / `toggleFrozenRow` helpers:

```js
function clearFreezePreview() {
  freezePreview.columnName = null;
  freezePreview.rowIndex = null;
  freezePreview.source = null;
}

function cancelFreezePickMode() {
  freezePickMode.value = false;
  clearFreezePreview();
}

function applyFreezePreview() {
  if (!hasFreezePreview.value) return;
  frozenColumnName.value = freezePreview.columnName;
  frozenRowIndex.value = freezePreview.rowIndex;
  cancelFreezePickMode();
}

function toggleFreezePickMode() {
  if (!freezePickMode.value) {
    freezePickMode.value = true;
    clearFreezePreview();
    return;
  }
  applyFreezePreview();
}

function clearFreeze() {
  frozenColumnName.value = null;
  frozenRowIndex.value = null;
  cancelFreezePickMode();
}

function selectFreezeColumn(columnName) {
  if (!freezePickMode.value) return false;
  freezePreview.columnName = columnName;
  freezePreview.rowIndex = null;
  freezePreview.source = 'column';
  return true;
}

function selectFreezeRow(rowIndex) {
  if (!freezePickMode.value) return false;
  freezePreview.columnName = null;
  freezePreview.rowIndex = rowIndex;
  freezePreview.source = 'row';
  return true;
}

function selectFreezeCell(rowIndex, columnName) {
  if (!freezePickMode.value) return false;
  freezePreview.columnName = columnName;
  freezePreview.rowIndex = rowIndex;
  freezePreview.source = 'cell';
  return true;
}
```

**Step 4: Update reset helpers**

Modify existing reset helpers so full resets clear preview and mode:

```js
function resetTableFreeze() {
  frozenColumnName.value = null;
  frozenRowIndex.value = null;
  cancelFreezePickMode();
}

function resetFrozenRow() {
  frozenRowIndex.value = null;
  if (freezePreview.rowIndex !== null) {
    freezePreview.rowIndex = null;
    if (!freezePreview.columnName) freezePreview.source = null;
  }
}
```

**Step 5: Add Escape handling**

In the existing window keydown dispatcher, before normal table key handling, add a narrow bailout:

```js
if (freezePickMode.value && event.key === 'Escape') {
  event.preventDefault();
  cancelFreezePickMode();
  return;
}
```

**Step 6: Run targeted tests**

Run:

```bash
cd E:/project/dbsearch && node --test src/tableFreeze.test.js
```

Expected: tests still fail until template/CSS tasks remove old buttons and add markup.

---

### Task 3: Replace table-internal buttons with toolbar freeze controls

**Files:**
- Modify: `E:/project/dbsearch/src/App.vue`

**Step 1: Add toolbar controls**

In the table data toolbar `.data-actions`, add controls near the existing jump/pager controls:

```vue
<div class="freeze-toolbar" :class="{ active: freezePickMode }">
  <button
    class="small-btn freeze-toolbar-btn"
    :class="{ active: freezePickMode || Boolean(freezeAppliedText) }"
    @click="toggleFreezePickMode"
  >{{ freezeToolbarLabel }}</button>
  <button
    v-if="freezePickMode"
    class="small-btn freeze-cancel-btn"
    @click="cancelFreezePickMode"
  >取消</button>
  <button
    v-if="!freezePickMode && freezeAppliedText"
    class="small-btn freeze-cancel-btn"
    @click="clearFreeze"
  >取消冻结</button>
  <span v-if="freezePickMode" class="freeze-hint">{{ freezePreviewText }}</span>
</div>
```

**Step 2: Mark grid pick mode**

On the existing `div ref="tableGridWrapRef" class="grid-wrap"`, add class binding:

```vue
:class="{ 'freeze-pick-mode': freezePickMode }"
```

**Step 3: Remove column freeze button**

Delete the header button with `column-freeze-btn`. Preserve existing `column-collapse-badge` exactly.

Add selection behavior to each data column header `<th>`:

```vue
:class="{
  ...existing,
  'freeze-preview-column': freezePreview.columnName === col.column_name,
}"
@click="freezePickMode && selectFreezeColumn(col.column_name)"
```

Use `@click.stop` only if the header already has conflicting click behavior. Do not break column resize or collapse badge double-click.

**Step 4: Remove row freeze button**

Delete the row-handle button with `row-freeze-btn`.

Keep the row handle cell always rendered. Preserve edit-mode `@mousedown.stop.prevent="editMode && onRowHandleMouseDown(...)"` and `@mouseenter` behavior, but make selection mode take precedence:

```vue
@mousedown.stop.prevent="freezePickMode ? selectFreezeRow(idx) : (editMode && onRowHandleMouseDown(idx, 'page'))"
```

Add preview classes:

```vue
:class="{
  'freeze-preview-row': freezePreview.rowIndex === idx,
  ...existing,
}"
```

**Step 5: Route data cell clicks in pick mode**

For normal data cells, make the first click handler pick preview when in freeze mode and otherwise keep the existing behavior:

```vue
@click="freezePickMode ? selectFreezeCell(idx, col.column_name) : onPageCellClick($event, idx, col.column_name)"
```

Keep existing double-click, mousedown, mouseenter handlers, but guard selection handlers if they conflict in pick mode:

```vue
@mousedown="!freezePickMode && onGridCellMouseDown($event, 'page', idx, col.column_name)"
@mouseenter="!freezePickMode && onGridCellMouseEnter($event, 'page', idx, col.column_name)"
```

For insert rows, do not allow row freeze preview. Column selection via cells may still preview column only if needed, but the simplest behavior is to ignore insert-row cells in pick mode.

**Step 6: Use preview metadata in style/classes**

Add computed metadata mirroring applied freeze but based on preview:

```js
const previewColumnMeta = computed(() => buildFrozenColumnMeta({
  columns: tableView.columns.map((column) => column.column_name),
  columnWidths: Object.fromEntries(
    tableView.columns.map((column) => [column.column_name, getColumnWidth(column.column_name)]),
  ),
  frozenColumnName: freezePreview.columnName,
  leadingWidth: tableLeadingStickyWidth.value,
}));

const previewRowMeta = computed(() => buildFrozenRowMeta({
  rowCount: tableView.rows.length,
  frozenRowIndex: freezePreview.rowIndex,
  headerHeight: TABLE_HEADER_HEIGHT,
  rowHeight: TABLE_ROW_HEIGHT,
}));
```

Update class helpers or template classes so preview edge classes can render without applying sticky position yet:

```vue
'freeze-preview-column': previewColumnMeta[col.column_name]?.frozen,
'freeze-preview-column-edge': previewColumnMeta[col.column_name]?.edge,
'freeze-preview-row': previewRowMeta[idx]?.frozen,
'freeze-preview-row-edge': previewRowMeta[idx]?.edge,
```

Preview should not change sticky layout; only applied freeze should use sticky styles.

**Step 7: Run targeted tests**

Run:

```bash
cd E:/project/dbsearch && node --test src/tableFreeze.test.js
```

Expected: PASS after template wiring and old buttons are removed.

---

### Task 4: Redesign freeze CSS for clean mode and preview

**Files:**
- Modify: `E:/project/dbsearch/src/styles.css`

**Step 1: Remove table-internal freeze button styles**

Delete styles for:

```css
.column-freeze-btn
.row-freeze-btn
```

Do not delete `.column-collapse-badge` styles.

**Step 2: Add toolbar styles**

Near `.data-actions`, add:

```css
.freeze-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 6px;
}

.freeze-toolbar-btn.active {
  border-color: var(--accent-line);
  background: var(--accent-tint);
  color: var(--accent-text);
}

.freeze-cancel-btn {
  color: var(--text-sub);
}

.freeze-hint {
  color: var(--text-sub);
  font-size: 12px;
  white-space: nowrap;
}
```

**Step 3: Add pick-mode and preview styles**

Near table state styles, add:

```css
.grid-wrap.freeze-pick-mode {
  outline: 1px solid var(--accent-line);
  outline-offset: 2px;
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.grid-wrap.freeze-pick-mode .data-table th,
.grid-wrap.freeze-pick-mode .data-table td {
  cursor: crosshair;
}

.data-table th.freeze-preview-column,
.data-table td.freeze-preview-column {
  background: color-mix(in srgb, var(--surface-card) 96%, var(--accent-soft));
}

.data-table th.freeze-preview-column-edge,
.data-table td.freeze-preview-column-edge {
  box-shadow: inset -1px 0 0 color-mix(in srgb, var(--accent-line) 70%, transparent);
}

.data-table tr.freeze-preview-row > td,
.data-table td.freeze-preview-row {
  background: color-mix(in srgb, var(--surface-card) 96%, var(--accent-soft));
}

.data-table tr.freeze-preview-row-edge > td,
.data-table td.freeze-preview-row-edge {
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--accent-line) 70%, transparent);
}
```

**Step 4: Soften applied frozen styles**

Keep applied frozen edge styles, but make backgrounds lighter than current button-driven version. Preserve hit/find/edit visibility.

**Step 5: Ensure table cells use border-box**

Keep or add:

```css
.data-table th,
.data-table td {
  box-sizing: border-box;
}
```

**Step 6: Run tests/build**

Run:

```bash
cd E:/project/dbsearch && node --test src/tableFreeze.test.js
cd E:/project/dbsearch && npm run build
```

Expected: both pass.

---

### Task 5: Full verification and manual validation

**Files:**
- Verify: `E:/project/dbsearch/src/App.vue`
- Verify: `E:/project/dbsearch/src/styles.css`
- Verify: `E:/project/dbsearch/src/tableFreeze.js`
- Verify: `E:/project/dbsearch/src/tableFreeze.test.js`

**Step 1: Run all tests**

Run:

```bash
cd E:/project/dbsearch && node --test src/*.test.js
```

Expected: all tests pass.

**Step 2: Build**

Run:

```bash
cd E:/project/dbsearch && npm run build
```

Expected: build succeeds. Existing large chunk warning is acceptable if no new build failure appears.

**Step 3: Start dev app for user testing**

Run:

```bash
cd E:/project/dbsearch && npm run dev
```

Expected: Vite starts on port 1430.

If the user wants full Tauri testing, run:

```bash
cd E:/project/dbsearch && npm run tauri dev
```

**Step 4: Manual checklist**

- Table initially has no freeze buttons inside headers/rows.
- Toolbar shows `冻结`.
- Clicking `冻结` enters selection mode and visually marks the grid.
- Clicking a normal cell previews row+column freeze but does not apply sticky freeze yet.
- Clicking toolbar `确认冻结` applies sticky freeze.
- Clicking a header previews column-only freeze.
- Clicking a row handle previews row-only freeze.
- `取消` exits selection mode without applying.
- `取消冻结` clears applied freeze.
- Column collapse badge still works.
- Edit mode row drag selection and checkbox selection work when not in freeze mode.
- Horizontal and vertical scroll do not overlap frozen leading cells, headers, or checkbox/action cells.

**Step 5: Final review**

Run a code review focused on interaction regressions and sticky layering before reporting completion.

**Step 6: Commit**

Only commit if the user explicitly asks. Otherwise keep changes unstaged/local.
