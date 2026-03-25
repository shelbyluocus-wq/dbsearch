import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const scriptPath = path.resolve("scripts/release.ps1");
const wrapperPath = path.resolve("scripts/run-powershell-script.mjs");

function runReleaseScript({ version, packageJsonPath, cargoTomlPath, tauriConfigPath }) {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        version,
        packageJsonPath,
        cargoTomlPath,
        tauriConfigPath,
      ],
      {
        cwd: path.resolve("."),
        windowsHide: true,
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}

async function createReleaseFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "dbsearch-release-"));
  const packageJsonPath = path.join(root, "package.json");
  const packageLockPath = path.join(root, "package-lock.json");
  const cargoTomlPath = path.join(root, "Cargo.toml");
  const cargoLockPath = path.join(root, "Cargo.lock");
  const tauriConfigPath = path.join(root, "tauri.conf.json");

  await writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        name: "tauri-app",
        version: "4.4.0",
      },
      null,
      2,
    ),
  );

  await writeFile(
    packageLockPath,
    JSON.stringify(
      {
        name: "tauri-app",
        version: "4.4.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": {
            name: "tauri-app",
            version: "4.4.0",
          },
          "node_modules/@tauri-apps/api": {
            version: "2.10.1",
          },
          "node_modules/vite": {
            version: "6.4.1",
          },
        },
      },
      null,
      2,
    ),
  );

  await writeFile(
    cargoTomlPath,
    `[package]
name = "tauri-app"
version = "4.4.0"
description = "fixture"

[dependencies]
tauri = "2"
`,
  );

  await writeFile(
    cargoLockPath,
    `[[package]]
name = "tauri-app"
version = "4.4.0"
dependencies = []

[[package]]
name = "other-crate"
version = "1.0.0"
dependencies = []
`,
  );

  await writeFile(
    tauriConfigPath,
    JSON.stringify(
      {
        productName: "鹰捷",
        app: {
          windows: [
            {
              label: "main",
              title: "鹰捷V4.4.0",
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  return {
    root,
    packageJsonPath,
    packageLockPath,
    cargoTomlPath,
    cargoLockPath,
    tauriConfigPath,
  };
}

test("release script syncs versions while keeping a stable install product name", async () => {
  const fixture = await createReleaseFixture();

  try {
    const result = await runReleaseScript({
      version: "4.4.1",
      packageJsonPath: fixture.packageJsonPath,
      cargoTomlPath: fixture.cargoTomlPath,
      tauriConfigPath: fixture.tauriConfigPath,
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);

    const packageJson = JSON.parse(await readFile(fixture.packageJsonPath, "utf8"));
    const packageLock = JSON.parse(await readFile(fixture.packageLockPath, "utf8"));
    const cargoToml = await readFile(fixture.cargoTomlPath, "utf8");
    const cargoLock = await readFile(fixture.cargoLockPath, "utf8");
    const tauriConfig = JSON.parse(await readFile(fixture.tauriConfigPath, "utf8"));

    assert.equal(packageJson.version, "4.4.1");
    assert.equal(packageLock.version, "4.4.1");
    assert.equal(packageLock.packages[""].version, "4.4.1");
    assert.equal(packageLock.packages["node_modules/@tauri-apps/api"].version, "2.10.1");
    assert.equal(packageLock.packages["node_modules/vite"].version, "6.4.1");
    assert.match(cargoToml, /^version = "4\.4\.1"$/m);
    assert.match(cargoLock, /\[\[package\]\]\s+name = "tauri-app"\s+version = "4\.4\.1"/m);
    assert.equal(tauriConfig.productName, "鹰捷");
    assert.equal(tauriConfig.app.windows[0].title, "鹰捷V4.4.1");
    assert.match(result.stdout, /4\.4\.1/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("release script accepts tags with a leading v", async () => {
  const fixture = await createReleaseFixture();

  try {
    const result = await runReleaseScript({
      version: "v4.4.7",
      packageJsonPath: fixture.packageJsonPath,
      cargoTomlPath: fixture.cargoTomlPath,
      tauriConfigPath: fixture.tauriConfigPath,
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);

    const packageJson = JSON.parse(await readFile(fixture.packageJsonPath, "utf8"));
    const cargoToml = await readFile(fixture.cargoTomlPath, "utf8");
    const tauriConfig = JSON.parse(await readFile(fixture.tauriConfigPath, "utf8"));

    assert.equal(packageJson.version, "4.4.7");
    assert.match(cargoToml, /^version = "4\.4\.7"$/m);
    assert.equal(tauriConfig.productName, "鹰捷");
    assert.equal(tauriConfig.app.windows[0].title, "鹰捷V4.4.7");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("release script is safe to rerun with the same version", async () => {
  const fixture = await createReleaseFixture();

  try {
    const firstRun = await runReleaseScript({
      version: "4.4.5",
      packageJsonPath: fixture.packageJsonPath,
      cargoTomlPath: fixture.cargoTomlPath,
      tauriConfigPath: fixture.tauriConfigPath,
    });

    assert.equal(firstRun.code, 0, firstRun.stderr || firstRun.stdout);

    const secondRun = await runReleaseScript({
      version: "4.4.5",
      packageJsonPath: fixture.packageJsonPath,
      cargoTomlPath: fixture.cargoTomlPath,
      tauriConfigPath: fixture.tauriConfigPath,
    });

    assert.equal(secondRun.code, 0, secondRun.stderr || secondRun.stdout);

    const packageLock = JSON.parse(await readFile(fixture.packageLockPath, "utf8"));
    const tauriConfig = JSON.parse(await readFile(fixture.tauriConfigPath, "utf8"));
    assert.equal(packageLock.version, "4.4.5");
    assert.equal(packageLock.packages[""].version, "4.4.5");
    assert.equal(packageLock.packages["node_modules/@tauri-apps/api"].version, "2.10.1");
    assert.equal(tauriConfig.productName, "鹰捷");
    assert.equal(tauriConfig.app.windows[0].title, "鹰捷V4.4.5");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("release script rejects invalid versions without changing files", async () => {
  const fixture = await createReleaseFixture();

  try {
    const originalPackageJson = await readFile(fixture.packageJsonPath, "utf8");
    const originalCargoToml = await readFile(fixture.cargoTomlPath, "utf8");

    const result = await runReleaseScript({
      version: "v4..2",
      packageJsonPath: fixture.packageJsonPath,
      cargoTomlPath: fixture.cargoTomlPath,
      tauriConfigPath: fixture.tauriConfigPath,
    });

    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /x\.y\.z/i);
    assert.equal(await readFile(fixture.packageJsonPath, "utf8"), originalPackageJson);
    assert.equal(await readFile(fixture.cargoTomlPath, "utf8"), originalCargoToml);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("release script resolves repo default paths when launched through the wrapper from another cwd", async () => {
  const outsideCwd = await mkdtemp(path.join(tmpdir(), "dbsearch-release-cwd-"));
  const repoPackageJsonPath = path.resolve("package.json");
  const repoPackageLockPath = path.resolve("package-lock.json");
  const repoCargoTomlPath = path.resolve("src-tauri/Cargo.toml");
  const repoCargoLockPath = path.resolve("src-tauri/Cargo.lock");
  const repoTauriConfigPath = path.resolve("src-tauri/tauri.conf.json");
  const originalPackageJson = await readFile(repoPackageJsonPath, "utf8");
  const originalPackageLock = await readFile(repoPackageLockPath, "utf8");
  const originalCargoToml = await readFile(repoCargoTomlPath, "utf8");
  const originalCargoLock = await readFile(repoCargoLockPath, "utf8");
  const originalTauriConfig = await readFile(repoTauriConfigPath, "utf8");

  try {
    const child = spawn(
      process.execPath,
      [wrapperPath, "scripts/release.ps1", "4.4.0"],
      {
        cwd: outsideCwd,
        windowsHide: true,
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const code = await new Promise((resolve) => {
      child.on("close", resolve);
    });

    assert.equal(code, 0, stderr || stdout);
    const packageJson = JSON.parse(await readFile(repoPackageJsonPath, "utf8"));
    const tauriConfig = JSON.parse(await readFile(repoTauriConfigPath, "utf8"));
    assert.equal(packageJson.version, "4.4.0");
    assert.equal(tauriConfig.productName, "鹰捷");
  } finally {
    await writeFile(repoPackageJsonPath, originalPackageJson);
    await writeFile(repoPackageLockPath, originalPackageLock);
    await writeFile(repoCargoTomlPath, originalCargoToml);
    await writeFile(repoCargoLockPath, originalCargoLock);
    await writeFile(repoTauriConfigPath, originalTauriConfig);
    await rm(outsideCwd, { recursive: true, force: true });
  }
});
