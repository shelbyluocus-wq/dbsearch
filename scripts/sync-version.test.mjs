import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  syncCargoTomlVersion,
  syncProjectVersion,
  syncTauriConfigContent,
} from "./sync-version.mjs";

const scriptPath = path.resolve("scripts/sync-version.mjs");

test("syncCargoTomlVersion only updates the package version field", () => {
  const cargoToml = `[package]
name = "tauri-app"
version = "4.4.8"

[dependencies]
some-lib = "4.4.8"
`;

  const result = syncCargoTomlVersion(cargoToml, "5.0.0");

  assert.match(result, /version = "5\.0\.0"/);
  assert.match(result, /some-lib = "4\.4\.8"/);
});

test("syncTauriConfigContent keeps tauri version pointed at package.json and refreshes the title", () => {
  const config = {
    productName: "鹰捷",
    version: "4.4.8",
    app: {
      windows: [
        {
          label: "main",
          title: "鹰捷V4.4.8",
        },
      ],
    },
  };

  const result = JSON.parse(syncTauriConfigContent(JSON.stringify(config), "5.0.0"));

  assert.equal(result.version, "../package.json");
  assert.equal(result.app.windows[0].title, "鹰捷V5.0.0");
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "dbsearch-sync-version-"));
  await mkdir(path.join(root, "src-tauri"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "tauri-app",
        version: "5.0.0",
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(root, "src-tauri/Cargo.toml"),
    `[package]
name = "tauri-app"
version = "4.4.8"
description = "fixture"
`,
  );

  await writeFile(
    path.join(root, "src-tauri/tauri.conf.json"),
    JSON.stringify(
      {
        productName: "鹰捷",
        version: "4.4.8",
        app: {
          windows: [
            {
              label: "main",
              title: "鹰捷V4.4.8",
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  return root;
}

test("syncProjectVersion updates Cargo.toml and tauri.conf.json from package.json", async () => {
  const root = await createFixture();

  try {
    const result = await syncProjectVersion({ projectRoot: root });
    const cargoToml = await readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8");
    const tauriConfig = JSON.parse(await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));

    assert.equal(result.version, "5.0.0");
    assert.deepEqual(
      result.changedFiles.sort(),
      [path.join("src-tauri", "Cargo.toml"), path.join("src-tauri", "tauri.conf.json")],
    );
    assert.match(cargoToml, /version = "5\.0\.0"/);
    assert.equal(tauriConfig.version, "../package.json");
    assert.equal(tauriConfig.app.windows[0].title, "鹰捷V5.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sync-version CLI exits successfully when the workspace is synced", async () => {
  const root = await createFixture();

  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath], {
        cwd: root,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[sync-version\] synced version 5\.0\.0/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
