# Seamless Table Scroll Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add view-mode seamless table scrolling that feels like one continuous page while keeping DOM size bounded and preserving current edit-mode pagination.

**Architecture:** Extract pure block-cache/window helpers into a new frontend module and wire them into `src/App.vue` only for non-edit full-table viewing. Keep the existing `get_table_data(tableName, page, pageSize)` backend contract and system fullscreen behavior unchanged. The first version uses a bounded block cache and threshold-based preloading rather than full virtual scrolling.

**Tech Stack:** Vue 3 Composition API, Tauri IPC `invoke`, existing MySQL `get_table_data` command, Node.js built-in test runner.

---

### Task 1: Add pure seamless scroll block helpers

**Files:**
- Create: `src/tableSeamlessScroll.js`
- Create: `src/tableSeamlessScroll.test.js`

**Step 1: Write failing tests**

Create `src/tableSeamlessScroll.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSeamlessRows,
  getSeamlessBlockNumber,
  shouldLoadNextSeamlessBlock,
  shouldLoadPreviousSeamlessBlock,
  pruneSeamlessBlocks,
} from "./tableSeamlessScroll.js";

test("getSeamlessBlockNumber maps global row indexes to one-based blocks", () => {
  assert.equal(getSeamlessBlockNumber({ rowIndex: 0, blockSize: 150 }), 1);
  assert.equal(getSeamlessBlockNumber({ rowIndex: 149, blockSize: 150 }), 1);
  assert.equal(getSeamlessBlockNumber({ rowIndex: 150, blockSize: 150 }), 2);
});

test("buildSeamlessRows flattens loaded blocks with global row numbers", () => {
  const rows = buildSeamlessRows({
    blocks: new Map([
      [2, [{ id: "b" }, { id: "c" }]],
      [1, [{ id: "a" }]],
    ]),
    blockSize: 2,
  });

  assert.deepEqual(rows, [
    { row: { id: "a" }, globalIndex: 1, block: 1, localIndex: 0 },
    { row: { id: "b" }, globalIndex: 3, block: 2, localIndex: 0 },
    { row: { id: "c" }, globalIndex: 4, block: 2, localIndex: 1 },
  ]);
});

test("shouldLoadNextSeamlessBlock triggers near the bottom", () => {
  assert.equal(
    shouldLoadNextSeamlessBlock({
      scrollTop: 760,
      clientHeight: 300,
      scrollHeight: 1100,
      thresholdPx: 80,
      loading: false,
      highestLoadedBlock: 1,
      totalBlocks: 3,
    }),
    true,
  );
});

test("shouldLoadPreviousSeamlessBlock triggers near the top", () => {
  assert.equal(
    shouldLoadPreviousSeamlessBlock({
      scrollTop: 40,
      thresholdPx: 80,
      loading: false,
      lowestLoadedBlock: 2,
    }),
    true,
  );
});

test("pruneSeamlessBlocks keeps only nearby blocks", () => {
  const pruned = pruneSeamlessBlocks({
    blocks: new Map([[1, [1]], [2, [2]], [3, [3]], [4, [4]], [5, [5]]]),
    centerBlock: 3,
    radius: 1,
  });

  assert.deepEqual([...pruned.keys()], [2, 3, 4]);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/tableSeamlessScroll.test.js
```

Expected: FAIL because `src/tableSeamlessScroll.js` does not exist.

**Step 3: Implement helper module**

Create `src/tableSeamlessScroll.js`:

