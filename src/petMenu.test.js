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

test("runPetMenuAction file_sync opens the sync workspace and then hides the pet menu", async () => {
  const calls = [];

  await runPetMenuAction("file_sync", {
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

test("runPetMenuAction db_sync opens the db migration workspace and then hides the pet menu", async () => {
  const calls = [];

  await runPetMenuAction("db_sync", {
    isTauriWindow: true,
    invoke: async (command) => {
      calls.push(`invoke:${command}`);
    },
    getWindowByLabel: async () => null,
    setPetHiddenForSession: () => {},
  });

  assert.deepEqual(calls, [
    "invoke:toggle_db_migration_window",
    "invoke:hide_pet_menu",
  ]);
});
