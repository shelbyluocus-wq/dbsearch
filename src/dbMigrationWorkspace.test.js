import test from "node:test";
import assert from "node:assert/strict";

import {
  FIXED_DB_MIGRATION_HOTKEY,
  appendDbMigrationTimeline,
  buildDbMigrationHeadline,
  filterMigrationDatabaseNames,
  shouldAutoExpandDbMigrationLog,
  shouldResetDbMigrationWorkspaceOnShow,
} from "./dbMigrationWorkspace.js";

test("filterMigrationDatabaseNames hides system databases and returns a sorted unique list", () => {
  assert.deepEqual(
    filterMigrationDatabaseNames([
      " app_main ",
      "mysql",
      "sys",
      "analytics",
      "information_schema",
      "analytics",
      "",
      "performance_schema",
      "zebra",
    ]),
    ["analytics", "app_main", "zebra"],
  );
});

test("appendDbMigrationTimeline appends normalized progress entries", () => {
  const timeline = appendDbMigrationTimeline([], {
    step: "backup_source",
    status: "running",
    message: "backing up source",
    timestamp: "2026-03-26T10:00:00.000Z",
  });

  const finished = appendDbMigrationTimeline(timeline, {
    step: "finish",
    status: "success",
    message: "done",
    detail: "all copied",
    timestamp: "2026-03-26T10:00:05.000Z",
  });

  assert.equal(finished.length, 2);
  assert.equal(finished[0].step, "backup_source");
  assert.equal(finished[0].status, "running");
  assert.equal(finished[1].step, "finish");
  assert.equal(finished[1].detail, "all copied");
});

test("shouldResetDbMigrationWorkspaceOnShow resets idle states but not running work", () => {
  assert.equal(shouldResetDbMigrationWorkspaceOnShow({ phase: "login", running: false }), true);
  assert.equal(shouldResetDbMigrationWorkspaceOnShow({ phase: "ready", running: false }), true);
  assert.equal(shouldResetDbMigrationWorkspaceOnShow({ phase: "finished", running: false }), true);
  assert.equal(shouldResetDbMigrationWorkspaceOnShow({ phase: "running", running: true }), false);
});

test("FIXED_DB_MIGRATION_HOTKEY is reserved as Shift+D", () => {
  assert.equal(FIXED_DB_MIGRATION_HOTKEY, "Shift+D");
});

test("buildDbMigrationHeadline stays compact and focuses on source-target selection", () => {
  assert.equal(
    buildDbMigrationHeadline({ sourceDatabase: "", targetDatabase: "" }),
    "选择源库和目标库",
  );
  assert.equal(
    buildDbMigrationHeadline({ sourceDatabase: "source_db", targetDatabase: "target_db" }),
    "source_db -> target_db",
  );
});

test("shouldAutoExpandDbMigrationLog keeps detailed logs collapsed by default", () => {
  assert.equal(shouldAutoExpandDbMigrationLog({ running: false, phase: "ready" }), false);
  assert.equal(shouldAutoExpandDbMigrationLog({ running: true, phase: "running" }), false);
  assert.equal(shouldAutoExpandDbMigrationLog({ running: false, phase: "finished" }), false);
});