```js
function toPositiveInteger(value, fallback = 1) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function getSeamlessBlockNumber({ rowIndex = 0, blockSize = 150 } = {}) {
  const size = toPositiveInteger(blockSize, 150);
  const index = Math.max(0, Math.floor(Number(rowIndex) || 0));
  return Math.floor(index / size) + 1;
}

export function buildSeamlessRows({ blocks = new Map(), blockSize = 150 } = {}) {
  const size = toPositiveInteger(blockSize, 150);
  return [...blocks.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .flatMap(([block, rows]) => {
      const blockNumber = toPositiveInteger(block, 1);
      const blockStart = (blockNumber - 1) * size;
      return (Array.isArray(rows) ? rows : []).map((row, localIndex) => ({
        row,
        globalIndex: blockStart + localIndex + 1,
        block: blockNumber,
        localIndex,
      }));
    });
}

export function shouldLoadNextSeamlessBlock({
  scrollTop = 0,
  clientHeight = 0,
  scrollHeight = 0,
  thresholdPx = 320,
  loading = false,
  highestLoadedBlock = 0,
  totalBlocks = 0,
} = {}) {
  if (loading) return false;
  if (Number(highestLoadedBlock) >= Number(totalBlocks)) return false;
  return Number(scrollTop) + Number(clientHeight) >= Number(scrollHeight) - Number(thresholdPx);
}

export function shouldLoadPreviousSeamlessBlock({
  scrollTop = 0,
  thresholdPx = 320,
  loading = false,
  lowestLoadedBlock = 1,
} = {}) {
  if (loading) return false;
  if (Number(lowestLoadedBlock) <= 1) return false;
  return Number(scrollTop) <= Number(thresholdPx);
}

export function pruneSeamlessBlocks({ blocks = new Map(), centerBlock = 1, radius = 1 } = {}) {
  const center = toPositiveInteger(centerBlock, 1);
  const keepRadius = Math.max(0, Math.floor(Number(radius) || 0));
  return new Map(
    [...blocks.entries()].filter(([block]) => Math.abs(Number(block) - center) <= keepRadius),
  );
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/tableSeamlessScroll.test.js
```

Expected: PASS.

---

### Task 2: Add seamless state and first-block loading in App.vue

**Files:**
- Modify: `src/App.vue`
- Test: `src/tableSeamlessScroll.test.js`

**Step 1: Import helpers**

In `src/App.vue`, import:

```js
import {
  buildSeamlessRows,
  getSeamlessBlockNumber,
  pruneSeamlessBlocks,
  shouldLoadNextSeamlessBlock,
  shouldLoadPreviousSeamlessBlock,
} from "./tableSeamlessScroll.js";
```

**Step 2: Add constants and state**

Near table constants and `tableView`, add:

```js
const SEAMLESS_TABLE_BLOCK_SIZE = 150;
const SEAMLESS_TABLE_CACHE_RADIUS = 1;
const SEAMLESS_TABLE_LOAD_THRESHOLD_PX = 360;

const seamlessTable = reactive({
  enabled: false,
  loading: false,
  blocks: new Map(),
  totalRows: 0,
  activeBlock: 1,
});
```

Add computed values:

```js
const seamlessTableRows = computed(() =>
  buildSeamlessRows({
    blocks: seamlessTable.blocks,
    blockSize: SEAMLESS_TABLE_BLOCK_SIZE,
  }),
);
const seamlessTotalBlocks = computed(() =>
  Math.max(1, Math.ceil((Number(seamlessTable.totalRows) || tableView.totalRows || 0) / SEAMLESS_TABLE_BLOCK_SIZE)),
);
const shouldUseSeamlessTable = computed(() =>
  tableOpen.value &&
  tableDetailView.value === "full" &&
  !editMode.value &&
  !dataCollapsed.value &&
  seamlessTable.enabled,
);
```

**Step 3: Add reset and load functions**

Add near `loadTablePage()` helpers:

```js
function resetSeamlessTable() {
  seamlessTable.enabled = false;
  seamlessTable.loading = false;
  seamlessTable.blocks = new Map();
  seamlessTable.totalRows = 0;
  seamlessTable.activeBlock = 1;
}

async function loadSeamlessTableBlock(blockNumber, { replace = false } = {}) {
  if (!tableView.tableName || seamlessTable.loading) return;
  const block = Math.max(1, Math.min(seamlessTotalBlocks.value, Number(blockNumber) || 1));
  if (!replace && seamlessTable.blocks.has(block)) return;
  seamlessTable.loading = true;
  try {
    const payload = await invoke("get_table_data", {
      tableName: tableView.tableName,
      page: block,
      pageSize: SEAMLESS_TABLE_BLOCK_SIZE,
    });
    if (replace) {
      seamlessTable.blocks = new Map();
    }
    seamlessTable.blocks.set(block, payload.rows || []);
    seamlessTable.blocks = pruneSeamlessBlocks({
      blocks: seamlessTable.blocks,
      centerBlock: block,
      radius: SEAMLESS_TABLE_CACHE_RADIUS,
    });
    seamlessTable.totalRows = Number(payload.totalRows) || 0;
    tableView.totalRows = seamlessTable.totalRows;
    seamlessTable.activeBlock = block;
  } finally {
    seamlessTable.loading = false;
  }
}

async function enableSeamlessTableFromCurrentPage() {
  if (!tableView.tableName || editMode.value || tableDetailView.value !== "full") return;
  seamlessTable.enabled = true;
  seamlessTable.totalRows = tableView.totalRows;
  const currentBlock = getSeamlessBlockNumber({
    rowIndex: Math.max(0, (tableView.page - 1) * tableView.pageSize),
    blockSize: SEAMLESS_TABLE_BLOCK_SIZE,
  });
  await loadSeamlessTableBlock(currentBlock, { replace: true });
}
```

