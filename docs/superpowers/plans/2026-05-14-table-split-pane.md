# Table Split Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-pane table workspace that supports left/right and top/bottom table comparison, including same-table independent instances.

**Architecture:** Add a pure split-workspace model first, then wire `App.vue` through an active-pane compatibility layer before rendering the second pane. Keep existing table tabs and cache behavior, but add explicit view instances so normal open still deduplicates by table name while split open can duplicate a table.

**Tech Stack:** Vue 3 Composition API, Tauri invoke API, Node.js built-in test runner, existing Canvas fast grid helpers, existing `App.vue` table state.

---

## File Structure

- Create `src/tableSplitWorkspace.js`: pure helpers for pane ids, split mode normalization, pane creation, focus changes, split/close operations, responsive mode resolution, and duplicate table labels.
- Create `src/tableSplitWorkspace.test.js`: Node tests for the pure split-workspace model and duplicate table display labels.
- Modify `src/App.vue`: table workspace state, active pane compatibility functions, split toolbar actions, duplicated table instance opening, pane shell rendering, pane-level fast grid and seamless state.
- Modify `src/styles.css`: split workspace layout, pane title bars, focus state, divider, compact window behavior.
- Extend existing tests only when a behavior is pure enough to test outside Vue. Use build verification for template and reactive wiring.

## Task 1: Pure Split Workspace Model

**Files:**
- Create: `src/tableSplitWorkspace.js`
- Create: `src/tableSplitWorkspace.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/tableSplitWorkspace.test.js` with:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  createSplitWorkspace,
  createTablePane,
  focusWorkspacePane,
  splitWorkspace,
  closeWorkspacePane,
  resolveEffectiveSplitMode,
  getTableTabDisplayName,
} from "./tableSplitWorkspace.js";

test("createSplitWorkspace starts with one primary pane", () => {
  const workspace = createSplitWorkspace({
    primaryPane: createTablePane({
      id: "primary",
      tabId: "tab-1",
      instanceId: "users-1",
      viewState: { tableName: "users" },
    }),
  });

  assert.equal(workspace.splitMode, "none");
  assert.equal(workspace.activePaneId, "primary");
  assert.equal(workspace.splitRatio, 0.5);
  assert.deepEqual(workspace.panes.map((pane) => pane.id), ["primary"]);
});

test("splitWorkspace creates a secondary pane and focuses it", () => {
  const workspace = createSplitWorkspace({
    primaryPane: createTablePane({
      id: "primary",
      tabId: "tab-1",
      instanceId: "users-1",
      viewState: { tableName: "users" },
    }),
  });

  const next = splitWorkspace({
    workspace,
    mode: "vertical",
    pane: createTablePane({
      id: "secondary",
      tabId: "tab-2",
      instanceId: "orders-1",
      viewState: { tableName: "orders" },
    }),
  });

  assert.equal(next.splitMode, "vertical");
  assert.equal(next.activePaneId, "secondary");
  assert.deepEqual(next.panes.map((pane) => pane.id), ["primary", "secondary"]);
});

test("focusWorkspacePane ignores missing pane ids", () => {
  const workspace = splitWorkspace({
    workspace: createSplitWorkspace({
      primaryPane: createTablePane({
        id: "primary",
        tabId: "tab-1",
        instanceId: "users-1",
        viewState: { tableName: "users" },
      }),
    }),
    mode: "horizontal",
    pane: createTablePane({
      id: "secondary",
      tabId: "tab-2",
      instanceId: "orders-1",
      viewState: { tableName: "orders" },
    }),
  });

  assert.equal(focusWorkspacePane(workspace, "missing").activePaneId, "secondary");
  assert.equal(focusWorkspacePane(workspace, "primary").activePaneId, "primary");
});

test("closeWorkspacePane keeps the requested pane when split closes", () => {
  const workspace = splitWorkspace({
    workspace: createSplitWorkspace({
      primaryPane: createTablePane({
        id: "primary",
        tabId: "tab-1",
        instanceId: "users-1",
        viewState: { tableName: "users" },
      }),
    }),
    mode: "vertical",
    pane: createTablePane({
      id: "secondary",
      tabId: "tab-2",
      instanceId: "orders-1",
      viewState: { tableName: "orders" },
    }),
  });

  const next = closeWorkspacePane(workspace, "primary");

  assert.equal(next.splitMode, "none");
  assert.equal(next.activePaneId, "primary");
  assert.deepEqual(next.panes.map((pane) => pane.id), ["primary"]);
});

