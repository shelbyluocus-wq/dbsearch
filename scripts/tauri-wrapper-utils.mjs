import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function shouldCleanupBeforeLaunch(args) {
  return Array.isArray(args) && args[0] === "dev";
}

export function buildTargetExePath(projectRoot) {
  return path.join(projectRoot, "src-tauri", "target", "debug", "tauri-app.exe");
}

export function normalizeWindowsPath(filePath) {
  return String(filePath || "").replaceAll("/", "\\").toLowerCase();
}

export function findMatchingTauriProcesses(records, targetPath) {
  const normalizedTargetPath = normalizeWindowsPath(targetPath);

  return (records || []).filter((record) => {
    if (!record?.ExecutablePath || !record?.ProcessId) {
      return false;
    }

    return normalizeWindowsPath(record.ExecutablePath) === normalizedTargetPath;
  });
}

function parseProcessRecords(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function listTauriProcesses() {
  const command = "Get-CimInstance Win32_Process -Filter \"Name = 'tauri-app.exe'\" | Select-Object ProcessId, ExecutablePath | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { windowsHide: true },
  );

  return parseProcessRecords(stdout);
}

export async function killProcesses(processIds) {
  const ids = [...new Set((processIds || []).filter(Boolean))];
  if (ids.length === 0) {
    return;
  }

  const command = `Stop-Process -Id ${ids.join(",")} -Force`;
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { windowsHide: true },
  );
}

export async function cleanupStaleTauriProcesses(projectRoot) {
  const targetPath = buildTargetExePath(projectRoot);
  const processes = await listTauriProcesses();
  const matches = findMatchingTauriProcesses(processes, targetPath);

  if (matches.length === 0) {
    return { targetPath, killed: [] };
  }

  await killProcesses(matches.map((process) => process.ProcessId));
  return { targetPath, killed: matches };
}
