# Fullscreen Table Smoothness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Smooth table fullscreen enter/exit and scrolling, and make the row-number/freeze-handle column match adjacent table cell colors.

**Architecture:** Keep the fix local to `src/App.vue`, `src/styles.css`, and the existing pure table dialog helpers in `src/panelChrome.js`. Add a tiny helper to model fullscreen transition classes, defer adaptive page-size work until after fullscreen resize paints, and tune CSS so fullscreen table scrolling uses cheaper surfaces without blocking future larger-page or single-page scrolling work.

**Tech Stack:** Vue 3 Composition API, Tauri window APIs, Vite CSS, Node.js built-in test runner.

---

### Task 1: Add pure table fullscreen class helper

**Files:**
- Modify: `src/panelChrome.js`
- Modify: `src/panelChrome.test.js`

**Step 1: Write the failing test**

Add tests near the existing table dialog state tests in `src/panelChrome.test.js`:

```js
test("buildTableDialogClasses marks fullscreen transition state", () => {
  assert.deepEqual(
    buildTableDialogClasses({ fullscreen: true, transitioning: true }),
    {
      fullscreen: true,
      "table-modal--fullscreen-transition": true,
    },
  );
});

test("buildTableDialogClasses omits transition class when stable", () => {
  assert.deepEqual(
    buildTableDialogClasses({ fullscreen: true, transitioning: false }),
    {
      fullscreen: true,
      "table-modal--fullscreen-transition": false,
    },
  );
});
```

Import `buildTableDialogClasses` from `./panelChrome.js` in the existing import block.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test src/panelChrome.test.js
```

Expected: FAIL because `buildTableDialogClasses` is not exported.

**Step 3: Write minimal implementation**

Add to `src/panelChrome.js` near `getDefaultTableDialogState()`:

```js
export function buildTableDialogClasses({ fullscreen = false, transitioning = false } = {}) {
  return {
    fullscreen: !!fullscreen,
    "table-modal--fullscreen-transition": !!transitioning,
  };
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
node --test src/panelChrome.test.js
```

Expected: PASS.

---

### Task 2: Use transition state and defer adaptive page-size work

**Files:**
- Modify: `src/App.vue`
- Test: existing `src/panelChrome.test.js` remains the regression test for the helper

**Step 1: Add imports and state**

In `src/App.vue`, add `buildTableDialogClasses` to the import from `./panelChrome.js`.

Near existing table dialog refs around `tableFullscreen`, add:

```js
const tableFullscreenTransitioning = ref(false);
```

Add a computed class object near the other computed table dialog values:

```js
const tableDialogClasses = computed(() =>
  buildTableDialogClasses({
    fullscreen: tableFullscreen.value,
    transitioning: tableFullscreenTransitioning.value,
  }),
);
```

**Step 2: Wire the class object into the table modal**

Find the table modal element in the template, currently binding the `fullscreen` class directly. Replace the direct fullscreen class binding with `tableDialogClasses`, preserving any existing static classes and other dynamic classes.

Expected resulting pattern:

```vue
:class="[
  tableDialogClasses,
  ...existingClasses
]"
```

Do not remove existing reduced-transparency, host-fill, edit-mode, or instant classes.

**Step 3: Add a paint-delay helper**

Add near fullscreen functions in `src/App.vue`:

```js
function waitForTableFullscreenPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}
```

**Step 4: Update fullscreen toggle flow**

Change `toggleTableFullscreen()` so it sets transition state, waits for enter/exit, waits for paint, then schedules adaptive page sizing:

```js
async function toggleTableFullscreen() {
  tableFullscreenTransitioning.value = true;
  try {
    if (tableFullscreen.value) {
      await exitTableFullscreen();
    } else {
      await enterTableFullscreen();
    }
    await waitForTableFullscreenPaint();
    scheduleAdaptiveTablePageSize();
  } finally {
    tableFullscreenTransitioning.value = false;
  }
}
```

Remove the old immediate `scheduleAdaptiveTablePageSize()` call at the end of `toggleTableFullscreen()`.

**Step 5: Run focused tests**

Run:

```bash
node --test src/panelChrome.test.js
```

Expected: PASS.

---

### Task 3: Tune fullscreen table CSS for cheaper scrolling and matching row-number color

**Files:**
- Modify: `src/styles.css`

**Step 1: Add fullscreen transition CSS**

Near `.table-modal.fullscreen`, add:

```css
.table-modal.table-modal--fullscreen-transition {
  transition: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.table-modal.fullscreen .grid-wrap {
  background: color-mix(in srgb, var(--bg-panel) 96%, transparent);
  contain: paint;
}

.table-modal.fullscreen .data-table th,
.table-modal.fullscreen .data-table td {
  background-clip: padding-box;
}
```

**Step 2: Make row-number/freeze-handle column match body cells by default**

Replace the current `.row-freeze-handle-col` block with:

```css
.data-table .row-freeze-handle-col {
  background: inherit;
  background-clip: padding-box;
}
```

Keep existing freeze preview and frozen row/column selectors above it so freeze states still override the default body-cell match.

**Step 3: Reduce heavy frozen-edge repaint in fullscreen only**

Add after frozen edge rules:

```css
.table-modal.fullscreen .data-table th.frozen-column-edge,
.table-modal.fullscreen .data-table td.frozen-column-edge {
  box-shadow: inset -1px 0 0 color-mix(in srgb, var(--accent) 28%, transparent);
}

.table-modal.fullscreen .data-table tr.frozen-row-edge td {
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--accent) 24%, transparent);
}
```

This keeps freeze boundaries visible while avoiding larger outer shadows during scroll.

**Step 4: Run all frontend tests**

Run:

```bash
node --test src/*.test.js
```

Expected: PASS.

---

### Task 4: Manual UI verification

**Files:**
- No code changes expected unless issues are found

**Step 1: Start the app**

Run:

```bash
npm run tauri dev
```

Expected: Vite and Tauri dev app start. If MSVC linking fails with `kernel32.lib`, set `LIB` and `INCLUDE` as documented in `CLAUDE.md` and rerun.

**Step 2: Verify table fullscreen behavior**

Manual checks:

1. Open the panel table view for a table with enough rows/columns to scroll.
2. Click `全屏查看(W)`.
3. Confirm enter fullscreen feels smooth and does not visibly stutter during resize.
4. Scroll vertically and horizontally.
5. Confirm sticky header, freeze controls, and normal cell interactions still work.
6. Confirm the row-number/freeze-handle column color matches adjacent body cells like the screenshot request.
7. Exit fullscreen and confirm the panel returns correctly.

**Step 3: Verify freeze visuals**

Manual checks:

1. Enter freeze selection.
2. Hover row handle and column header.
3. Confirm freeze preview remains visible.
4. Apply freeze.
5. Confirm frozen boundaries remain visible in normal and fullscreen modes.

---

### Task 5: Final verification

**Files:**
- No code changes expected unless issues are found

**Step 1: Run tests again**

Run:

```bash
node --test src/*.test.js
```

Expected: PASS.

**Step 2: Check git diff**

Run:

```bash
git diff -- src/App.vue src/styles.css src/panelChrome.js src/panelChrome.test.js docs/plans/2026-05-11-fullscreen-table-smoothness-design.md docs/plans/2026-05-11-fullscreen-table-smoothness.md
```

Expected: Diff only contains the planned helper, fullscreen transition flow, CSS tuning, tests, and docs.

**Step 3: Report completion**

Summarize:

- Tests run and results.
- Manual UI checks performed.
- Any remaining caveat for future larger-page/single-page seamless scrolling work.
