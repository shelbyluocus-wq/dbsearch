import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTargetExePath,
  findMatchingTauriProcesses,
  shouldCleanupBeforeLaunch,
} from "./tauri-wrapper-utils.mjs";

test("shouldCleanupBeforeLaunch only enables cleanup for tauri dev", () => {
  assert.equal(shouldCleanupBeforeLaunch(["dev"]), true);
  assert.equal(shouldCleanupBeforeLaunch(["build"]), false);
  assert.equal(shouldCleanupBeforeLaunch(["android", "dev"]), false);
  assert.equal(shouldCleanupBeforeLaunch([]), false);
});

test("buildTargetExePath points at this repo debug exe", () => {
  const result = buildTargetExePath("E:\\project\\dbsearch");
  assert.equal(
    result,
    "E:\\project\\dbsearch\\src-tauri\\target\\debug\\tauri-app.exe",
  );
});

test("findMatchingTauriProcesses only returns processes for the current workspace exe", () => {
  const targetPath = "E:\\project\\dbsearch\\src-tauri\\target\\debug\\tauri-app.exe";
  const records = [
    { ProcessId: 111, ExecutablePath: targetPath },
    { ProcessId: 222, ExecutablePath: "E:\\other\\app\\src-tauri\\target\\debug\\tauri-app.exe" },
    { ProcessId: 333, ExecutablePath: "e:\\PROJECT\\dbsearch\\src-tauri\\target\\debug\\tauri-app.exe" },
    { ProcessId: 444, ExecutablePath: null },
  ];

  assert.deepEqual(findMatchingTauriProcesses(records, targetPath), [
    { ProcessId: 111, ExecutablePath: targetPath },
    { ProcessId: 333, ExecutablePath: "e:\\PROJECT\\dbsearch\\src-tauri\\target\\debug\\tauri-app.exe" },
  ]);
});