test("resolveEffectiveSplitMode turns narrow vertical split into horizontal", () => {
  assert.equal(resolveEffectiveSplitMode({ splitMode: "vertical", width: 860 }), "horizontal");
  assert.equal(resolveEffectiveSplitMode({ splitMode: "vertical", width: 1200 }), "vertical");
  assert.equal(resolveEffectiveSplitMode({ splitMode: "horizontal", width: 860 }), "horizontal");
});

test("getTableTabDisplayName adds an ordinal only for duplicate table instances", () => {
  const tabs = [
    { id: "tab-1", tableName: "orders", instanceId: "orders-1" },
    { id: "tab-2", tableName: "users", instanceId: "users-1" },
    { id: "tab-3", tableName: "orders", instanceId: "orders-2" },
  ];

  assert.equal(getTableTabDisplayName(tabs, tabs[0]), "orders");
  assert.equal(getTableTabDisplayName(tabs, tabs[1]), "users");
  assert.equal(getTableTabDisplayName(tabs, tabs[2]), "orders #2");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/tableSplitWorkspace.test.js`

Expected: FAIL with a module resolution error because `src/tableSplitWorkspace.js` does not exist.

- [ ] **Step 3: Create the pure helper module**

Create `src/tableSplitWorkspace.js` with:

```js
const PANE_IDS = Object.freeze(["primary", "secondary"]);
const SPLIT_MODES = Object.freeze(["none", "vertical", "horizontal"]);

function normalizePaneId(id, fallback = "primary") {
  const value = String(id || "");
  return PANE_IDS.includes(value) ? value : fallback;
}

export function normalizeSplitMode(mode) {
  const value = String(mode || "none");
  return SPLIT_MODES.includes(value) ? value : "none";
}

export function normalizeSplitRatio(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(0.8, Math.max(0.2, numeric));
}

export function createTablePane({
  id = "primary",
  tabId = "",
  instanceId = "",
  viewState = {},
} = {}) {
  return {
    id: normalizePaneId(id),
    tabId: String(tabId || ""),
    instanceId: String(instanceId || ""),
    viewState: { ...(viewState || {}) },
  };
}

export function createSplitWorkspace({
  splitMode = "none",
  activePaneId = "primary",
  splitRatio = 0.5,
  primaryPane = null,
  panes = null,
} = {}) {
  const sourcePanes = Array.isArray(panes) && panes.length > 0
    ? panes
    : [primaryPane || createTablePane({ id: "primary" })];
  const normalizedPanes = sourcePanes
    .slice(0, 2)
    .map((pane, index) => createTablePane({
      ...pane,
      id: index === 0 ? "primary" : "secondary",
    }));
  const hasSecondary = normalizedPanes.length > 1;
  const nextMode = hasSecondary ? normalizeSplitMode(splitMode) || "vertical" : "none";
  const nextActive = normalizedPanes.some((pane) => pane.id === activePaneId)
    ? activePaneId
    : normalizedPanes[normalizedPanes.length - 1].id;

  return {
    splitMode: hasSecondary && nextMode !== "none" ? nextMode : "none",
    activePaneId: normalizePaneId(nextActive),
    splitRatio: normalizeSplitRatio(splitRatio),
    panes: normalizedPanes,
  };
}

export function isWorkspaceSplit(workspace = {}) {
  return normalizeSplitMode(workspace.splitMode) !== "none" && Array.isArray(workspace.panes) && workspace.panes.length > 1;
}

export function getWorkspacePane(workspace = {}, paneId = "primary") {
  const id = normalizePaneId(paneId);
  return Array.isArray(workspace.panes) ? workspace.panes.find((pane) => pane.id === id) || null : null;
}

export function getActiveWorkspacePane(workspace = {}) {
  return getWorkspacePane(workspace, workspace.activePaneId) || getWorkspacePane(workspace, "primary");
}

export function focusWorkspacePane(workspace = {}, paneId = "primary") {
  if (!getWorkspacePane(workspace, paneId)) return createSplitWorkspace(workspace);
  return createSplitWorkspace({ ...workspace, activePaneId: paneId, panes: workspace.panes });
}

export function splitWorkspace({ workspace = {}, mode = "vertical", pane } = {}) {
  const current = createSplitWorkspace(workspace);
  const primary = getWorkspacePane(current, "primary") || createTablePane({ id: "primary" });
  const secondary = createTablePane({ ...(pane || {}), id: "secondary" });
  return createSplitWorkspace({
    splitMode: normalizeSplitMode(mode) === "horizontal" ? "horizontal" : "vertical",
    activePaneId: "secondary",
    splitRatio: current.splitRatio,
    panes: [primary, secondary],
  });
}

export function closeWorkspacePane(workspace = {}, keepPaneId = "primary") {
  const current = createSplitWorkspace(workspace);
  const keep = getWorkspacePane(current, keepPaneId) || getActiveWorkspacePane(current) || getWorkspacePane(current, "primary");
  return createSplitWorkspace({
    splitMode: "none",
    activePaneId: keep?.id || "primary",
    splitRatio: current.splitRatio,
    panes: [createTablePane({ ...(keep || {}), id: "primary" })],
  });
}

export function resolveEffectiveSplitMode({
  splitMode = "none",
  width = 0,
  minVerticalWidth = 960,
} = {}) {
  const mode = normalizeSplitMode(splitMode);
  if (mode !== "vertical") return mode;
  return Number(width) >= Number(minVerticalWidth) ? "vertical" : "horizontal";
}

export function getTableTabDisplayName(tabs = [], tab = {}) {
  const tableName = String(tab?.tableName || "");
  if (!tableName) return "";
  const matches = (Array.isArray(tabs) ? tabs : []).filter(
    (item) => String(item?.tableName || "").toLowerCase() === tableName.toLowerCase(),
  );
  if (matches.length <= 1) return tableName;
  const index = matches.findIndex((item) => String(item?.id || "") === String(tab?.id || ""));
  return index <= 0 ? tableName : `${tableName} #${index + 1}`;
}
```

- [ ] **Step 4: Run the split workspace test**

Run: `node --test src/tableSplitWorkspace.test.js`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/tableSplitWorkspace.js src/tableSplitWorkspace.test.js
git commit -m "feat: add table split workspace model"
```

## Task 2: Snapshot Instance IDs and Duplicate Labels

**Files:**
- Modify: `src/App.vue`
- Test: `src/tableSplitWorkspace.test.js`

- [ ] **Step 1: Extend the pure test for stable duplicate labels after reordering**

Append to `src/tableSplitWorkspace.test.js`:

```js
test("getTableTabDisplayName follows current tab order for duplicate ordinals", () => {
  const tabs = [
    { id: "tab-3", tableName: "orders", instanceId: "orders-2" },
    { id: "tab-1", tableName: "orders", instanceId: "orders-1" },
  ];

  assert.equal(getTableTabDisplayName(tabs, tabs[0]), "orders");
  assert.equal(getTableTabDisplayName(tabs, tabs[1]), "orders #2");
});
```

- [ ] **Step 2: Run the test**

Run: `node --test src/tableSplitWorkspace.test.js`

Expected: PASS. This guards the label helper before `App.vue` uses it.

- [ ] **Step 3: Import the display helper in `App.vue`**

Add `getTableTabDisplayName` to the existing imports from `./tableSplitWorkspace.js`:

```js
import {
  createSplitWorkspace,
  createTablePane,
  focusWorkspacePane,
  splitWorkspace,
  closeWorkspacePane,
  resolveEffectiveSplitMode,
  getTableTabDisplayName,
} from "./tableSplitWorkspace.js";
```

- [ ] **Step 4: Add an instance id seed beside the existing tab id seed**

Near `let tableTabIdSeed = 0;`, add:

```js
let tableInstanceIdSeed = 0;

function nextTableInstanceId(tableName = "table") {
  tableInstanceIdSeed += 1;
  const normalized = String(tableName || "table").trim().replace(/[^a-zA-Z0-9_]+/g, "_") || "table";
  return `${normalized}-${tableInstanceIdSeed}`;
}
```

- [ ] **Step 5: Add `instanceId` to table snapshots**

In `createLiveTableSnapshot`, add the property directly after `id`:

```js
instanceId: current?.instanceId || nextTableInstanceId(tableName || tableView.tableName),
```

Use this local `current` binding at the top of the function:

```js
const current = tableTabs.value.find((item) => item.id === id) || null;
```

In `createNewTableSnapshot`, add:

```js
instanceId: nextTableInstanceId(tableName),
```

- [ ] **Step 6: Use duplicate-aware tab labels in the template**

Replace the table tab label binding:

```vue
<span class="table-tab-label">{{ tab.tableName }}</span>
```

with:

```vue
<span class="table-tab-label">{{ getTableTabDisplayName(tableTabs, tab) }}</span>
```

- [ ] **Step 7: Run build verification**

Run: `npm run build`

Expected: PASS with Vite production build output.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/App.vue src/tableSplitWorkspace.test.js
git commit -m "feat: label duplicate table instances"
```

## Task 3: Active Pane Compatibility Layer

**Files:**
- Modify: `src/App.vue`
- Test: `src/tableSplitWorkspace.test.js`

- [ ] **Step 1: Add a pure test for active pane preservation**

Append to `src/tableSplitWorkspace.test.js`:

```js
test("focusWorkspacePane keeps split mode and ratio", () => {
  const workspace = splitWorkspace({
    workspace: createSplitWorkspace({
      splitRatio: 0.63,
      primaryPane: createTablePane({
        id: "primary",
        tabId: "tab-1",
        instanceId: "users-1",
        viewState: { tableName: "users" },
      }),
    }),
    mode: "vertical",
    pane: createTablePane({
      id: "secondary",
      tabId: "tab-2",
      instanceId: "orders-1",
      viewState: { tableName: "orders" },
    }),
  });

  const next = focusWorkspacePane(workspace, "primary");

  assert.equal(next.splitMode, "vertical");
  assert.equal(next.splitRatio, 0.63);
  assert.equal(next.activePaneId, "primary");
});
```

- [ ] **Step 2: Run the pure tests**

Run: `node --test src/tableSplitWorkspace.test.js`

Expected: PASS.

- [ ] **Step 3: Create table workspace state in `App.vue`**

After `const activeTableTabId = ref("");`, add:

```js
const tableWorkspace = reactive(createSplitWorkspace());
const tableWorkspaceWidth = ref(0);
const tableWorkspaceEffectiveSplitMode = computed(() => resolveEffectiveSplitMode({
  splitMode: tableWorkspace.splitMode,
  width: tableWorkspaceWidth.value,
}));
```

- [ ] **Step 4: Add helper functions to keep primary pane synchronized**

Place these near the table tab helpers:

```js
function activeTablePane() {
  return tableWorkspace.panes.find((pane) => pane.id === tableWorkspace.activePaneId)
    || tableWorkspace.panes[0]
    || createTablePane({ id: "primary" });
}

function assignTableWorkspace(nextWorkspace) {
  tableWorkspace.splitMode = nextWorkspace.splitMode;
  tableWorkspace.activePaneId = nextWorkspace.activePaneId;
  tableWorkspace.splitRatio = nextWorkspace.splitRatio;
  tableWorkspace.panes = nextWorkspace.panes;
}

function syncPrimaryPaneToActiveTab() {
  const tab = tableTabs.value.find((item) => item.id === activeTableTabId.value);
  const pane = createTablePane({
    id: "primary",
    tabId: activeTableTabId.value,
    instanceId: tab?.instanceId || "",
    viewState: tab ? { tableName: tab.tableName } : {},
  });
  assignTableWorkspace(createSplitWorkspace({
    ...tableWorkspace,
    activePaneId: "primary",
    panes: [pane, ...tableWorkspace.panes.filter((item) => item.id === "secondary")],
  }));
}

function focusTablePane(paneId) {
  assignTableWorkspace(focusWorkspacePane(tableWorkspace, paneId));
}
```

- [ ] **Step 5: Call `syncPrimaryPaneToActiveTab` after tab activation and creation**

At the end of `activateTableTab`, after `scrollTableTabIntoView(next.id);`, add:

```js
syncPrimaryPaneToActiveTab();
```

At the end of `openOrActivateTableTab`, after `scrollTableTabIntoView(nextTab.id);`, add:

```js
syncPrimaryPaneToActiveTab();
```

- [ ] **Step 6: Run verification**

Run: `node --test src/tableSplitWorkspace.test.js`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/App.vue src/tableSplitWorkspace.test.js
git commit -m "feat: add table pane compatibility state"
```

## Task 4: Split Open Path Without Visual Split

**Files:**
- Modify: `src/App.vue`
- Test: `src/tableSplitWorkspace.test.js`

- [ ] **Step 1: Add a pure test for split replacement**

Append to `src/tableSplitWorkspace.test.js`:

```js
test("splitWorkspace replaces an existing secondary pane", () => {
  const first = splitWorkspace({
    workspace: createSplitWorkspace({
      primaryPane: createTablePane({
        id: "primary",
        tabId: "tab-1",
        instanceId: "users-1",
        viewState: { tableName: "users" },
      }),
    }),
    mode: "vertical",
    pane: createTablePane({
      id: "secondary",
      tabId: "tab-2",
      instanceId: "orders-1",
      viewState: { tableName: "orders" },
    }),
  });

  const next = splitWorkspace({
    workspace: first,
    mode: "horizontal",
    pane: createTablePane({
      id: "secondary",
      tabId: "tab-3",
      instanceId: "audit-1",
      viewState: { tableName: "audit_logs" },
    }),
  });

  assert.equal(next.splitMode, "horizontal");
  assert.equal(next.panes[1].tabId, "tab-3");
  assert.equal(next.activePaneId, "secondary");
});
```

- [ ] **Step 2: Run the pure tests**

Run: `node --test src/tableSplitWorkspace.test.js`

Expected: PASS.

- [ ] **Step 3: Extend `openOrActivateTableTab` options**

Change the signature:

```js
async function openOrActivateTableTab(tableName, rowIndex = null, columnName = null, hitContext = {}, options = {}) {
```

Add these option bindings after `normalizedName`:

```js
const allowDuplicate = !!options.allowDuplicate;
const splitMode = options.splitMode === "horizontal" ? "horizontal" : options.splitMode === "vertical" ? "vertical" : "none";
```

Change the existing duplicate lookup guard to:

```js
const exists = !allowDuplicate
  ? tableTabs.value.find((item) => item.tableName.toLowerCase() === normalizedName.toLowerCase())
  : null;
```

- [ ] **Step 4: Add `openTableInSplitPane`**

Add near `openOrActivateTableTab`:

```js
async function openTableInSplitPane(tableName, mode = "vertical") {
  const normalizedMode = mode === "horizontal" ? "horizontal" : "vertical";
  const beforeTabIds = new Set(tableTabs.value.map((tab) => tab.id));
  await openOrActivateTableTab(tableName, null, null, {}, {
    allowDuplicate: true,
    splitMode: normalizedMode,
  });
  const createdTab = [...tableTabs.value].reverse().find((tab) => !beforeTabIds.has(tab.id))
    || tableTabs.value.find((tab) => tab.id === activeTableTabId.value);
  if (!createdTab) return;
  assignTableWorkspace(splitWorkspace({
    workspace: tableWorkspace,
    mode: normalizedMode,
    pane: createTablePane({
      id: "secondary",
      tabId: createdTab.id,
      instanceId: createdTab.instanceId || "",
      viewState: { tableName: createdTab.tableName },
    }),
  }));
}

async function splitCurrentTableRight() {
  if (!tableView.tableName) return;
  snapshotActiveTableTab();
  await openTableInSplitPane(tableView.tableName, "vertical");
}

async function splitCurrentTableDown() {
  if (!tableView.tableName) return;
  snapshotActiveTableTab();
  await openTableInSplitPane(tableView.tableName, "horizontal");
}
```

- [ ] **Step 5: Add temporary toolbar buttons**

Inside `.table-header-actions`, before the fullscreen button, add:

```vue
<button class="small-btn" @click="splitCurrentTableRight">右侧分屏</button>
<button class="small-btn" @click="splitCurrentTableDown">下方分屏</button>
```

- [ ] **Step 6: Run verification**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/App.vue src/tableSplitWorkspace.test.js
git commit -m "feat: add split table open path"
```

## Task 5: Split Pane Shell and Styling

**Files:**
- Modify: `src/App.vue`
- Modify: `src/styles.css`

- [ ] **Step 1: Add pane shell computed state**

In `App.vue`, add:

```js
const tableWorkspaceSplit = computed(() => tableWorkspace.splitMode !== "none" && tableWorkspace.panes.length > 1);
const tableWorkspaceClass = computed(() => ({
  "table-workspace--split": tableWorkspaceSplit.value,
  "table-workspace--vertical": tableWorkspaceEffectiveSplitMode.value === "vertical",
  "table-workspace--horizontal": tableWorkspaceEffectiveSplitMode.value === "horizontal",
}));

function tablePaneTitle(pane) {
  const tab = tableTabs.value.find((item) => item.id === pane.tabId);
  return getTableTabDisplayName(tableTabs.value, tab || { tableName: pane.viewState?.tableName || "" });
}

function closeTableSplit() {
  assignTableWorkspace(closeWorkspacePane(tableWorkspace, tableWorkspace.activePaneId));
}

function switchTableSplitDirection() {
  if (!tableWorkspaceSplit.value) return;
  tableWorkspace.splitMode = tableWorkspace.splitMode === "vertical" ? "horizontal" : "vertical";
}
```

- [ ] **Step 2: Wrap table content with a workspace shell**

Replace:

```vue
<div class="table-content">
<div class="table-content-viewport">
<div class="table-content-scale" :style="tableContentScaleStyle">
```

with:

```vue
<div class="table-content">
<div
  class="table-workspace"
  :class="tableWorkspaceClass"
  :style="{ '--table-split-ratio': tableWorkspace.splitRatio }"
>
  <section
    v-for="pane in tableWorkspace.panes"
    :key="pane.id"
    :class="['table-pane', { active: pane.id === tableWorkspace.activePaneId }]"
    @mousedown.capture="focusTablePane(pane.id)"
  >
    <div v-if="tableWorkspaceSplit" class="table-pane-titlebar">
      <span class="table-pane-title">{{ tablePaneTitle(pane) }}</span>
      <button class="table-pane-close" @click.stop="focusTablePane(pane.id); closeTableSplit()">✕</button>
    </div>
    <div class="table-content-viewport">
    <div class="table-content-scale" :style="tableContentScaleStyle">
```

Add the matching closing tags after the existing `</div>` for `.table-content-scale` and `.table-content-viewport`:

```vue
    </div>
    </div>
  </section>
</div>
```

At this step both panes show the active pane content. Task 6 moves render state to each pane.

- [ ] **Step 3: Add toolbar controls for existing split state**

Beside the temporary split buttons, add:

```vue
<button v-if="tableWorkspaceSplit" class="small-btn" @click="switchTableSplitDirection">切换方向</button>
<button v-if="tableWorkspaceSplit" class="small-btn" @click="closeTableSplit">关闭分屏</button>
```

- [ ] **Step 4: Add CSS for the pane shell**

Append to `src/styles.css` near the table modal styles:

```css
.table-workspace {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
}

.table-workspace--vertical {
  flex-direction: row;
}

.table-workspace--horizontal {
  flex-direction: column;
}

.table-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  border: 1px solid transparent;
}

.table-workspace--vertical .table-pane:first-child {
  flex-basis: calc(var(--table-split-ratio, 0.5) * 100%);
  border-right-color: var(--surface-card-border);
}

.table-workspace--horizontal .table-pane:first-child {
  flex-basis: calc(var(--table-split-ratio, 0.5) * 100%);
  border-bottom-color: var(--surface-card-border);
}

.table-pane.active {
  border-color: color-mix(in srgb, var(--accent) 58%, var(--surface-card-border));
}

.table-pane-titlebar {
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  background: var(--surface-card-soft);
  border-bottom: 1px solid var(--surface-card-border);
  font-size: 12px;
}

.table-pane-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-main);
}

