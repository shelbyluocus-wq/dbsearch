import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const scriptPath = path.resolve("scripts/release.ps1");
const wrapperPath = path.resolve("scripts/run-powershell-script.mjs");

function runReleaseScript({ version, packageJsonPath, cargoTomlPath }) {
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
  const cargoTomlPath = path.join(root, "Cargo.toml");

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
    cargoTomlPath,
    `[package]
name = "tauri-app"
version = "4.4.0"
description = "fixture"

[dependencies]
tauri = "2"
`,
  );

  return {
    root,
    packageJsonPath,
    cargoTomlPath,
  };
}

test("release script syncs package and cargo versions", async () => {
  const fixture = await createReleaseFixture();

  try {
    const result = await runReleaseScript({
      version: "4.4.1",
      packageJsonPath: fixture.packageJsonPath,
      cargoTomlPath: fixture.cargoTomlPath,
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);

    const packageJson = JSON.parse(await readFile(fixture.packageJsonPath, "utf8"));
    const cargoToml = await readFile(fixture.cargoTomlPath, "utf8");

    assert.equal(packageJson.version, "4.4.1");
    assert.match(cargoToml, /^version = "4\.4\.1"$/m);
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
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);

    const packageJson = JSON.parse(await readFile(fixture.packageJsonPath, "utf8"));
    const cargoToml = await readFile(fixture.cargoTomlPath, "utf8");

    assert.equal(packageJson.version, "4.4.7");
    assert.match(cargoToml, /^version = "4\.4\.7"$/m);
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
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
    assert.equal(packageJson.version, "4.4.0");
  } finally {
    await rm(outsideCwd, { recursive: true, force: true });
  }
});
