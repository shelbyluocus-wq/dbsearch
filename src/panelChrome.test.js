import test from "node:test";
import assert from "node:assert/strict";

import * as panelChrome from "./panelChrome.js";
import {
  buildFavoritesMenuItems,
  buildPanelTabs,
  describeTableFolderChip,
  findHighlightRanges,
  getDefaultTableDialogState,
  buildTableDialogClasses,
  resolveTableFullscreenButtonLabel,
  getTableSortMeta,
  normalizeBackgroundOpacity,
  resolvePanelActivatedFocusTarget,
  resolveTableDialogSurfaceMode,
  resolveNextTableSortMode,
  resolveTableDialogKeyAction,
  shouldClearArmedTableDialogShortcutAfterAction,
  shouldBypassEditableGuardForArmedTableDialogKey,
  shouldFocusPanelShellFromTitlebarPointerDown,
  shouldEnablePanelTabDrag,
  shouldShowTitlebarDbSwitcher,
  shouldShowOrgToolbar,
  shouldShowPanelTabStrip,
} from "./panelChrome.js";

test("buildPanelTabs keeps only opened tabs in the titlebar while preserving star markers", () => {
  const tabs = buildPanelTabs({
    starredTables: ["users", "orders"],
    tableTabs: [
      { id: "tab-1", tableName: "orders" },
      { id: "tab-2", tableName: "audit_logs" },
    ],
    activeTableTabId: "tab-2",
  });

  assert.deepEqual(
    tabs.map((tab) => ({
      tableName: tab.tableName,
      kind: tab.kind,
      starred: tab.starred,
      opened: tab.opened,
    })),
    [
      { tableName: "orders", kind: "opened", starred: true, opened: true },
      { tableName: "audit_logs", kind: "opened", starred: false, opened: true },
    ],
  );
});

test("buildPanelTabs marks the active opened tab from the live tab order", () => {
  const tabs = buildPanelTabs({
    starredTables: ["users"],
    tableTabs: [
      { id: "tab-1", tableName: "users" },
      { id: "tab-2", tableName: "audit_logs" },
    ],
    activeTableTabId: "tab-2",
  });

  assert.equal(tabs[0].tableName, "users");
  assert.equal(tabs[0].kind, "opened");
  assert.equal(tabs[0].active, false);
  assert.equal(tabs[1].tableName, "audit_logs");
  assert.equal(tabs[1].kind, "opened");
  assert.equal(tabs[1].active, true);
});

test("buildPanelTabs keeps opened tabs in live order without appending closed starred tabs", () => {
  const tabs = buildPanelTabs({
    starredTables: ["users", "orders", "reports"],
    tableTabs: [
      { id: "tab-2", tableName: "orders" },
      { id: "tab-3", tableName: "audit_logs" },
      { id: "tab-1", tableName: "users" },
    ],
    activeTableTabId: "tab-1",
  });

  assert.deepEqual(
    tabs.map((tab) => ({
      tableName: tab.tableName,
      kind: tab.kind,
      tabId: tab.tabId,
      draggable: tab.draggable,
      active: tab.active,
      starred: tab.starred,
      opened: tab.opened,
    })),
    [
      {
        tableName: "orders",
        kind: "opened",
        tabId: "tab-2",
        draggable: true,
        active: false,
        starred: true,
        opened: true,
      },
      {
        tableName: "audit_logs",
        kind: "opened",
        tabId: "tab-3",
        draggable: true,
        active: false,
        starred: false,
        opened: true,
      },
      {
        tableName: "users",
        kind: "opened",
        tabId: "tab-1",
        draggable: true,
        active: true,
        starred: true,
        opened: true,
      },
    ],
  );
});

test("getTableSortMeta normalizes invalid sort modes to the default name ascending state", () => {
  assert.deepEqual(getTableSortMeta("comment_desc"), {
    column: "comment",
    direction: "desc",
  });
  assert.deepEqual(getTableSortMeta("weird"), {
    column: "name",
    direction: "asc",
  });
});

