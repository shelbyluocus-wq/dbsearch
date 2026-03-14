import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPanelTabs,
  normalizeBackgroundOpacity,
} from "./panelChrome.js";

test("buildPanelTabs merges starred and opened tables without duplicates", () => {
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
      starred: tab.starred,
      opened: tab.opened,
    })),
    [
      { tableName: "users", starred: true, opened: false },
      { tableName: "orders", starred: true, opened: true },
      { tableName: "audit_logs", starred: false, opened: true },
    ],
  );
});

test("buildPanelTabs keeps starred tables first and marks the active opened tab", () => {
  const tabs = buildPanelTabs({
    starredTables: ["users"],
    tableTabs: [
      { id: "tab-1", tableName: "users" },
      { id: "tab-2", tableName: "audit_logs" },
    ],
    activeTableTabId: "tab-2",
  });

  assert.equal(tabs[0].tableName, "users");
  assert.equal(tabs[0].active, false);
  assert.equal(tabs[1].tableName, "audit_logs");
  assert.equal(tabs[1].active, true);
});

test("normalizeBackgroundOpacity clamps values into the supported range", () => {
  assert.equal(normalizeBackgroundOpacity(undefined), 1);
  assert.equal(normalizeBackgroundOpacity("0.1"), 0.45);
  assert.equal(normalizeBackgroundOpacity(0.7), 0.7);
  assert.equal(normalizeBackgroundOpacity(1.5), 1);
});
