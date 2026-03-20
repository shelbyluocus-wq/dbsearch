import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const projectRoot = path.resolve(currentDir, "..");

function main() {
  const [relativeScriptPath, ...scriptArgs] = process.argv.slice(2);

  if (!relativeScriptPath) {
    console.error("[run-powershell-script] missing script path");
    process.exit(1);
  }

  const scriptPath = path.resolve(projectRoot, relativeScriptPath);
  const child = spawn(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...scriptArgs],
    {
      cwd: projectRoot,
      stdio: "inherit",
    },
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error("[run-powershell-script] failed to start PowerShell:", error.message);
    process.exit(1);
  });
}

main();