test("resolveNextTableSortMode switches columns to ascending first, then toggles direction", () => {
  assert.equal(resolveNextTableSortMode("name_asc", "name"), "name_desc");
  assert.equal(resolveNextTableSortMode("name_desc", "name"), "name_asc");
  assert.equal(resolveNextTableSortMode("name_desc", "comment"), "comment_asc");
  assert.equal(resolveNextTableSortMode("comment_asc", "comment"), "comment_desc");
});

test("buildFavoritesMenuItems returns the starred entry first and then valid folders", () => {
  assert.deepEqual(
    buildFavoritesMenuItems({
      starredTables: ["users", "orders"],
      tableFolders: [
        { id: "folder-a", name: "核心", tables: ["users"] },
        { id: "folder-b", name: "报表", tables: ["orders", "invoices"] },
        { id: "", name: "ignored", tables: ["noop"] },
      ],
      activeFolder: "folder-b",
    }),
    [
      {
        key: "starred",
        kind: "starred",
        id: "starred",
        label: "星标",
        tableCount: 2,
        active: false,
      },
      {
        key: "folder:folder-a",
        kind: "folder",
        id: "folder-a",
        label: "核心",
        tableCount: 1,
        active: false,
      },
      {
        key: "folder:folder-b",
        kind: "folder",
        id: "folder-b",
        label: "报表",
        tableCount: 2,
        active: true,
      },
    ],
  );
});

test("shouldShowPanelTabStrip keeps recent/opened shelves visible without a live connection when there is content", () => {
  assert.equal(
    shouldShowPanelTabStrip({
      dbConnected: false,
      panelTabsCount: 1,
      recentTablesCount: 0,
    }),
    true,
  );

  assert.equal(
    shouldShowPanelTabStrip({
      dbConnected: false,
      panelTabsCount: 0,
      recentTablesCount: 2,
    }),
    true,
  );

  assert.equal(
    shouldShowPanelTabStrip({
      dbConnected: false,
      panelTabsCount: 0,
      recentTablesCount: 0,
    }),
    false,
  );
});

test("shouldEnablePanelTabDrag turns on reordering whenever there are opened draggable tabs", () => {
  assert.equal(
    shouldEnablePanelTabDrag({
      panelTabs: [
        { tabId: "tab-1", draggable: true },
        { tabId: "", draggable: false },
      ],
    }),
    true,
  );
});

test("shouldEnablePanelTabDrag stays off when the titlebar only has non-draggable items", () => {
  assert.equal(
    shouldEnablePanelTabDrag({
      panelTabs: [
        { tabId: "", draggable: false },
        { tabId: null, draggable: false },
      ],
    }),
    false,
  );
});

test("shouldShowTitlebarDbSwitcher keeps the titlebar switcher visible when connected", () => {
  assert.equal(
    shouldShowTitlebarDbSwitcher({
      dbConnected: true,
      templateCount: 0,
    }),
    true,
  );
});

test("shouldShowTitlebarDbSwitcher keeps the titlebar switcher visible when saved templates exist", () => {
  assert.equal(
    shouldShowTitlebarDbSwitcher({
      dbConnected: false,
      templateCount: 2,
    }),
    true,
  );
});

test("shouldShowTitlebarDbSwitcher hides the titlebar switcher when disconnected without templates", () => {
  assert.equal(
    shouldShowTitlebarDbSwitcher({
      dbConnected: false,
      templateCount: 0,
    }),
    false,
  );
});

test("shouldShowOrgToolbar keeps starred and folder chips visible without a live connection when there is saved content", () => {
  assert.equal(
    shouldShowOrgToolbar({
      dbConnected: false,
      starredCount: 1,
      folderCount: 0,
    }),
    true,
  );

  assert.equal(
    shouldShowOrgToolbar({
      dbConnected: false,
      starredCount: 0,
      folderCount: 1,
    }),
    true,
  );

  assert.equal(
    shouldShowOrgToolbar({
      dbConnected: false,
      starredCount: 0,
      folderCount: 0,
    }),
    false,
  );
});

test("getDefaultTableDialogState keeps backdrop close disabled and leaves fullscreen opt-in", () => {
  assert.deepEqual(getDefaultTableDialogState(), {
    fullscreen: false,
    backdropClosable: false,
  });
});

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