.table-pane-close {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-sub);
  cursor: pointer;
}

.table-pane-close:hover {
  background: var(--accent-soft);
  color: var(--text-main);
}
```

- [ ] **Step 5: Run build verification**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/App.vue src/styles.css
git commit -m "feat: add table split pane shell"
```

## Task 6: Pane-Local Fast Grid State

**Files:**
- Modify: `src/App.vue`
- Test: `src/fastTableGrid.test.js`

- [ ] **Step 1: Add a fast grid regression test for independent scroll targets**

Append to `src/fastTableGrid.test.js`:

```js
test("resolveFastGridCellScrollTarget keeps frozen rows independent from caller scroll", () => {
  const columns = [{ column_name: "id" }, { column_name: "name" }, { column_name: "notes" }];

  const leftPane = resolveFastGridCellScrollTarget({
    rowIndex: 5,
    columnName: "notes",
    columns,
    currentScrollLeft: 0,
    currentScrollTop: 0,
    frozenRowIndex: 10,
    getColumnWidth: () => 100,
  });
  const rightPane = resolveFastGridCellScrollTarget({
    rowIndex: 50,
    columnName: "notes",
    columns,
    currentScrollLeft: 400,
    currentScrollTop: 900,
    frozenRowIndex: null,
    getColumnWidth: () => 100,
  });

  assert.equal(leftPane.scrollTop, 0);
  assert.equal(rightPane.scrollTop, 1550);
});
```

