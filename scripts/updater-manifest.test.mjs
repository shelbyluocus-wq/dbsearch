import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWindowsUpdaterManifest,
  selectWindowsReleaseAssets,
} from "./updater-manifest.mjs";

test("selectWindowsReleaseAssets picks the installer and signature assets from a release", () => {
  const assets = selectWindowsReleaseAssets([
    {
      name: "db-scout-4.4.8-windows-x64-setup.exe",
      browser_download_url: "https://example.com/setup.exe",
    },
    {
      name: "db-scout-4.4.8-windows-x64-setup.exe.sig",
      browser_download_url: "https://example.com/setup.exe.sig",
    },
    {
      name: "Source code (zip)",
      browser_download_url: "https://example.com/source.zip",
    },
  ]);

  assert.deepEqual(assets, {
    installerAsset: {
      name: "db-scout-4.4.8-windows-x64-setup.exe",
      browser_download_url: "https://example.com/setup.exe",
    },
    signatureAsset: {
      name: "db-scout-4.4.8-windows-x64-setup.exe.sig",
      browser_download_url: "https://example.com/setup.exe.sig",
    },
  });
});

test("buildWindowsUpdaterManifest returns the static JSON structure required by Tauri", () => {
  const manifest = buildWindowsUpdaterManifest({
    version: "4.4.8",
    notes: "修复自动更新链路",
    pubDate: "2026-03-23T13:40:04Z",
    installerUrl: "https://example.com/setup.exe",
    signature: "signature-value",
  });

  assert.deepEqual(manifest, {
    version: "4.4.8",
    notes: "修复自动更新链路",
    pub_date: "2026-03-23T13:40:04Z",
    platforms: {
      "windows-x86_64": {
        signature: "signature-value",
        url: "https://example.com/setup.exe",
      },
    },
  });
});

test("selectWindowsReleaseAssets rejects incomplete release assets", () => {
  assert.throws(
    () => selectWindowsReleaseAssets([
      {
        name: "db-scout-4.4.8-windows-x64-setup.exe",
        browser_download_url: "https://example.com/setup.exe",
      },
    ]),
    /Could not find a Windows updater signature asset/i,
  );
});
