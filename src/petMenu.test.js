import test from "node:test";
import assert from "node:assert/strict";

import { runPetMenuAction } from "./petMenu.js";

test("runPetMenuAction hides the pet window and marks the session hidden", async () => {
  const calls = [];
  let hiddenForSession = false;
  const mainWindow = {
    async hide() {
      calls.push("main.hide");
    },
  };

  await runPetMenuAction("hide_pet", {
    isTauriWindow: true,
    invoke: async (command) => {
      calls.push(`invoke:${command}`);
    },
    getWindowByLabel: async (label) => {
      calls.push(`getWindowByLabel:${label}`);
      return label === "main" ? mainWindow : null;
    },
    setPetHiddenForSession: (value) => {
      hiddenForSession = value;
      calls.push(`setHidden:${value}`);
    },
  });

  assert.equal(hiddenForSession, true);
  assert.deepEqual(calls, [
    "setHidden:true",
    "invoke:hide_pet_window",
    "getWindowByLabel:main",
    "main.hide",
    "invoke:hide_pet_menu",
  ]);
});

test("runPetMenuAction still hides the menu when the backend hide command fails", async () => {
  const calls = [];
  let hiddenForSession = false;
  const mainWindow = {
    async hide() {
      calls.push("main.hide");
    },
  };

  await runPetMenuAction("hide_pet", {
    isTauriWindow: true,
    invoke: async (command) => {
      calls.push(`invoke:${command}`);
      if (command === "hide_pet_window") {
        throw new Error("backend hide failed");
      }
    },
    getWindowByLabel: async (label) => {
      calls.push(`getWindowByLabel:${label}`);
      return label === "main" ? mainWindow : null;
    },
    setPetHiddenForSession: (value) => {
      hiddenForSession = value;
      calls.push(`setHidden:${value}`);
    },
  });

  assert.equal(hiddenForSession, true);
  assert.deepEqual(calls, [
    "setHidden:true",
    "invoke:hide_pet_window",
    "getWindowByLabel:main",
    "main.hide",
    "invoke:hide_pet_menu",
  ]);
});

test("runPetMenuAction sync_center opens the unified sync workspace and then hides the pet menu", async () => {
  const calls = [];

  await runPetMenuAction("sync_center", {
    isTauriWindow: true,
    invoke: async (command) => {
      calls.push(`invoke:${command}`);
    },
    getWindowByLabel: async () => null,
    setPetHiddenForSession: () => {},
  });

  assert.deepEqual(calls, [
    "invoke:toggle_sync_workspace_window",
    "invoke:hide_pet_menu",
  ]);
});

test("runPetMenuAction legacy sync actions still open the unified sync workspace", async () => {
  const calls = [];

  for (const action of ["file_sync", "db_sync"]) {
    await runPetMenuAction(action, {
      isTauriWindow: true,
      invoke: async (command) => {
        calls.push(`${action}:${command}`);
      },
      getWindowByLabel: async () => null,
      setPetHiddenForSession: () => {},
    });
  }

  assert.deepEqual(calls, [
    "file_sync:toggle_sync_workspace_window",
    "file_sync:hide_pet_menu",
    "db_sync:toggle_sync_workspace_window",
    "db_sync:hide_pet_menu",
  ]);
});