test("resolveTableFullscreenButtonLabel keeps the previous label during transitions", () => {
  assert.equal(
    resolveTableFullscreenButtonLabel({ fullscreen: true, transitioning: true, previousFullscreen: false }),
    "全屏查看(W)",
  );

  assert.equal(
    resolveTableFullscreenButtonLabel({ fullscreen: false, transitioning: true, previousFullscreen: true }),
    "退出全屏(W)",
  );
});

test("resolveTableFullscreenButtonLabel follows stable fullscreen state", () => {
  assert.equal(
    resolveTableFullscreenButtonLabel({ fullscreen: false, transitioning: false, previousFullscreen: false }),
    "全屏查看(W)",
  );

  assert.equal(
    resolveTableFullscreenButtonLabel({ fullscreen: true, transitioning: false, previousFullscreen: false }),
    "退出全屏(W)",
  );
});

test("styles.css makes table fullscreen an Excel-like data-first layout", async () => {
  const { readFile } = await import("node:fs/promises");
  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.table-modal\.fullscreen \.schema-box/);
  assert.match(styles, /\.table-modal\.fullscreen \.data-box > \.section-head/);
  assert.match(styles, /display:\s*none !important/);
  assert.match(styles, /\.modal-title-row > \.table-title-action-btn:not\(\.table-title-find-btn\)/);
  assert.match(styles, /\.table-modal\.fullscreen \.fullscreen-freeze-toolbar/);
  assert.doesNotMatch(styles, /\.table-modal\.fullscreen \.table-find-bar,\n/);
  assert.match(styles, /\.table-modal\.fullscreen \.table-find-bar\s*\{/);
  assert.match(styles, /\.table-modal\.fullscreen \.data-head\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /\.table-modal\.fullscreen \.fullscreen-row-range/);
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");
  assert.doesNotMatch(appVue, /class="table-title-action-btn fullscreen-hit-jump-btn"/);
  assert.match(appVue, /class="fullscreen-freeze-toolbar freeze-toolbar"/);
  assert.match(styles, /align-items:\s*center/);
  assert.match(styles, /\.table-modal\.fullscreen \.grid-wrap\s*\{[^}]*margin-top:\s*0/s);
});

test("resolveTableDialogSurfaceMode makes table dialogs fill panel windows without an overlay backdrop", () => {
  assert.deepEqual(
    resolveTableDialogSurfaceMode({
      isPanelWindow: true,
    }),
    {
      fillHostWindow: true,
      muteBackdrop: true,
    },
  );
});

test("resolveTableDialogSurfaceMode keeps the floating overlay presentation outside panel windows", () => {
  assert.deepEqual(
    resolveTableDialogSurfaceMode({
      isPanelWindow: false,
    }),
    {
      fillHostWindow: false,
      muteBackdrop: false,
    },
  );
});

test("resolvePanelActivatedFocusTarget keeps focus on the table surface while a table dialog is open", () => {
  assert.equal(
    resolvePanelActivatedFocusTarget({
      isPanelWindow: true,
      tableOpen: true,
    }),
    "table",
  );

  assert.equal(
    resolvePanelActivatedFocusTarget({
      isPanelWindow: true,
      tableOpen: false,
    }),
    "keyword",
  );

  assert.equal(
    resolvePanelActivatedFocusTarget({
      isPanelWindow: false,
      tableOpen: true,
    }),
    "none",
  );
});

test("normalizeBackgroundOpacity clamps values into the supported range", () => {
  assert.equal(normalizeBackgroundOpacity(undefined), 1);
  assert.equal(normalizeBackgroundOpacity("0.1"), 0.75);
  assert.equal(normalizeBackgroundOpacity(0.7), 0.75);
  assert.equal(normalizeBackgroundOpacity(1.5), 1);
});

test("describeTableFolderChip hides the badge when no folder contains the table", () => {
  const chip = describeTableFolderChip("users", []);

  assert.deepEqual(chip, {
    label: "",
    extraCount: 0,
    title: "",
    visible: false,
    uncategorized: true,
    folders: [],
  });
});

test("describeTableFolderChip returns the first folder label when the table belongs to one folder", () => {
  const chip = describeTableFolderChip("users", [
    { id: "folder-a", name: "core", tables: ["users", "orders"] },
    { id: "folder-b", name: "reports", tables: ["reports"] },
  ]);

  assert.deepEqual(chip, {
    label: "core",
    extraCount: 0,
    title: "core",
    visible: true,
    uncategorized: false,
    folders: ["core"],
  });
});

