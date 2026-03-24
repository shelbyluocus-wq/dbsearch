import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function normalizeReleaseVersionTag(tagName) {
  const raw = String(tagName || "").trim();
  if (!raw) {
    throw new Error("Missing release tag. Use a tag like v4.4.9.");
  }

  const normalized = raw.startsWith("v") ? raw.slice(1) : raw;
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Invalid release tag '${tagName}'. Use v4.4.9 or 4.4.9.`);
  }

  return normalized;
}

async function readPackageJsonVersion(packageJsonPath) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const version = String(packageJson?.version || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Could not read a valid version from ${packageJsonPath}.`);
  }
  return version;
}

async function readCargoTomlVersion(cargoTomlPath) {
  const content = await readFile(cargoTomlPath, "utf8");
  const packageSectionMatch = content.match(/\[package\]([\s\S]*?)(?:\n\[|$)/);
  const packageSection = packageSectionMatch?.[1] ?? "";
  const versionMatch = packageSection.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  const version = String(versionMatch?.[1] || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Could not read a valid [package] version from ${cargoTomlPath}.`);
  }
  return version;
}

export async function assertReleaseVersionMatchesTag({
  tagName,
  packageJsonPath = path.resolve("package.json"),
  cargoTomlPath = path.resolve("src-tauri/Cargo.toml"),
} = {}) {
  const normalizedTagVersion = normalizeReleaseVersionTag(tagName);
  const packageVersion = await readPackageJsonVersion(packageJsonPath);
  const cargoVersion = await readCargoTomlVersion(cargoTomlPath);

  if (packageVersion !== normalizedTagVersion) {
    throw new Error(
      `package.json version ${packageVersion} does not match tag v${normalizedTagVersion}.`,
    );
  }

  if (cargoVersion !== normalizedTagVersion) {
    throw new Error(
      `Cargo.toml version ${cargoVersion} does not match tag v${normalizedTagVersion}.`,
    );
  }

  return normalizedTagVersion;
}

async function main() {
  const tagName = process.argv[2];
  const packageJsonPath = process.argv[3] || path.resolve("package.json");
  const cargoTomlPath = process.argv[4] || path.resolve("src-tauri/Cargo.toml");

  try {
    const version = await assertReleaseVersionMatchesTag({
      tagName,
      packageJsonPath,
      cargoTomlPath,
    });
    console.log(`Release version verified: v${version}`);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
