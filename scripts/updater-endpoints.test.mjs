import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("Tauri updater uses only the Gitee manifest endpoint", async () => {
  const configPath = path.resolve("src-tauri/tauri.conf.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const endpoints = config.plugins?.updater?.endpoints;

  assert.deepEqual(endpoints, [
    "https://gitee.com/shelbylouis/dbsearch-release/raw/master/latest.json",
  ]);
  assert.ok(
    endpoints.every((endpoint) => !endpoint.includes("github.com")),
    "GitHub updater fallback must stay disabled",
  );
});
