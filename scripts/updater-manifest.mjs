import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function selectWindowsReleaseAssets(assets = []) {
  const installerAsset = assets.find((asset) => {
    const name = String(asset?.name || "");
    return name.endsWith(".exe") && !name.endsWith(".exe.sig");
  });

  if (!installerAsset?.browser_download_url) {
    throw new Error("Could not find a Windows updater installer asset in the release.");
  }

  const signatureAsset = assets.find((asset) => {
    const name = String(asset?.name || "");
    return name.endsWith(".exe.sig");
  });

  if (!signatureAsset?.browser_download_url) {
    throw new Error("Could not find a Windows updater signature asset in the release.");
  }

  return {
    installerAsset,
    signatureAsset,
  };
}

export function buildWindowsUpdaterManifest({
  version,
  notes = "",
  pubDate,
  installerUrl,
  signature,
} = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || "").trim())) {
    throw new Error(`Invalid updater version '${version}'.`);
  }

  if (!installerUrl) {
    throw new Error("Missing Windows installer URL for updater manifest.");
  }

  if (!signature) {
    throw new Error("Missing Windows updater signature for updater manifest.");
  }

  return {
    version: String(version).trim(),
    notes: String(notes || "").trim(),
    pub_date: String(pubDate || new Date().toISOString()),
    platforms: {
      "windows-x86_64": {
        signature: String(signature).trim(),
        url: installerUrl,
      },
    },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const value = argv[index + 1];
    args[key] = value;
    index += 1;
  }
  return args;
}

async function fetchReleaseById({ repo, releaseId, token }) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseId}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "dbsearch-updater-manifest",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub release ${releaseId}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo;
  const releaseId = args["release-id"];
  const version = args.version;
  const signaturePath = args["signature-path"];
  const outputPath = args.output || path.resolve("latest.json");
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

  if (!repo || !releaseId || !version || !signaturePath) {
    throw new Error(
      "Usage: node scripts/updater-manifest.mjs --repo owner/repo --release-id 123 --version 4.4.9 --signature-path path\\to\\installer.exe.sig --output path\\to\\latest.json",
    );
  }

  const release = await fetchReleaseById({ repo, releaseId, token });
  const { installerAsset } = selectWindowsReleaseAssets(release.assets || []);
  const signature = (await readFile(signaturePath, "utf8")).trim();
  const manifest = buildWindowsUpdaterManifest({
    version,
    notes: release.body || "",
    pubDate: release.published_at || release.created_at,
    installerUrl: installerAsset.browser_download_url,
    signature,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Generated updater manifest at ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}