- [ ] **Step 2: Run fast grid tests**

Run: `node --test src/fastTableGrid.test.js`

Expected: PASS.

- [ ] **Step 3: Add pane fast grid state factory**

In `App.vue`, add:

```js
function createPaneRuntimeState() {
  return {
    fastGrid: {
      canvas: null,
      viewport: null,
      scroll: reactive({ left: 0, top: 0, width: 0, height: 0 }),
      focus: reactive({ rowIndex: -1, columnName: "" }),
      raf: 0,
    },
    seamless: reactive({
      enabled: false,
      loading: false,
      loadingBlocks: new Set(),
      blocks: new Map(),
      totalRows: 0,
      activeBlock: 1,
      scrollTop: 0,
      clientHeight: 0,
      generation: 0,
    }),
  };
}

const tablePaneRuntime = reactive({
  primary: createPaneRuntimeState(),
  secondary: createPaneRuntimeState(),
});

function runtimeForPane(paneId = tableWorkspace.activePaneId) {
  return tablePaneRuntime[paneId] || tablePaneRuntime.primary;
}
```

- [ ] **Step 4: Add pane-aware ref setters**

Add:

```js
function setPaneFastGridCanvas(paneId, element) {
  runtimeForPane(paneId).fastGrid.canvas = element;
}

function setPaneFastGridViewport(paneId, element) {
  runtimeForPane(paneId).fastGrid.viewport = element;
}
```

