import test from "node:test";
import assert from "node:assert/strict";

import {
  applyImportedDbMigrationProfileDraft,
  DEFAULT_DB_MIGRATION_WINDOW_HOTKEY,
  appendDbMigrationTimeline,
  buildDbMigrationHeadline,
  createDbMigrationProfileDraft,
  describeDbMigrationProfile,
  extractDbMigrationJsonConfig,
  filterMigrationDatabaseNames,
  isDbMigrationProfileConnectionReady,
  isSameDbMigrationConnection,
  normalizeDbMigrationProfile,
  normalizeDbMigrationRememberedConnection,
  normalizeDbMigrationWorkspaceState,
  normalizeDbMigrationWindowHotkey,
  resolveDbMigrationProfileSelection,
  resolveDbMigrationSelections,
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

test("DEFAULT_DB_MIGRATION_WINDOW_HOTKEY falls back to Shift+D", () => {
  assert.equal(DEFAULT_DB_MIGRATION_WINDOW_HOTKEY, "Shift+D");
  assert.equal(normalizeDbMigrationWindowHotkey(""), "Shift+D");
  assert.equal(normalizeDbMigrationWindowHotkey("Shift"), "Shift+D");
  assert.equal(normalizeDbMigrationWindowHotkey("shift+d"), "Shift+D");
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

test("normalizeDbMigrationRememberedConnection trims persisted fields and drops incomplete values", () => {
  assert.deepEqual(
    normalizeDbMigrationRememberedConnection({
      host: " db.local ",
      port: "3308",
      username: " root ",
      password: "pw",
      source_database: " source_a ",
      target_database: " target_b ",
    }),
    {
      host: "db.local",
      port: 3308,
      username: "root",
      password: "pw",
      sourceDatabase: "source_a",
      targetDatabase: "target_b",
    },
  );

  assert.equal(
    normalizeDbMigrationRememberedConnection({
      host: "",
      username: "root",
    }),
    null,
  );
});

test("normalizeDbMigrationProfile trims fields and generates a readable default name", () => {
  assert.deepEqual(
    normalizeDbMigrationProfile({
      host: " db.local ",
      port: "3307",
      username: " root ",
      password: "pw",
      source_database: " source_a ",
      target_database: " target_b ",
    }, 0),
    {
      id: "db-migration-profile-1",
      name: "source_a -> target_b",
      host: "db.local",
      port: 3307,
      username: "root",
      password: "pw",
      sourceDatabase: "source_a",
      targetDatabase: "target_b",
    },
  );
});

test("normalizeDbMigrationWorkspaceState migrates a legacy remembered connection into the new profile list", () => {
  const state = normalizeDbMigrationWorkspaceState({
    profiles: [],
    lastUsedProfileId: "",
    rememberedConnection: {
      host: "db.local",
      port: 3306,
      username: "root",
      password: "pw",
      sourceDatabase: "source_a",
      targetDatabase: "target_b",
    },
  });

  assert.equal(state.profiles.length, 1);
  assert.equal(state.profiles[0].name, "source_a -> target_b");
  assert.equal(state.lastUsedProfileId, "db-migration-profile-1");
});

test("resolveDbMigrationProfileSelection prefers last used profile and falls back to the first profile", () => {
  const profiles = [
    { id: "profile-a" },
    { id: "profile-b" },
  ];

  assert.equal(
    resolveDbMigrationProfileSelection(profiles, { lastUsedProfileId: "profile-b" }),
    "profile-b",
  );
  assert.equal(
    resolveDbMigrationProfileSelection(profiles, { lastUsedProfileId: "missing" }),
    "profile-a",
  );
});

test("resolveDbMigrationSelections prefers remembered databases and falls back to visible options", () => {
  assert.deepEqual(
    resolveDbMigrationSelections(["alpha", "beta", "gamma"], {
      sourceDatabase: "gamma",
      targetDatabase: "missing",
    }),
    {
      sourceDatabase: "gamma",
      targetDatabase: "alpha",
    },
  );

  assert.deepEqual(
    resolveDbMigrationSelections(["alpha", "beta", "gamma"], {
      sourceDatabase: "missing",
      targetDatabase: "missing",
    }),
    {
      sourceDatabase: "alpha",
      targetDatabase: "beta",
    },
  );
});

test("extractDbMigrationJsonConfig supports nested db payloads, user alias, and source-target hints", () => {
  assert.deepEqual(
    extractDbMigrationJsonConfig({
      db: {
        host: "db.local",
        port: "3307",
        user: "root",
        password: "pw",
      },
      source_database: "source_a",
      targetDatabase: "target_b",
    }),
    {
      host: "db.local",
      port: 3307,
      username: "root",
      password: "pw",
      sourceDatabase: "source_a",
      targetDatabase: "target_b",
    },
  );

  assert.equal(
    extractDbMigrationJsonConfig({
      database: "app_main",
      username: "root",
    }),
    null,
  );
});

test("createDbMigrationProfileDraft turns imported JSON config into a named template with a fresh id", () => {
  const imported = extractDbMigrationJsonConfig({
    db: {
      host: "db.local",
      port: "3307",
      user: "root",
      password: "pw",
    },
    source_database: "source_a",
    targetDatabase: "target_b",
  });

  assert.deepEqual(
    createDbMigrationProfileDraft(
      [{ id: "db-migration-profile-1", name: "existing" }],
      imported,
    ),
    {
      id: "db-migration-profile-2",
      name: "source_a -> target_b",
      host: "db.local",
      port: 3307,
      username: "root",
      password: "pw",
      sourceDatabase: "source_a",
      targetDatabase: "target_b",
    },
  );
});

test("applyImportedDbMigrationProfileDraft keeps the current template identity while filling imported fields", () => {
  const imported = extractDbMigrationJsonConfig({
    db: {
      host: "db.local",
      port: "3307",
      user: "root",
      password: "pw",
    },
    source_database: "source_a",
    targetDatabase: "target_b",
  });

  assert.deepEqual(
    applyImportedDbMigrationProfileDraft({
      id: "profile-a",
      name: "现有模板",
      host: "old.local",
      port: 3306,
      username: "old",
      password: "oldpw",
      sourceDatabase: "old_source",
      targetDatabase: "old_target",
    }, imported),
    {
      id: "profile-a",
      name: "现有模板",
      host: "db.local",
      port: 3307,
      username: "root",
      password: "pw",
      sourceDatabase: "source_a",
      targetDatabase: "target_b",
    },
  );

  assert.deepEqual(
    applyImportedDbMigrationProfileDraft({
      id: "profile-b",
      name: " ",
    }, imported),
    {
      id: "profile-b",
      name: "source_a -> target_b",
      host: "db.local",
      port: 3307,
      username: "root",
      password: "pw",
      sourceDatabase: "source_a",
      targetDatabase: "target_b",
    },
  );
});

test("describeDbMigrationProfile prefers source-target text and falls back to host-port or incomplete state", () => {
  assert.equal(
    describeDbMigrationProfile({
      host: "db.local",
      port: 3307,
      username: "root",
      sourceDatabase: "source_a",
      targetDatabase: "target_b",
    }),
    "source_a -> target_b",
  );
  assert.equal(
    describeDbMigrationProfile({
      host: "db.local",
      port: 3307,
      username: "root",
    }),
    "db.local:3307",
  );
  assert.equal(describeDbMigrationProfile({}), "未完成配置");
});

test("connection helpers detect whether a template is connectable and whether two templates share credentials", () => {
  assert.equal(
    isDbMigrationProfileConnectionReady({
      host: "db.local",
      port: 3306,
      username: "root",
    }),
    true,
  );
  assert.equal(isDbMigrationProfileConnectionReady({ host: "db.local" }), false);
  assert.equal(
    isSameDbMigrationConnection(
      {
        host: "db.local",
        port: 3306,
        username: "root",
        password: "pw",
      },
      {
        host: " db.local ",
        port: "3306",
        username: " root ",
        password: "pw",
      },
    ),
    true,
  );
  assert.equal(
    isSameDbMigrationConnection(
      {
        host: "db.local",
        port: 3306,
        username: "root",
        password: "pw",
      },
      {
        host: "db.local",
        port: 3307,
        username: "root",
        password: "pw",
      },
    ),
    false,
  );
});
