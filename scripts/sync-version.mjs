import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { formatAppDisplayTitle } from "../src/appIdentity.js";

const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function normalizeVersion(version) {
  const normalized = String(version || "").trim();
  if (!PACKAGE_VERSION_PATTERN.test(normalized)) {
    throw new Error(`Invalid package.json version '${version}'.`);
  }
  return normalized;
}

export function syncCargoTomlVersion(content, version) {
  const normalizedVersion = normalizeVersion(version);
  const packageSectionMatch = content.match(/\[package\]([\s\S]*?)(?:\n\[|$)/);
  if (!packageSectionMatch) {
    throw new Error("Could not locate the [package] section in Cargo.toml.");
  }

  const packageSection = packageSectionMatch[0];
  if (!/^\s*version\s*=\s*"[^"]+"\s*$/m.test(packageSection)) {
    throw new Error("Could not locate the package version entry in Cargo.toml.");
  }

  return content.replace(
    /\[package\]([\s\S]*?)(?:\n\[|$)/,
    (matchedSection) => matchedSection.replace(
      /^\s*version\s*=\s*"[^"]+"\s*$/m,
      `version = "${normalizedVersion}"`,
    ),
  );
}

export function syncTauriConfigContent(content, version) {
  const normalizedVersion = normalizeVersion(version);
  const config = JSON.parse(content);
  config.version = "../package.json";

  const mainWindow = Array.isArray(config?.app?.windows)
    ? config.app.windows.find((window) => String(window?.label || "") === "main") || config.app.windows[0]
    : null;

  if (!mainWindow) {
    throw new Error("Could not locate the main window entry in tauri.conf.json.");
  }

  mainWindow.title = formatAppDisplayTitle(normalizedVersion);
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function syncProjectVersion({
  projectRoot = path.resolve("."),
  packageJsonPath = path.resolve(projectRoot, "package.json"),
  cargoTomlPath = path.resolve(projectRoot, "src-tauri/Cargo.toml"),
  tauriConfigPath = path.resolve(projectRoot, "src-tauri/tauri.conf.json"),
} = {}) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const version = normalizeVersion(packageJson?.version);
  const cargoTomlContent = await readFile(cargoTomlPath, "utf8");
  const tauriConfigContent = await readFile(tauriConfigPath, "utf8");

  const nextCargoTomlContent = syncCargoTomlVersion(cargoTomlContent, version);
  const nextTauriConfigContent = syncTauriConfigContent(tauriConfigContent, version);

  const changedFiles = [];

  if (nextCargoTomlContent !== cargoTomlContent) {
    await writeFile(cargoTomlPath, nextCargoTomlContent);
    changedFiles.push(path.relative(projectRoot, cargoTomlPath));
  }

  if (nextTauriConfigContent !== tauriConfigContent) {
    await writeFile(tauriConfigPath, nextTauriConfigContent);
    changedFiles.push(path.relative(projectRoot, tauriConfigPath));
  }

  return {
    version,
    changedFiles,
    displayTitle: formatAppDisplayTitle(version),
  };
}

async function main() {
  try {
    const result = await syncProjectVersion();
    if (result.changedFiles.length === 0) {
      console.log(`[sync-version] version ${result.version} already synced.`);
      return;
    }

    console.log(
      `[sync-version] synced version ${result.version} -> ${result.changedFiles.join(", ")}`,
    );
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