Change fast grid template refs from:

```vue
ref="fastTableGridViewportRef"
ref="fastTableGridCanvasRef"
```

to:

```vue
:ref="(element) => setPaneFastGridViewport(pane.id, element)"
:ref="(element) => setPaneFastGridCanvas(pane.id, element)"
```

- [ ] **Step 5: Thread pane id into fast grid handlers**

Change template handlers:

```vue
@scroll="onFastTableGridScroll($event, pane.id)"
@pointermove="onFastTableGridPointerMove($event, pane.id)"
@pointerleave="onFastTableGridPointerLeave(pane.id)"
@pointerdown="onFastTableGridPointerDown($event, pane.id)"
@click="onFastTableGridClick($event, pane.id)"
@dblclick="onFastTableGridDoubleClick($event, pane.id)"
@contextmenu.prevent="onFastTableGridContextMenu($event, pane.id)"
```

Change each handler signature to accept `paneId`, then use:

```js
const runtime = runtimeForPane(paneId);
const viewport = runtime.fastGrid.viewport;
const scroll = runtime.fastGrid.scroll;
```

Replace reads and writes of `fastTableGridScroll` and `fastTableGridFocus` inside these handlers with `scroll` and `runtime.fastGrid.focus`.

- [ ] **Step 6: Run verification**

