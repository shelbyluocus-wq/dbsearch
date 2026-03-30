import test from "node:test";
import assert from "node:assert/strict";

import * as syncWorkspace from "./syncWorkspace.js";
import {
  describeSyncProfileCard,
  normalizeSyncWorkspaceSettings,
  reduceSyncTimeline,
  resolveSyncTargetDirectoryOpenRequest,
  resolveSyncProfileSelection,
} from "./syncWorkspace.js";

test("normalizeSyncWorkspaceSettings falls back to Shift+D and preserves stored profiles", () => {
  const settings = normalizeSyncWorkspaceSettings({
    sync_window_hotkey: "",
    sync_profiles: [
      {
        id: "profile-a",
        name: "客户端配置",
        script_executable_path: "C:/tools/export.exe",
        output_root: "C:/exports",
        target_path: "D:/project/client",
      },
    ],
  });

  assert.equal(settings.syncWindowHotkey, "Shift+D");
  assert.equal(settings.profiles.length, 1);
  assert.equal(settings.profiles[0].name, "客户端配置");
});

test("resolveSyncProfileSelection prefers last used profile, then default, then first profile", () => {
  const profiles = [
    { id: "profile-a", name: "A" },
    { id: "profile-b", name: "B" },
  ];

  assert.equal(
    resolveSyncProfileSelection(profiles, {
      lastUsedProfileId: "profile-b",
      defaultProfileId: "profile-a",
    }),
    "profile-b",
  );

  assert.equal(
    resolveSyncProfileSelection(profiles, {
      lastUsedProfileId: "missing",
      defaultProfileId: "profile-a",
    }),
    "profile-a",
  );

  assert.equal(resolveSyncProfileSelection(profiles, {}), "profile-a");
});

test("describeSyncProfileCard builds a compact accordion summary", () => {
  const summary = describeSyncProfileCard(
    {
      id: "profile-a",
      name: "客户端配置",
      target_path: "D:/project/client",
      last_run_status: "success",
      last_run_summary: "已同步 2 个目录",
    },
    { defaultProfileId: "profile-a" },
  );

  assert.match(summary, /默认配置/);
  assert.match(summary, /上次成功/);
  assert.match(summary, /已同步 2 个目录/);
  assert.match(summary, /D:\/project\/client/);
});

test("reduceSyncTimeline tracks step transitions from running to failure", () => {
  const timeline = reduceSyncTimeline([], {
    step: "validate",
    status: "running",
    message: "正在校验路径",
    timestamp: "2026-03-15T08:00:00.000Z",
  });

  const finished = reduceSyncTimeline(timeline, {
    step: "svn_update",
    status: "error",
    message: "SVN 更新失败",
    detail: "Summary of conflicts",
    timestamp: "2026-03-15T08:00:03.000Z",
  });

  assert.equal(finished[0].step, "validate");
  assert.equal(finished[0].status, "running");
  assert.equal(finished[1].step, "svn_update");
  assert.equal(finished[1].status, "error");
  assert.equal(finished[1].detail, "Summary of conflicts");
});

test("resolveSyncTargetDirectoryOpenRequest keeps the full directory path and uses backend explorer command", () => {
  assert.deepEqual(
    resolveSyncTargetDirectoryOpenRequest("D:\\Versions\\nzg"),
    {
      method: "invoke",
      command: "open_directory_in_explorer",
      path: "D:\\Versions\\nzg",
    },
  );

  assert.deepEqual(
    resolveSyncTargetDirectoryOpenRequest("D:/Versions/nzg"),
    {
      method: "invoke",
      command: "open_directory_in_explorer",
      path: "D:/Versions/nzg",
    },
  );
});

test("buildHotkeyFromEvent normalizes shifted punctuation to the base symbol", () => {
  assert.equal(typeof syncWorkspace.buildHotkeyFromEvent, "function");
  assert.equal(typeof syncWorkspace.isEventMatchingHotkey, "function");

  const event = {
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    key: "?",
    code: "Slash",
  };

  assert.equal(syncWorkspace.buildHotkeyFromEvent(event), "Ctrl+/");
  assert.equal(syncWorkspace.isEventMatchingHotkey(event, "Ctrl+/"), true);
  assert.equal(syncWorkspace.isEventMatchingHotkey(event, "Ctrl+?"), true);
});

test("normalizeHotkeyDisplay standardizes punctuation aliases", () => {
  assert.equal(typeof syncWorkspace.normalizeHotkeyDisplay, "function");
  assert.equal(syncWorkspace.normalizeHotkeyDisplay("ctrl+?"), "Ctrl+/");
  assert.equal(syncWorkspace.normalizeHotkeyDisplay("ctrl+shift+_"), "Ctrl+Shift+-");
  assert.equal(syncWorkspace.normalizeHotkeyDisplay("ctrl+meta+plus"), "Ctrl+Meta+=");
});

test("appendTimelineByProfile keeps sync logs isolated per profile", () => {
  assert.equal(typeof syncWorkspace.appendTimelineByProfile, "function");
  assert.equal(typeof syncWorkspace.getTimelineForProfile, "function");

  let cache = syncWorkspace.appendTimelineByProfile({}, {
    profileId: "profile-a",
    step: "validate",
    status: "running",
    message: "validate a",
    timestamp: "2026-03-16T01:00:00.000Z",
  });
  cache = syncWorkspace.appendTimelineByProfile(cache, {
    profileId: "profile-b",
    step: "launch_tool",
    status: "running",
    message: "run b",
    timestamp: "2026-03-16T01:00:02.000Z",
  });
  cache = syncWorkspace.appendTimelineByProfile(cache, {
    profileId: "profile-a",
    step: "finish",
    status: "success",
    message: "done a",
    timestamp: "2026-03-16T01:00:03.000Z",
  });

  assert.deepEqual(
    syncWorkspace.getTimelineForProfile(cache, "profile-a").map((entry) => entry.message),
    ["validate a", "done a"],
  );
  assert.deepEqual(
    syncWorkspace.getTimelineForProfile(cache, "profile-b").map((entry) => entry.message),
    ["run b"],
  );
  assert.deepEqual(syncWorkspace.getTimelineForProfile(cache, "missing"), []);
});