test("describeTableFolderChip exposes the first folder and overflow count when the table belongs to many folders", () => {
  const chip = describeTableFolderChip("users", [
    { id: "folder-a", name: "core", tables: ["users"] },
    { id: "folder-b", name: "account", tables: ["users", "roles"] },
    { id: "folder-c", name: "archive", tables: ["logs", "users"] },
  ]);

  assert.deepEqual(chip, {
    label: "core",
    extraCount: 2,
    title: "core · account · archive",
    visible: true,
    uncategorized: false,
    folders: ["core", "account", "archive"],
  });
});

test("rankTableSearchCandidates reuses fuzzy acronym scoring for abbreviated table lookups", () => {
  assert.equal(typeof panelChrome.rankTableSearchCandidates, "function");

  const ranked = panelChrome.rankTableSearchCandidates("gdp", [
    { table_name: "group_detail_profile", table_comment: "group profile details" },
    { table_name: "goodsprop", table_comment: "goods property table" },
    { table_name: "gold_deposit_pool", table_comment: "deposit pool" },
  ]);

  assert.equal(ranked[0].table_name, "goodsprop");
  assert.deepEqual(
    ranked.map((item) => item.table_name),
    ["goodsprop", "gold_deposit_pool", "group_detail_profile"],
  );
});

test("rankTableSearchCandidates ranks exact equality above all other matches", () => {
  const ranked = panelChrome.rankTableSearchCandidates("heroprop", [
    { table_name: "guideheroshowprop", table_comment: "Y-引导-默认英雄立绘" },
    { table_name: "heroartfactforgeprop", table_comment: "Y-英雄-专武锻注配" },
    { table_name: "heroprop", table_comment: "Y-英雄-召唤物属性" },
    { table_name: "herocallerprop", table_comment: "Y-英雄-召唤物属性" },
    { table_name: "herocommprop", table_comment: "Y-英雄-英雄基础公" },
    { table_name: "heroequipprop", table_comment: "Y-英雄-英雄职业装" },
  ]);

  // 精确匹配必须排第一
  assert.equal(ranked[0].table_name, "heroprop");

  // 包含完整 "heroprop" 子串的中间匹配应排在只有前缀模糊匹配的之前
  const guideIdx = ranked.findIndex((r) => r.table_name === "guideheroshowprop");
  const forgeIdx = ranked.findIndex((r) => r.table_name === "heroartfactforgeprop");
  assert.ok(guideIdx < forgeIdx, "mid-string contiguous should rank above fuzzy-only");

  // 精确匹配必须排在所有其他匹配之前
  const exactIdx = ranked.findIndex((r) => r.table_name === "heroprop");
  assert.ok(exactIdx === 0, "exact match should be rank #0");
});

test("findHighlightRanges marks contiguous matches for full keyword hits", () => {
  const ranges = findHighlightRanges("goodsprop", ["good"]);

  assert.deepEqual(ranges, [{ start: 0, end: 4 }]);
});

test("findHighlightRanges marks fuzzy acronym letters in table names", () => {
  const ranges = findHighlightRanges("goodsprop", ["gdp"]);

  assert.deepEqual(ranges, [
    { start: 0, end: 1 },
    { start: 3, end: 4 },
    { start: 5, end: 6 },
  ]);
});

test("findHighlightRanges marks fuzzy acronym letters in comments", () => {
  const ranges = findHighlightRanges("goods detail profile config", ["gdp"]);

  assert.deepEqual(ranges, [
    { start: 0, end: 1 },
    { start: 3, end: 4 },
    { start: 13, end: 14 },
  ]);
});

test("findHighlightRanges handles case-insensitive matches and repeated letters", () => {
  const ranges = findHighlightRanges("GoodsDepositPool", ["gdp"]);

  assert.deepEqual(ranges, [
    { start: 0, end: 1 },
    { start: 3, end: 4 },
    { start: 7, end: 8 },
  ]);
});

test("findHighlightRanges returns empty ranges when nothing matches", () => {
  assert.deepEqual(findHighlightRanges("orders", ["xyz"]), []);
});

