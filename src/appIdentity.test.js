import test from "node:test";
import assert from "node:assert/strict";

import { formatAppDisplayTitle } from "./appIdentity.js";

test("formatAppDisplayTitle prefixes the app name with an uppercase V version suffix", () => {
  assert.equal(formatAppDisplayTitle("4.4.9"), "鹰捷V4.4.9");
});

test("formatAppDisplayTitle falls back to the base name when the version is empty", () => {
  assert.equal(formatAppDisplayTitle(""), "鹰捷");
});
