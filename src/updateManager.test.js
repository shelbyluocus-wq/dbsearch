import test from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";

import {
  UPDATE_CHECK_MAX_ATTEMPTS,
  UPDATE_CHECK_TIMEOUT_MS,
  checkForUpdateWithRetry,
  normalizeUpdateSettings,
  buildPendingUpdateAnnouncement,
  normalizeUpdateAnnouncement,
  preserveOpaqueInstance,
  reduceUpdateDownloadProgress,
  resolvePostUpdateAnnouncement,
  resolveUpdateCheckPlan,
  shouldAutoRunStartupUpdateCheck,
  shouldOpenUpdateDialogForInstall,
  splitReleaseNotes,
  summarizeReleaseNotes,
} from "./updateManager.js";

test("update checks wait long enough for slow Gitee responses", () => {
  assert.equal(UPDATE_CHECK_TIMEOUT_MS, 120000);
});

test("update checks retry transient failures before giving up", async () => {
  assert.equal(UPDATE_CHECK_MAX_ATTEMPTS, 10);

  const attempts = [];
  const update = { version: "5.5.2" };
  const result = await checkForUpdateWithRetry(async (options) => {
    attempts.push(options);
    if (attempts.length < 3) {
      throw new Error("Gitee timeout");
    }
    return update;
  });

  assert.equal(result, update);
  assert.equal(attempts.length, 3);
  assert.deepEqual(
    attempts.map((options) => options.timeout),
    [UPDATE_CHECK_TIMEOUT_MS, UPDATE_CHECK_TIMEOUT_MS, UPDATE_CHECK_TIMEOUT_MS],
  );
});

test("update checks stop after the configured retry budget", async () => {
  const attempts = [];

  await assert.rejects(
    checkForUpdateWithRetry(async (options) => {
      attempts.push(options);
      throw new Error("Gitee still unavailable");
    }),
    /Gitee still unavailable/,
  );

  assert.equal(attempts.length, UPDATE_CHECK_MAX_ATTEMPTS);
});

test("normalizeUpdateSettings defaults auto checks on and drops invalid timestamps", () => {
  const settings = normalizeUpdateSettings({
    auto_check_updates: undefined,
    last_update_check_at: "not-a-date",
  });

  assert.equal(settings.autoCheckUpdates, true);
  assert.equal(settings.lastUpdateCheckAt, null);
});

test("resolveUpdateCheckPlan performs the first startup check immediately", () => {
  const plan = resolveUpdateCheckPlan({
    settings: normalizeUpdateSettings({
      auto_check_updates: true,
      last_update_check_at: null,
    }),
    now: "2026-03-20T08:00:00.000Z",
    manual: false,
  });

  assert.equal(plan.shouldCheck, true);
  assert.equal(plan.reason, "startup-due");
  assert.equal(plan.checkedAt, "2026-03-20T08:00:00.000Z");
});

test("resolveUpdateCheckPlan still checks on startup even inside the former cooldown window", () => {
  const plan = resolveUpdateCheckPlan({
    settings: normalizeUpdateSettings({
      auto_check_updates: true,
      last_update_check_at: "2026-03-20T04:30:00.000Z",
    }),
    now: "2026-03-20T08:00:00.000Z",
    manual: false,
  });

  assert.equal(plan.shouldCheck, true);
  assert.equal(plan.reason, "startup-due");
  assert.equal(plan.checkedAt, "2026-03-20T08:00:00.000Z");
});

test("resolveUpdateCheckPlan keeps startup checks due after older timestamps too", () => {
  const plan = resolveUpdateCheckPlan({
    settings: normalizeUpdateSettings({
      auto_check_updates: true,
      last_update_check_at: "2026-03-19T18:59:59.000Z",
    }),
    now: "2026-03-20T08:00:00.000Z",
    manual: false,
  });

  assert.equal(plan.shouldCheck, true);
  assert.equal(plan.reason, "startup-due");
});

test("resolveUpdateCheckPlan lets manual checks bypass the cooldown and disabled auto-checks", () => {
  const plan = resolveUpdateCheckPlan({
    settings: normalizeUpdateSettings({
      auto_check_updates: false,
      last_update_check_at: "2026-03-20T07:59:00.000Z",
    }),
    now: "2026-03-20T08:00:00.000Z",
    manual: true,
  });

  assert.equal(plan.shouldCheck, true);
  assert.equal(plan.reason, "manual");
  assert.equal(plan.checkedAt, "2026-03-20T08:00:00.000Z");
});

test("shouldAutoRunStartupUpdateCheck only runs on the main Tauri window", () => {
  assert.equal(
    shouldAutoRunStartupUpdateCheck({
      isTauriWindow: true,
      windowLabel: "main",
    }),
    true,
  );

  assert.equal(
    shouldAutoRunStartupUpdateCheck({
      isTauriWindow: true,
      windowLabel: "panel",
    }),
    false,
  );

  assert.equal(
    shouldAutoRunStartupUpdateCheck({
      isTauriWindow: true,
      windowLabel: "sync_workspace",
    }),
    false,
  );

  assert.equal(
    shouldAutoRunStartupUpdateCheck({
      isTauriWindow: false,
      windowLabel: "browser",
    }),
    false,
  );
});