Run: `node --test src/fastTableGrid.test.js`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/App.vue src/fastTableGrid.test.js
git commit -m "feat: scope fast grid runtime to panes"
```

## Task 7: Pane-Local Seamless Blocks and Rendering

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Add pane state accessors**

Add:

```js
function activePaneViewState() {
  return activeTablePane().viewState || {};
}

function saveLiveStateToPane(paneId = tableWorkspace.activePaneId) {
  const pane = tableWorkspace.panes.find((item) => item.id === paneId);
  if (!pane) return;
  pane.viewState = createLiveTableSnapshot({
    id: activeTableTabId.value,
    tableName: tableView.tableName,
  });
}

function restorePaneToLiveState(paneId) {
  const pane = tableWorkspace.panes.find((item) => item.id === paneId);
  const tab = pane?.tabId ? tableTabs.value.find((item) => item.id === pane.tabId) : null;
  if (tab) {
    activeTableTabId.value = tab.id;
    restoreLiveStateFromTableSnapshot(tab);
    return;
  }
  if (pane?.viewState?.tableName) {
    restoreLiveStateFromTableSnapshot(pane.viewState);
  }
}
```

- [ ] **Step 2: Save and restore when focus changes**

Replace `focusTablePane` with:

```js
function focusTablePane(paneId) {
  if (paneId === tableWorkspace.activePaneId) return;
  snapshotActiveTableTab();
  saveLiveStateToPane(tableWorkspace.activePaneId);
  assignTableWorkspace(focusWorkspacePane(tableWorkspace, paneId));
  restorePaneToLiveState(paneId);
  if (tableDetailView.value === "full" && !editMode.value && !dataCollapsed.value) {
    enableSeamlessTableFromCurrentPage().catch(() => {});
  }
}
```

- [ ] **Step 3: Store seamless state per active pane**

In `resetSeamlessTable`, start with:

```js
const target = runtimeForPane().seamless;
```

Then replace writes to `seamlessTable` in that function with `target`.

In `loadSeamlessTableBlock`, `enableSeamlessTableFromCurrentPage`, `flushTableGridScroll`, and `loadVisibleSeamlessBlocks`, introduce:

```js
const seamlessState = runtimeForPane().seamless;
```

Use `seamlessState` for blocks, loading state, total rows, active block, scrollTop, clientHeight, generation, and loadingBlocks. Keep `tableView` as the active pane compatibility state.

- [ ] **Step 4: Keep inactive pane snapshots current on split close**

In `closeTableSplit`, replace the body with:

```js
function closeTableSplit() {
  snapshotActiveTableTab();
  saveLiveStateToPane(tableWorkspace.activePaneId);
  assignTableWorkspace(closeWorkspacePane(tableWorkspace, tableWorkspace.activePaneId));
  syncPrimaryPaneToActiveTab();
}
```

- [ ] **Step 5: Run verification**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/App.vue
git commit -m "feat: persist table pane view state"
```

