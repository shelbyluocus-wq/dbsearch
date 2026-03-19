import test from "node:test";
import assert from "node:assert/strict";

import * as panelChrome from "./panelChrome.js";
import {
  buildPanelTabs,
  describeTableFolderChip,
  findHighlightRanges,
  normalizeBackgroundOpacity,
  resolveTableDialogKeyAction,
} from "./panelChrome.js";

test("buildPanelTabs de-duplicates starred tables and appends closed starred tabs after opened tabs", () => {
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
      { tableName: "users", kind: "starred-closed", starred: true, opened: false },
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

test("buildPanelTabs keeps opened tabs in live order and appends closed starred tabs", () => {
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
      {
        tableName: "reports",
        kind: "starred-closed",
        tabId: "",
        draggable: false,
        active: false,
        starred: true,
        opened: false,
      },
    ],
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
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      tableOpen: true,
      settingsOpen: false,
      isEditable: true,
    }),
    "none",
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
