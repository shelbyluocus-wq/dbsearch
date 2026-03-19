import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { cleanupStaleTauriProcesses, shouldCleanupBeforeLaunch } from "./tauri-wrapper-utils.mjs";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const projectRoot = path.resolve(currentDir, "..");

async function main() {
  const args = process.argv.slice(2);

  if (process.platform === "win32" && shouldCleanupBeforeLaunch(args)) {
    const result = await cleanupStaleTauriProcesses(projectRoot);
    if (result.killed.length > 0) {
      const ids = result.killed.map((process) => process.ProcessId).join(", ");
      console.log(`[tauri-wrapper] terminated stale tauri-app.exe process(es): ${ids}`);
    }
  }

  const tauriEntrypoint = path.join(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");

  const child = spawn(process.execPath, [tauriEntrypoint, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error("[tauri-wrapper] failed to start Tauri CLI:", error.message);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error("[tauri-wrapper] startup failed:", error.message);
  process.exit(1);
});
