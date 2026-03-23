import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const scriptPath = path.resolve("scripts/build-signed.ps1");

function runBuildSignedScript({ args = [], env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        ...args,
      ],
      {
        cwd: path.resolve("."),
        windowsHide: true,
        env: {
          ...process.env,
          ...env,
        },
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

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "dbsearch-build-signed-"));
  const keyPath = path.join(root, "dbsearch.key");
  const outputPath = path.join(root, "captured-key.txt");
  const outputPasswordPath = path.join(root, "captured-password.txt");

  await writeFile(keyPath, "fixture-private-key");

  return {
    root,
    keyPath,
    outputPath,
    outputPasswordPath,
  };
}

test("build-signed loads the signing key from disk when env is empty", async () => {
  const fixture = await createFixture();

  try {
    const result = await runBuildSignedScript({
      args: ["-KeyPath", fixture.keyPath, "-OutputEnvPath", fixture.outputPath],
      env: {
        TAURI_SIGNING_PRIVATE_KEY: "",
      },
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(await readFile(fixture.outputPath, "utf8"), "fixture-private-key");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("build-signed prefers an existing TAURI_SIGNING_PRIVATE_KEY env var", async () => {
  const fixture = await createFixture();

  try {
    const result = await runBuildSignedScript({
      args: ["-KeyPath", fixture.keyPath, "-OutputEnvPath", fixture.outputPath],
      env: {
        TAURI_SIGNING_PRIVATE_KEY: "from-env",
      },
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(await readFile(fixture.outputPath, "utf8"), "from-env");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("build-signed uses TAURI_SIGNING_PRIVATE_KEY_PASSWORD from env when provided", async () => {
  const fixture = await createFixture();

  try {
    const result = await runBuildSignedScript({
      args: [
        "-KeyPath",
        fixture.keyPath,
        "-OutputEnvPath",
        fixture.outputPath,
        "-OutputPasswordPath",
        fixture.outputPasswordPath,
      ],
      env: {
        TAURI_SIGNING_PRIVATE_KEY: "",
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "env-password",
      },
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(await readFile(fixture.outputPasswordPath, "utf8"), "env-password");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("build-signed reads the signing key password from a sidecar file when env is empty", async () => {
  const fixture = await createFixture();
  const passwordPath = `${fixture.keyPath}.password`;

  try {
    await writeFile(passwordPath, "file-password\n");

    const result = await runBuildSignedScript({
      args: [
        "-KeyPath",
        fixture.keyPath,
        "-OutputEnvPath",
        fixture.outputPath,
        "-OutputPasswordPath",
        fixture.outputPasswordPath,
      ],
      env: {
        TAURI_SIGNING_PRIVATE_KEY: "",
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
      },
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(await readFile(fixture.outputPasswordPath, "utf8"), "file-password");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("build-signed defaults to an empty password when no password file is configured", async () => {
  const fixture = await createFixture();

  try {
    const result = await runBuildSignedScript({
      args: [
        "-KeyPath",
        fixture.keyPath,
        "-OutputEnvPath",
        fixture.outputPath,
        "-OutputPasswordPath",
        fixture.outputPasswordPath,
      ],
      env: {
        TAURI_SIGNING_PRIVATE_KEY: "",
      },
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(await readFile(fixture.outputPasswordPath, "utf8"), "");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("build-signed fails with a clear error when no key is available", async () => {
  const fixture = await createFixture();
  const missingPath = path.join(fixture.root, "missing.key");

  try {
    const result = await runBuildSignedScript({
      args: ["-KeyPath", missingPath, "-OutputEnvPath", fixture.outputPath],
      env: {
        TAURI_SIGNING_PRIVATE_KEY: "",
      },
    });

    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Signing key not found/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("build-signed skips signing setup for help-style invocations", async () => {
  const fixture = await createFixture();
  const missingPath = path.join(fixture.root, "missing.key");

  try {
    const result = await runBuildSignedScript({
      args: ["-KeyPath", missingPath, "--help"],
      env: {
        TAURI_SIGNING_PRIVATE_KEY: "",
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
      },
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Build your app in release mode/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