**Step 4: Reset cache on table change/page reload**

Call `resetSeamlessTable()` in:

- `restoreLiveStateFromTableSnapshot(tab)` before assigning table rows.
- `loadTablePage()` before or after assigning new `tableView.rows`, unless loading was triggered by seamless mode.
- Any table close/reset path that already resets table state.

Keep this conservative: if unsure, reset on table tab activation and table page load.

**Step 5: Run focused tests**

Run:

```bash
node --test src/tableSeamlessScroll.test.js
```

Expected: PASS.

---

### Task 3: Render seamless rows in view mode

**Files:**
- Modify: `src/App.vue`
- Modify: `src/styles.css`

**Step 1: Add displayed rows computed**

Add:

```js
const displayedTableRows = computed(() =>
  shouldUseSeamlessTable.value
    ? seamlessTableRows.value.map((item) => ({ ...item.row, __globalIndex: item.globalIndex, __seamlessBlock: item.block, __seamlessLocalIndex: item.localIndex }))
    : tableView.rows,
);

function getDisplayedRowNumber(localIndex, row = null) {
  if (shouldUseSeamlessTable.value && row?.__globalIndex) return row.__globalIndex;
  return (tableView.page - 1) * tableView.pageSize + localIndex + 1;
}
```

**Step 2: Change tbody row loop**

In the table body, change the existing page row loop from `tableView.rows` to `displayedTableRows`.

Change row-number display to:

```vue
<span class="row-number">{{ getDisplayedRowNumber(idx, row) }}</span>
```

**Step 3: Keep edit-only paths on paginated rows**

Ensure insert rows and edit ghost row remain shown only in `editMode`. Since `shouldUseSeamlessTable` is false in edit mode, existing edit behavior should keep using `tableView.rows` semantics.

**Step 4: Add inline loading marker**

Below the table, inside `.grid-wrap`, add a small loading indicator shown when `shouldUseSeamlessTable && seamlessTable.loading`:

```vue
<div v-if="shouldUseSeamlessTable && seamlessTable.loading" class="seamless-table-loading">加载更多...</div>
```

Add CSS:

```css
.seamless-table-loading {
  position: sticky;
  bottom: 0;
  padding: 8px 12px;
  text-align: center;
  color: var(--text-sub);
  background: color-mix(in srgb, var(--bg-panel) 92%, transparent);
}
```

**Step 5: Run all frontend tests**

Run:

```bash
node --test src/*.test.js
```

Expected: PASS.

---

### Task 4: Add scroll threshold loading

**Files:**
- Modify: `src/App.vue`
- Test: `src/tableSeamlessScroll.test.js`

**Step 1: Add scroll handler**

Add near table scroll/navigation functions:

```js
async function onTableGridScroll(event) {
  if (!shouldUseSeamlessTable.value) return;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const loadedBlocks = [...seamlessTable.blocks.keys()].sort((a, b) => a - b);
  if (loadedBlocks.length === 0) return;
  const lowestLoadedBlock = loadedBlocks[0];
  const highestLoadedBlock = loadedBlocks[loadedBlocks.length - 1];

  if (shouldLoadNextSeamlessBlock({
    scrollTop: target.scrollTop,
    clientHeight: target.clientHeight,
    scrollHeight: target.scrollHeight,
    thresholdPx: SEAMLESS_TABLE_LOAD_THRESHOLD_PX,
    loading: seamlessTable.loading,
    highestLoadedBlock,
    totalBlocks: seamlessTotalBlocks.value,
  })) {
    await loadSeamlessTableBlock(highestLoadedBlock + 1);
    return;
  }

  if (shouldLoadPreviousSeamlessBlock({
    scrollTop: target.scrollTop,
    thresholdPx: SEAMLESS_TABLE_LOAD_THRESHOLD_PX,
    loading: seamlessTable.loading,
    lowestLoadedBlock,
  })) {
    await loadSeamlessTableBlock(lowestLoadedBlock - 1);
  }
}
```

