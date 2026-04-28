import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STARTUP_WELCOME_MODE,
  DEFAULT_STARTUP_WELCOME_TEXT,
  buildStartupWelcomeStrokeOrderGlyphs,
  normalizeStartupWelcomeMode,
  normalizeStartupWelcomeText,
} from "./startupWelcome.js";

test("normalizeStartupWelcomeText falls back to Louis for blank values", () => {
  assert.equal(DEFAULT_STARTUP_WELCOME_TEXT, "Louis");
  assert.equal(normalizeStartupWelcomeText(""), "Louis");
  assert.equal(normalizeStartupWelcomeText("   "), "Louis");
  assert.equal(normalizeStartupWelcomeText(null), "Louis");
});

test("normalizeStartupWelcomeText trims configured text", () => {
  assert.equal(normalizeStartupWelcomeText("  Shelby Louis  "), "Shelby Louis");
});

test("normalizeStartupWelcomeText truncates long welcome text", () => {
  assert.equal(normalizeStartupWelcomeText("abcdefghijklmnop"), "abcdefghijkl");
});

test("normalizeStartupWelcomeMode falls back to handwriting", () => {
  assert.equal(DEFAULT_STARTUP_WELCOME_MODE, "handwriting");
  assert.equal(normalizeStartupWelcomeMode(""), "handwriting");
  assert.equal(normalizeStartupWelcomeMode("weird"), "handwriting");
});

test("normalizeStartupWelcomeMode accepts the stroke order mode", () => {
  assert.equal(normalizeStartupWelcomeMode("stroke_order"), "stroke_order");
});

test("buildStartupWelcomeStrokeOrderGlyphs reveals glyphs in text order", () => {
  assert.deepEqual(
    buildStartupWelcomeStrokeOrderGlyphs("Lou", {
      centerX: 100,
      maxWidth: 80,
      delayStepMs: 120,
    }),
    [
      { id: "0-76", char: "L", x: 60, delayMs: 0 },
      { id: "1-111", char: "o", x: 100, delayMs: 120 },
      { id: "2-117", char: "u", x: 140, delayMs: 240 },
    ],
  );
});
