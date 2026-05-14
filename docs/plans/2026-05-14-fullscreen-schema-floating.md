# Fullscreen Schema Floating Window Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the fullscreen table Schema overlay into a draggable, resizable floating window with a button to hide or show the field type column.

**Architecture:** Keep the existing `schema-box` markup in `src/App.vue` and enhance it only when the table dialog is fullscreen, in full-table view, and Schema is expanded. Put boundary and clamping math in `src/tableDialogLayout.js` so drag/resize behavior can be covered by `node:test`; keep DOM event wiring and Vue state in `App.vue`.

**Tech Stack:** Vue 3 Composition API, CSS in `src/styles.css`, Node.js built-in test runner, existing Tauri/Vite frontend code.

---

### Task 1: Add tested floating-window layout helpers

**Files:**
- Modify: `src/tableDialogLayout.js`
- Modify: `src/tableDialogLayout.test.js`

**Step 1: Write failing tests**

Add these imports to `src/tableDialogLayout.test.js`:

```js
import {
  clampFloatingSchemaWindow,
  resolveFloatingSchemaResize,
  resolveFloatingSchemaDrag,
} from "./tableDialogLayout.js";
```

If the file already has an import from `./tableDialogLayout.js`, merge these names into that import.

Add tests near the existing layout tests:

```js
test("clampFloatingSchemaWindow keeps the schema window inside the container", () => {
  assert.deepEqual(
    clampFloatingSchemaWindow({
      window: { left: -20, top: 900, width: 1200, height: 40 },
      container: { width: 900, height: 600 },
      minWidth: 320,
      minHeight: 180,
      margin: 8,
    }),
    { left: 8, top: 412, width: 884, height: 180 },
  );
});

test("resolveFloatingSchemaDrag clamps dragged coordinates", () => {
  assert.deepEqual(
    resolveFloatingSchemaDrag({
      startWindow: { left: 40, top: 60, width: 360, height: 220 },
      startPointer: { x: 100, y: 100 },
      pointer: { x: 2000, y: -200 },
      container: { width: 800, height: 500 },
      minWidth: 320,
      minHeight: 180,
      margin: 8,
    }),
    { left: 432, top: 8, width: 360, height: 220 },
  );
});

test("resolveFloatingSchemaResize adjusts size and keeps the window visible", () => {
  assert.deepEqual(
    resolveFloatingSchemaResize({
      startWindow: { left: 700, top: 420, width: 260, height: 120 },
      startPointer: { x: 760, y: 480 },
      pointer: { x: 980, y: 640 },
      container: { width: 900, height: 560 },
      minWidth: 320,
      minHeight: 180,
      margin: 8,
    }),
    { left: 572, top: 372, width: 320, height: 180 },
  );
});
```

**Step 2: Run test to verify it fails**

Run: `node --test src/tableDialogLayout.test.js`

Expected: FAIL because the new helper exports do not exist.

**Step 3: Add minimal helper implementation**

In `src/tableDialogLayout.js`, append these exports:

```js
function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clampFloatingSchemaWindow({
  window,
  container,
  minWidth = 320,
  minHeight = 180,
  margin = 8,
} = {}) {
  const containerWidth = Math.max(0, toFiniteNumber(container?.width));
  const containerHeight = Math.max(0, toFiniteNumber(container?.height));
  const safeMargin = Math.max(0, toFiniteNumber(margin));
  const minimumWidth = Math.max(1, toFiniteNumber(minWidth, 320));
  const minimumHeight = Math.max(1, toFiniteNumber(minHeight, 180));
  const maxWidth = Math.max(minimumWidth, containerWidth - safeMargin * 2);
  const maxHeight = Math.max(minimumHeight, containerHeight - safeMargin * 2);
  const width = Math.min(maxWidth, Math.max(minimumWidth, toFiniteNumber(window?.width, minimumWidth)));
  const height = Math.min(maxHeight, Math.max(minimumHeight, toFiniteNumber(window?.height, minimumHeight)));
  const maxLeft = Math.max(safeMargin, containerWidth - safeMargin - width);
  const maxTop = Math.max(safeMargin, containerHeight - safeMargin - height);
  const left = Math.min(maxLeft, Math.max(safeMargin, toFiniteNumber(window?.left, safeMargin)));
  const top = Math.min(maxTop, Math.max(safeMargin, toFiniteNumber(window?.top, safeMargin)));

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function resolveFloatingSchemaDrag({
  startWindow,
  startPointer,
  pointer,
  container,
  minWidth = 320,
  minHeight = 180,
  margin = 8,
} = {}) {
  const dx = toFiniteNumber(pointer?.x) - toFiniteNumber(startPointer?.x);
  const dy = toFiniteNumber(pointer?.y) - toFiniteNumber(startPointer?.y);
  return clampFloatingSchemaWindow({
    window: {
      left: toFiniteNumber(startWindow?.left) + dx,
      top: toFiniteNumber(startWindow?.top) + dy,
      width: startWindow?.width,
      height: startWindow?.height,
    },
    container,
    minWidth,
    minHeight,
    margin,
  });
}

export function resolveFloatingSchemaResize({
  startWindow,
  startPointer,
  pointer,
  container,
  minWidth = 320,
  minHeight = 180,
  margin = 8,
} = {}) {
  const dx = toFiniteNumber(pointer?.x) - toFiniteNumber(startPointer?.x);
  const dy = toFiniteNumber(pointer?.y) - toFiniteNumber(startPointer?.y);
  return clampFloatingSchemaWindow({
    window: {
      left: startWindow?.left,
      top: startWindow?.top,
      width: toFiniteNumber(startWindow?.width) + dx,
      height: toFiniteNumber(startWindow?.height) + dy,
    },
    container,
    minWidth,
    minHeight,
    margin,
  });
}
```

**Step 4: Run tests**

Run: `node --test src/tableDialogLayout.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/tableDialogLayout.js src/tableDialogLayout.test.js
git commit -m "Add floating schema layout helpers"
```

---

### Task 2: Add Vue state and pointer handlers

**Files:**
- Modify: `src/App.vue`

**Step 1: Import helpers**

Find the existing import from `./tableDialogLayout.js` at the top of `src/App.vue` and add:

```js
  clampFloatingSchemaWindow,
  resolveFloatingSchemaDrag,
  resolveFloatingSchemaResize,
```

**Step 2: Add constants and state**

Near the existing table state around `const schemaCollapsed = ref(true);`, add:

```js
const FLOATING_SCHEMA_DEFAULTS = Object.freeze({ left: 16, top: 48, width: 520, height: 320 });
const FLOATING_SCHEMA_MIN_WIDTH = 320;
const FLOATING_SCHEMA_MIN_HEIGHT = 180;
const FLOATING_SCHEMA_MARGIN = 8;
const schemaTypeHidden = ref(false);
const fullscreenSchemaWindow = reactive({ ...FLOATING_SCHEMA_DEFAULTS });
let fullscreenSchemaDragState = null;
let fullscreenSchemaResizeState = null;
```

**Step 3: Add computed style and container measurement helpers**

Near `tableContentScaleStyle`, add:

```js
const fullscreenSchemaWindowStyle = computed(() => ({
  left: `${fullscreenSchemaWindow.left}px`,
  top: `${fullscreenSchemaWindow.top}px`,
  width: `${fullscreenSchemaWindow.width}px`,
  height: `${fullscreenSchemaWindow.height}px`,
}));

function getFullscreenSchemaContainerRect() {
  const element = tableModalRef.value;
  if (!(element instanceof HTMLElement)) return { width: window.innerWidth, height: window.innerHeight };
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function applyFullscreenSchemaWindow(nextWindow) {
  Object.assign(fullscreenSchemaWindow, clampFloatingSchemaWindow({
    window: nextWindow,
    container: getFullscreenSchemaContainerRect(),
    minWidth: FLOATING_SCHEMA_MIN_WIDTH,
    minHeight: FLOATING_SCHEMA_MIN_HEIGHT,
    margin: FLOATING_SCHEMA_MARGIN,
  }));
}

function normalizeFullscreenSchemaWindow() {
  applyFullscreenSchemaWindow(fullscreenSchemaWindow);
}
```

**Step 4: Add drag/resize/toggle handlers**

Place these near `toggleSchemaCollapsed()`:

```js
function toggleSchemaTypeHidden() {
  schemaTypeHidden.value = !schemaTypeHidden.value;
}

function onFullscreenSchemaHeaderPointerDown(event) {
  if (!tableFullscreen.value || schemaCollapsed.value) return;
  if (event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest("button, input, textarea, select, label, a, .schema-col-resize-handle")) return;
  event.preventDefault();
  event.stopPropagation();
  fullscreenSchemaDragState = {
    startWindow: { ...fullscreenSchemaWindow },
    startPointer: { x: event.clientX, y: event.clientY },
    pointerId: event.pointerId,
  };
  event.currentTarget?.setPointerCapture?.(event.pointerId);
}

function onFullscreenSchemaResizePointerDown(event) {
  if (!tableFullscreen.value || schemaCollapsed.value) return;
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  fullscreenSchemaResizeState = {
    startWindow: { ...fullscreenSchemaWindow },
    startPointer: { x: event.clientX, y: event.clientY },
    pointerId: event.pointerId,
  };
  event.currentTarget?.setPointerCapture?.(event.pointerId);
}

function onFullscreenSchemaPointerMove(event) {
  if (fullscreenSchemaDragState) {
    Object.assign(fullscreenSchemaWindow, resolveFloatingSchemaDrag({
      startWindow: fullscreenSchemaDragState.startWindow,
      startPointer: fullscreenSchemaDragState.startPointer,
      pointer: { x: event.clientX, y: event.clientY },
      container: getFullscreenSchemaContainerRect(),
      minWidth: FLOATING_SCHEMA_MIN_WIDTH,
      minHeight: FLOATING_SCHEMA_MIN_HEIGHT,
      margin: FLOATING_SCHEMA_MARGIN,
    }));
    return;
  }
  if (fullscreenSchemaResizeState) {
    Object.assign(fullscreenSchemaWindow, resolveFloatingSchemaResize({
      startWindow: fullscreenSchemaResizeState.startWindow,
      startPointer: fullscreenSchemaResizeState.startPointer,
      pointer: { x: event.clientX, y: event.clientY },
      container: getFullscreenSchemaContainerRect(),
      minWidth: FLOATING_SCHEMA_MIN_WIDTH,
      minHeight: FLOATING_SCHEMA_MIN_HEIGHT,
      margin: FLOATING_SCHEMA_MARGIN,
    }));
  }
}

function stopFullscreenSchemaPointerInteraction() {
  fullscreenSchemaDragState = null;
  fullscreenSchemaResizeState = null;
}
```

**Step 5: Wire window events**

In `bindPanelListeners()`, add:

```js
  window.addEventListener("pointermove", onFullscreenSchemaPointerMove);
  window.addEventListener("pointerup", stopFullscreenSchemaPointerInteraction);
  window.addEventListener("pointercancel", stopFullscreenSchemaPointerInteraction);
```

In `detachPanelListeners()`, remove those listeners.

In `onWindowResize()` or the closest existing resize handler, call:

```js
  normalizeFullscreenSchemaWindow();
```

Also add a watcher after existing table layout watchers:

```js
watch(
  () => [tableFullscreen.value, schemaCollapsed.value, tableDetailView.value],
  async () => {
    await nextTick();
    normalizeFullscreenSchemaWindow();
  },
);
```

**Step 6: No commit yet**

Do not commit until the template and styles are added in Task 3, because this state is unused until then.

---

### Task 3: Update Schema markup and styles

**Files:**
- Modify: `src/App.vue:13981-14149`
- Modify: `src/styles.css:2695-2713`
- Modify: `src/styles.css:3528-3588`

**Step 1: Update the Schema section markup**

Replace the full-view Schema section opening at `src/App.vue:14091` with dynamic classes and style:

```vue
<section
  :class="['schema-box', { 'schema-box--floating': tableFullscreen && !schemaCollapsed, 'schema-box--type-hidden': schemaTypeHidden }]"
  :style="tableFullscreen && !schemaCollapsed ? fullscreenSchemaWindowStyle : null"
>
```

Update the Schema header:

```vue
<div class="section-head schema-floating-head" @pointerdown="onFullscreenSchemaHeaderPointerDown">
  <h4>Schema 信息</h4>
  <div class="section-head-actions">
    <button class="section-action-btn" @click="openTableFind">搜索</button>
    <button v-if="tableFullscreen && !schemaCollapsed" class="section-action-btn" @click="toggleSchemaTypeHidden">
      {{ schemaTypeHidden ? "显示类型" : "隐藏类型" }}
    </button>
    <button class="section-toggle-btn" @click="toggleSchemaCollapsed">
      {{ schemaCollapsed ? "展开" : "收起" }}
    </button>
  </div>
</div>
```

Update the schema table `colgroup`, header, and body so the type column is conditional:

```vue
<colgroup>
  <col :style="getSchemaColumnStyle('column_name')" />
  <col v-if="!schemaTypeHidden" :style="getSchemaColumnStyle('column_type')" />
  <col />
</colgroup>
```

Wrap the type header and type cell with `v-if="!schemaTypeHidden"`.

Add resize handle before closing the `section`:

```vue
<span
  v-if="tableFullscreen && !schemaCollapsed"
  class="schema-floating-resize-handle"
  @pointerdown="onFullscreenSchemaResizePointerDown"
></span>
```

**Step 2: Replace fullscreen floating styles**

In `src/styles.css`, replace the current `.table-modal.fullscreen.fullscreen-schema-open .schema-box` and child body rules with:

```css
.table-modal.fullscreen.fullscreen-schema-open .schema-box.schema-box--floating {
  position: absolute;
  z-index: 18;
  display: flex;
  flex-direction: column;
  min-width: 320px;
  min-height: 180px;
  max-width: calc(100% - 16px);
  max-height: calc(100% - 16px);
  padding: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-glass) 72%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-panel) 98%, transparent);
  box-shadow: 0 18px 42px color-mix(in srgb, var(--text-main) 18%, transparent);
}

.table-modal.fullscreen.fullscreen-schema-open .schema-box.schema-box--floating > .section-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.schema-box--floating .schema-floating-head {
  cursor: move;
  user-select: none;
  flex-shrink: 0;
}

.schema-floating-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
}

.schema-floating-resize-handle::after {
  content: "";
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--accent-line);
  border-bottom: 2px solid var(--accent-line);
}
```

**Step 3: Add compact type-hidden table styles**

Near the existing schema table styles, add:

```css
.schema-box--type-hidden .schema-table {
  table-layout: fixed;
}

.schema-box--type-hidden .schema-table th:first-child,
.schema-box--type-hidden .schema-table td:first-child {
  width: 38%;
}
```

**Step 4: Run frontend tests**

Run: `node --test src/tableDialogLayout.test.js`

Expected: PASS.

**Step 5: Run build**

Run: `npm run build`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/App.vue src/styles.css
git commit -m "Add fullscreen schema floating window"
```

---

### Task 4: Manual UI verification

**Files:**
- No code changes expected unless verification finds issues.

**Step 1: Start the dev UI**

Run: `npm run dev`

Expected: Vite starts on port 1430.

**Step 2: Open the panel in browser or Tauri dev window**

If using browser, navigate to the Vite dev URL printed by the command. If the app needs Tauri APIs for this flow, stop Vite and run `npm run tauri dev` instead.

**Step 3: Verify fullscreen Schema behavior**

Manual checklist:

- Open a table in full detail view.
- Enter fullscreen table mode.
- Click `Schema`.
- Confirm Schema appears as a small floating window.
- Drag the title bar around; it stays inside the table dialog.
- Resize using the bottom-right handle; it respects the minimum size and content scrolls.
- Click `隐藏类型`; the type column disappears and button changes to `显示类型`.
- Click `显示类型`; the type column returns.
- Click `搜索`; table find opens and Schema highlights still work.
- Exit fullscreen; normal Schema layout still works.

**Step 4: Fix any issues found**

If manual verification finds layout or interaction bugs, fix the minimal issue in `src/App.vue` or `src/styles.css`, then rerun:

```bash
node --test src/tableDialogLayout.test.js
npm run build
```

**Step 5: Commit fixes if needed**

```bash
git add src/App.vue src/styles.css src/tableDialogLayout.js src/tableDialogLayout.test.js
git commit -m "Fix fullscreen schema floating window verification issues"
```