## Task 8: Pane Actions, Editing Guard, and Polish

**Files:**
- Modify: `src/App.vue`
- Modify: `src/styles.css`

- [ ] **Step 1: Add an editing guard for split mode**

In `onEditToggleClick`, before enabling edit mode, add:

```js
if (!editMode.value && tableWorkspaceSplit.value) {
  const inactivePane = tableWorkspace.panes.find((pane) => pane.id !== tableWorkspace.activePaneId);
  if (inactivePane) {
    summaryText.value = "分屏模式下仅当前焦点窗格进入编辑，另一侧保持只读";
  }
}
```

In `focusTablePane`, before changing pane, add:

```js
if (editMode.value && hasUnsavedEditChanges()) {
  summaryText.value = "当前窗格有未保存编辑，请先保存或退出编辑";
  return;
}
```

Use the existing unsaved-change predicate already used by page switching. If it is not named `hasUnsavedEditChanges`, create:

```js
function hasUnsavedEditChanges() {
  return editChanges.updates.size > 0
    || editChanges.inserts.length > 0
    || editChanges.deletes.size > 0;
}
```

- [ ] **Step 2: Make split buttons active-pane aware**

Change temporary split buttons to:

```vue
<button class="small-btn" @click="splitCurrentTableRight" :disabled="!tableView.tableName">右侧分屏</button>
<button class="small-btn" @click="splitCurrentTableDown" :disabled="!tableView.tableName">下方分屏</button>
```