test("startup pet update install opens the update dialog for visible progress", () => {
  assert.equal(
    shouldOpenUpdateDialogForInstall({
      manual: false,
      isPanelWindow: false,
      userConfirmedInstall: true,
    }),
    true,
  );
});

test("preserveOpaqueInstance keeps private-field class instances callable after storing in a ref", () => {
  class DemoUpdateHandle {
    #value = 42;

    read() {
      return this.#value;
    }
  }

  const holder = ref(null);
  holder.value = preserveOpaqueInstance(new DemoUpdateHandle());

  assert.equal(holder.value.read(), 42);
});

test("summarizeReleaseNotes keeps the first meaningful lines and truncates long content", () => {
  const summary = summarizeReleaseNotes(`

  修复了自动连接数据库的启动异常。

  优化了表格搜索体验。
  增加了快捷键配置校验。
  `.repeat(8));

  assert.match(summary, /修复了自动连接数据库/);
  assert.match(summary, /优化了表格搜索体验/);
  assert.match(summary, /\.\.\.$/);
});

test("reduceUpdateDownloadProgress tracks total bytes and completion state", () => {
  let state = reduceUpdateDownloadProgress(undefined, {
    event: "Started",
    data: { contentLength: 100 },
  });

  assert.deepEqual(state, {
    status: "downloading",
    downloadedBytes: 0,
    totalBytes: 100,
    percent: 0,
  });

  state = reduceUpdateDownloadProgress(state, {
    event: "Progress",
    data: { chunkLength: 40 },
  });
  state = reduceUpdateDownloadProgress(state, {
    event: "Progress",
    data: { chunkLength: 60 },
  });

  assert.equal(state.status, "downloading");
  assert.equal(state.downloadedBytes, 100);
  assert.equal(state.totalBytes, 100);
  assert.equal(state.percent, 100);

  state = reduceUpdateDownloadProgress(state, { event: "Finished" });

  assert.deepEqual(state, {
    status: "finished",
    downloadedBytes: 100,
    totalBytes: 100,
    percent: 100,
  });
});

test("buildPendingUpdateAnnouncement keeps full release notes for the next launch", () => {
  const announcement = buildPendingUpdateAnnouncement({
    version: "v5.5.0",
    date: "2026-04-28T08:30:00Z",
    body: "1. 新增更新后首启公告\n2. 优化自动更新体验",
  });

  assert.deepEqual(announcement, {
    version: "5.5.0",
    notes: "1. 新增更新后首启公告\n2. 优化自动更新体验",
    pubDate: "2026-04-28T08:30:00.000Z",
  });
});

test("normalizeUpdateAnnouncement accepts raw manifest-style fields", () => {
  const announcement = normalizeUpdateAnnouncement({
    version: " v5.5.1 ",
    notes: "  修复已知问题  ",
    pub_date: "2026-04-28T10:00:00Z",
  });

  assert.deepEqual(announcement, {
    version: "5.5.1",
    notes: "修复已知问题",
    pubDate: "2026-04-28T10:00:00.000Z",
  });
});

test("splitReleaseNotes preserves meaningful note lines and supplies an empty fallback", () => {
  assert.deepEqual(
    splitReleaseNotes("\n1. 新增首启公告\n\n2. 修复下载失败提示\n"),
    ["1. 新增首启公告", "2. 修复下载失败提示"],
  );
  assert.deepEqual(splitReleaseNotes(""), ["本次更新未提供详细说明。"]);
});

test("resolvePostUpdateAnnouncement shows pending notes once for the installed version", () => {
  const announcement = resolvePostUpdateAnnouncement({
    currentVersion: "5.5.0",
    acknowledgedVersion: "5.4.0",
    pendingAnnouncement: {
      version: "v5.5.0",
      notes: "1. 新增更新公告\n2. 修复自动更新重启提示",
      pub_date: "2026-04-28T08:30:00Z",
    },
  });

  assert.deepEqual(announcement, {
    version: "5.5.0",
    notes: "1. 新增更新公告\n2. 修复自动更新重启提示",
    notesLines: ["1. 新增更新公告", "2. 修复自动更新重启提示"],
    pubDate: "2026-04-28T08:30:00.000Z",
  });
});

test("resolvePostUpdateAnnouncement skips stale or already acknowledged announcements", () => {
  assert.equal(
    resolvePostUpdateAnnouncement({
      currentVersion: "5.5.0",
      acknowledgedVersion: "5.5.0",
      pendingAnnouncement: {
        version: "5.5.0",
        notes: "已看过",
      },
    }),
    null,
  );

  assert.equal(
    resolvePostUpdateAnnouncement({
      currentVersion: "5.5.0",
      acknowledgedVersion: "5.4.0",
      pendingAnnouncement: {
        version: "5.4.9",
        notes: "旧版本说明",
      },
    }),
    null,
  );
});