test("resolveTableDialogKeyAction uses W for fullscreen and preserves close shortcuts", () => {
  assert.equal(
    resolveTableDialogKeyAction({
      key: "w",
      code: "KeyW",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      tableOpen: true,
      settingsOpen: false,
      isEditable: false,
    }),
    "toggleFullscreen",
  );

  assert.equal(
    resolveTableDialogKeyAction({
      key: "w",
      code: "KeyW",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      tableOpen: true,
      settingsOpen: false,
      isEditable: false,
    }),
    "closeTable",
  );

  assert.equal(
    resolveTableDialogKeyAction({
      key: "w",
      code: "KeyW",
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      tableOpen: true,
      settingsOpen: false,
      isEditable: false,
    }),
    "closeAllTables",
  );

  assert.equal(
    resolveTableDialogKeyAction({
      key: "w",
      code: "KeyW",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      tableOpen: true,
      settingsOpen: false,
      isEditable: true,
    }),
    "none",
  );

  assert.equal(
    resolveTableDialogKeyAction({
      key: "Process",
      code: "KeyW",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      tableOpen: true,
      settingsOpen: false,
      isEditable: false,
    }),
    "toggleFullscreen",
  );
});

test("shouldFocusPanelShellFromTitlebarPointerDown only reacts to primary non-interactive titlebar clicks", () => {
  assert.equal(
    shouldFocusPanelShellFromTitlebarPointerDown({
      button: 0,
      interactiveTarget: false,
    }),
    true,
  );

  assert.equal(
    shouldFocusPanelShellFromTitlebarPointerDown({
      button: 0,
      interactiveTarget: true,
    }),
    false,
  );

  assert.equal(
    shouldFocusPanelShellFromTitlebarPointerDown({
      button: 1,
      interactiveTarget: false,
    }),
    false,
  );
});

test("shouldBypassEditableGuardForArmedTableDialogKey only unlocks W shortcuts after a titlebar click", () => {
  assert.equal(
    shouldBypassEditableGuardForArmedTableDialogKey({
      key: "w",
      code: "KeyW",
      armed: true,
    }),
    true,
  );

  assert.equal(
    shouldBypassEditableGuardForArmedTableDialogKey({
      key: "W",
      code: "KeyW",
      armed: true,
    }),
    true,
  );

  assert.equal(
    shouldBypassEditableGuardForArmedTableDialogKey({
      key: "Process",
      code: "KeyW",
      armed: true,
    }),
    true,
  );

  assert.equal(
    shouldBypassEditableGuardForArmedTableDialogKey({
      key: "q",
      code: "KeyQ",
      armed: true,
    }),
    false,
  );

  assert.equal(
    shouldBypassEditableGuardForArmedTableDialogKey({
      key: "w",
      code: "KeyW",
      armed: false,
    }),
    false,
  );
});

test("shouldClearArmedTableDialogShortcutAfterAction keeps fullscreen toggles armed for the next W", () => {
  assert.equal(
    shouldClearArmedTableDialogShortcutAfterAction("toggleFullscreen"),
    false,
  );

  assert.equal(
    shouldClearArmedTableDialogShortcutAfterAction("closeTable"),
    true,
  );

  assert.equal(
    shouldClearArmedTableDialogShortcutAfterAction("closeAllTables"),
    true,
  );

  assert.equal(
    shouldClearArmedTableDialogShortcutAfterAction("none"),
    false,
  );
});

test("shouldUseReducedTransparencyMode excludes settings surfaces but enables other windows", () => {
  assert.equal(typeof panelChrome.shouldUseReducedTransparencyMode, "function");
  assert.equal(
    panelChrome.shouldUseReducedTransparencyMode({
      reduceTransparency: true,
      isSettingsSurface: false,
      windowLabel: "panel",
    }),
    true,
  );
  assert.equal(
    panelChrome.shouldUseReducedTransparencyMode({
      reduceTransparency: true,
      isSettingsSurface: true,
      windowLabel: "panel",
    }),
    false,
  );
  assert.equal(
    panelChrome.shouldUseReducedTransparencyMode({
      reduceTransparency: false,
      isSettingsSurface: false,
      windowLabel: "pet_menu",
    }),
    false,
  );
});