**Step 2: Wire scroll handler**

On `.grid-wrap`, add:

```vue
@scroll="onTableGridScroll"
```

Preserve existing classes and refs.

**Step 3: Enable seamless mode when entering full table view**

Call `enableSeamlessTableFromCurrentPage().catch(() => {})` when:

- `tableDetailView` becomes `"full"` and `!editMode.value`.
- After opening a table and loading its first page if `tableDetailView.value === "full" && !editMode.value`.

If edit mode is entered, call `resetSeamlessTable()`.

**Step 4: Run tests**

Run:

```bash
node --test src/tableSeamlessScroll.test.js
node --test src/*.test.js
```

Expected: PASS.

---

### Task 5: Preserve pagination fallback and edit mode behavior

**Files:**
- Modify: `src/App.vue`

**Step 1: Hide or soften pager in seamless view**

In the data header pager area, keep current pager visible only when not seamless:

```vue
<div v-if="!shouldUseSeamlessTable" class="pager">
  ...existing pager...
</div>
<div v-else class="pager seamless-pager-status">
  {{ seamlessTableRows.length }} / {{ seamlessTable.totalRows || tableView.totalRows }} 行
</div>
```

**Step 2: Reset seamless mode on edit toggle**

Find edit-mode toggle logic. When entering edit mode, call `resetSeamlessTable()` before edit state depends on current page rows.

**Step 3: Keep current page commands unchanged**

Do not alter `prevPage`, `nextPage`, `jumpHitRow`, `runTableFind`, or edit selection in this first version unless tests fail. Seamless mode is view-only and should not disturb existing paginated commands.

**Step 4: Run tests**

Run:

```bash
node --test src/*.test.js
```

Expected: PASS.

---

### Task 6: Manual verification

**Files:**
- No code changes expected unless issues are found

**Step 1: Start the app**

Run:

```bash
npm run tauri dev
```

Expected: Vite and Tauri app start. If MSVC linking fails, use the `LIB` and `INCLUDE` exports documented in `CLAUDE.md`.

**Step 2: Verify seamless viewing**

Manual checks:

1. Open a table with a few thousand rows.
2. Switch to full table view.
3. Confirm the pager is replaced by row count status.
4. Scroll down through multiple blocks; rows should continue without clicking next page.
5. Confirm row numbers remain continuous.
6. Scroll near the top after loading more blocks; previous rows should remain available or reload.
7. Enter system fullscreen and repeat vertical scrolling.
8. Confirm horizontal scrolling and sticky header still work.
9. Confirm freeze column/row preview still works within visible rows.
10. Enter edit mode and confirm old pagination/edit behavior remains intact.

**Step 3: Performance check**

Manual checks:

- The DOM should not grow to thousands of mounted rows indefinitely.
- Scrolling should not visibly pause when block preloading completes.
- If loading is visible on slow DB, threshold should be increased rather than rendering more rows.

---

### Task 7: Final verification

**Files:**
- No code changes expected unless issues are found

**Step 1: Run final tests**

Run:

```bash
node --test src/*.test.js
```

Expected: PASS.

**Step 2: Check diff**

Run:

```bash
git diff -- src/App.vue src/styles.css src/tableSeamlessScroll.js src/tableSeamlessScroll.test.js docs/plans/2026-05-11-seamless-table-scroll-design.md docs/plans/2026-05-11-seamless-table-scroll.md
```

Expected: Diff contains the new helper module, tests, view-mode wiring, small CSS loading/status styles, and docs.

**Step 3: Report**

Report:

- Tests run and results.
- Whether manual seamless scrolling was verified.
- That system fullscreen behavior was intentionally preserved.
- That edit mode remains paginated in this first iteration.
