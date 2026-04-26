import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSyncCenterMode,
  normalizeSyncCenterSidebarCollapsed,
  normalizeSyncCenterSidebarWidth,
  resolveSyncCenterSectionToggle,
  shouldShowSyncCenterLogDrawer,
} from "./syncCenter.js";

test("normalizeSyncCenterMode keeps file and database tabs inside the unified page", () => {
  assert.equal(normalizeSyncCenterMode("file"), "file");
  assert.equal(normalizeSyncCenterMode("file_sync"), "file");
  assert.equal(normalizeSyncCenterMode("database"), "database");
  assert.equal(normalizeSyncCenterMode("db_sync"), "database");
  assert.equal(normalizeSyncCenterMode("missing"), "file");
});

test("shouldShowSyncCenterLogDrawer opens for manual intent or active execution", () => {
  assert.equal(shouldShowSyncCenterLogDrawer({ manualOpen: false, running: false }), false);
  assert.equal(shouldShowSyncCenterLogDrawer({ manualOpen: true, running: false }), true);
  assert.equal(shouldShowSyncCenterLogDrawer({ manualOpen: false, running: true }), true);
});

test("normalizeSyncCenterSidebarWidth clamps the adjustable sidebar width", () => {
  assert.equal(normalizeSyncCenterSidebarWidth("bad"), 320);
  assert.equal(normalizeSyncCenterSidebarWidth(120), 280);
  assert.equal(normalizeSyncCenterSidebarWidth(360.6), 361);
  assert.equal(normalizeSyncCenterSidebarWidth(800), 460);
});

test("normalizeSyncCenterSidebarCollapsed restores the persisted sidebar state", () => {
  assert.equal(normalizeSyncCenterSidebarCollapsed("1"), true);
  assert.equal(normalizeSyncCenterSidebarCollapsed("true"), true);
  assert.equal(normalizeSyncCenterSidebarCollapsed(true), true);
  assert.equal(normalizeSyncCenterSidebarCollapsed("0"), false);
  assert.equal(normalizeSyncCenterSidebarCollapsed(null), false);
});

test("resolveSyncCenterSectionToggle switches modes without collapsing the newly selected section", () => {
  assert.deepEqual(
    resolveSyncCenterSectionToggle("database", "file", { database: true, file: false }),
    {
      mode: "database",
      collapsed: { database: false, file: false },
    },
  );
  assert.deepEqual(
    resolveSyncCenterSectionToggle("database", "database", { database: false, file: false }),
    {
      mode: "database",
      collapsed: { database: true, file: false },
    },
  );
});
