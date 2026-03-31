import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { APP_PACKAGE_VERSION } from "./appVersion.js";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("APP_PACKAGE_VERSION matches package.json version exactly", () => {
  assert.equal(APP_PACKAGE_VERSION, packageJson.version);
});
