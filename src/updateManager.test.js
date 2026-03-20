import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeUpdateSettings,
  reduceUpdateDownloadProgress,
  resolveUpdateCheckPlan,
  summarizeReleaseNotes,
  UPDATE_CHECK_INTERVAL_MS,
} from "./updateManager.js";

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

test("resolveUpdateCheckPlan throttles startup checks inside the cooldown window", () => {
  const plan = resolveUpdateCheckPlan({
    settings: normalizeUpdateSettings({
      auto_check_updates: true,
      last_update_check_at: "2026-03-20T04:30:00.000Z",
    }),
    now: "2026-03-20T08:00:00.000Z",
    manual: false,
  });

  assert.equal(plan.shouldCheck, false);
  assert.equal(plan.reason, "startup-throttled");
  assert.equal(plan.checkedAt, null);
  assert.equal(plan.intervalMs, UPDATE_CHECK_INTERVAL_MS);
});

test("resolveUpdateCheckPlan allows startup checks again once the cooldown expires", () => {
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