- [ ] **Step 3: Add pane title metadata**

Extend `tablePaneTitlebar` template:

```vue
<span class="table-pane-title">{{ tablePaneTitle(pane) }}</span>
<span class="table-pane-meta" v-if="pane.id === tableWorkspace.activePaneId">{{ seamlessVisibleRangeText }}</span>
```

Add CSS:

```css
.table-pane-meta {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 11px;
}
```

- [ ] **Step 4: Add compact toolbar styling**

Add:

```css
.table-modal:not(.fullscreen) .table-header-actions .small-btn {
  min-width: 0;
  padding-inline: 8px;
}

.table-workspace--split .table-content-viewport {
  flex: 1 1 auto;
  min-height: 0;
}
```

- [ ] **Step 5: Run verification**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add src/App.vue src/styles.css
git commit -m "feat: polish table split pane controls"
```

## Task 9: Full Verification

**Files:**
- No source edits expected unless verification finds a concrete failure.

- [ ] **Step 1: Run all frontend unit tests**

Run: `node --test src/*.test.js`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Start the frontend dev server**

Run: `npm run dev`

Expected: Vite serves on `http://localhost:1430`.

- [ ] **Step 4: Manual UI verification in the running app**

Verify these flows:

- Open a table in the normal table window.
- Click `右侧分屏`; confirm a second pane appears.
- In the second pane, horizontal scroll does not move the first pane.
- Click `下方分屏`; confirm the split direction changes or the second pane is recreated below.
- Open a different table into the second pane through the command palette path.
- Split the same table and confirm duplicate tab labels show `表名` and `表名 #2`.
- Focus each pane and confirm toolbar actions target the focused pane.
- Enter edit mode while split is active and confirm only the focused pane edits.
- Try focusing the other pane with unsaved edits and confirm the guard message appears.
- Close split and confirm the focused pane remains.
- Resize the window narrower and confirm left/right split displays as top/bottom.

- [ ] **Step 5: Commit verification fixes if any source changed**

If Step 4 required a source fix, run:

```bash
git add src/App.vue src/styles.css src/tableSplitWorkspace.js src/tableSplitWorkspace.test.js src/fastTableGrid.test.js
git commit -m "fix: stabilize table split pane behavior"
```

If Step 4 required no source fix, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers two-pane split modes, same-table duplicate instances, different-table panes, independent pane state, active-pane toolbar behavior, window and fullscreen support, edit-mode restriction, Schema/find ownership, duplicate tab labeling, tests, and manual verification.
- Placeholder scan: No task contains unresolved placeholder tokens or an unbounded “add validation” instruction. Each code-changing task includes exact snippets and commands.
- Type consistency: The plan consistently uses `splitMode`, `activePaneId`, `splitRatio`, `panes`, `tabId`, `instanceId`, `viewState`, `primary`, `secondary`, `vertical` for left/right split, and `horizontal` for top/bottom split.
