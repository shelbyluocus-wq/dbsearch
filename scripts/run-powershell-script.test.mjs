import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const wrapperPath = path.resolve("scripts/run-powershell-script.mjs");

function runWrapper({ scriptPath, args = [], cwd }) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [wrapperPath, scriptPath, ...args],
      {
        cwd,
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
}

test("run-powershell-script resolves the target script from the repo root instead of cwd", async () => {
  const outsideCwd = await mkdtemp(path.join(tmpdir(), "dbsearch-wrapper-cwd-"));
  const outputPath = path.join(outsideCwd, "wrapper-output.txt");
  const fixtureScriptRelativePath = "scripts/test-write-output.ps1";
  const fixtureScriptAbsolutePath = path.resolve(fixtureScriptRelativePath);

  try {
    await writeFile(
      fixtureScriptAbsolutePath,
      `param([string]$OutputPath)\nSet-Content -LiteralPath $OutputPath -Value 'wrapper-ok' -NoNewline\n`,
    );

    const result = await runWrapper({
      scriptPath: fixtureScriptRelativePath,
      args: [outputPath],
      cwd: outsideCwd,
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(await readFile(outputPath, "utf8"), "wrapper-ok");
  } finally {
    await rm(fixtureScriptAbsolutePath, { force: true });
    await rm(outsideCwd, { recursive: true, force: true });
  }
});
