import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { assertReleaseVersionMatchesTag } from "./release-version-check.mjs";

const scriptPath = path.resolve("scripts/release-version-check.mjs");

async function createFixture({
  packageVersion = "4.4.8",
  cargoVersion = "4.4.8",
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "dbsearch-release-version-"));
  const packageJsonPath = path.join(root, "package.json");
  const cargoTomlPath = path.join(root, "Cargo.toml");

  await writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        name: "tauri-app",
        version: packageVersion,
      },
      null,
      2,
    ),
  );

  await writeFile(
    cargoTomlPath,
    `[package]
name = "tauri-app"
version = "${cargoVersion}"
description = "fixture"
`,
  );

  return {
    root,
    packageJsonPath,
    cargoTomlPath,
  };
}

test("assertReleaseVersionMatchesTag accepts matching tag and app versions", async () => {
  const fixture = await createFixture();

  try {
    await assert.doesNotReject(() => assertReleaseVersionMatchesTag({
      tagName: "v4.4.8",
      packageJsonPath: fixture.packageJsonPath,
      cargoTomlPath: fixture.cargoTomlPath,
    }));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("assertReleaseVersionMatchesTag rejects a mismatched package version", async () => {
  const fixture = await createFixture({ packageVersion: "4.4.7" });

  try {
    await assert.rejects(
      () => assertReleaseVersionMatchesTag({
        tagName: "v4.4.8",
        packageJsonPath: fixture.packageJsonPath,
        cargoTomlPath: fixture.cargoTomlPath,
      }),
      /package\.json version 4\.4\.7 does not match tag v4\.4\.8/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("assertReleaseVersionMatchesTag rejects a mismatched Cargo version", async () => {
  const fixture = await createFixture({ cargoVersion: "4.4.7" });

  try {
    await assert.rejects(
      () => assertReleaseVersionMatchesTag({
        tagName: "v4.4.8",
        packageJsonPath: fixture.packageJsonPath,
        cargoTomlPath: fixture.cargoTomlPath,
      }),
      /Cargo\.toml version 4\.4\.7 does not match tag v4\.4\.8/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("release-version-check CLI reports success when the tag matches", async () => {
  const fixture = await createFixture();

  try {
    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [scriptPath, "v4.4.8", fixture.packageJsonPath, fixture.cargoTomlPath],
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
        resolve({ code, stdout, stderr });
      });
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Release version verified: v4\.4\.8/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
