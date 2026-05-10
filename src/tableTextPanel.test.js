import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFocusKey,
  clampTextPanelHeight,
  resolveTextPanelLoad,
  shouldRouteTextPanelKeyToGrid,
} from "./tableTextPanel.js";

test("buildFocusKey produces a stable string for a cell focus", () => {
  assert.equal(
    buildFocusKey({ rowKind: "page", rowIndex: 3, columnName: "name" }),
    "page:3:name",
  );
  assert.equal(buildFocusKey(null), "");
  assert.equal(buildFocusKey({ rowKind: null }), "");
});

test("resolveTextPanelLoad clears the panel when focus is gone", () => {
  const res = resolveTextPanelLoad({
    focus: null,
    panelDirty: false,
    lastFocusKey: "page:1:id",
    originalText: "42",
  });
  assert.deepEqual(res, {
    action: "clear",
    draft: "",
    focusKey: "",
    dirty: false,
  });
});

test("resolveTextPanelLoad is a no-op when focus is unchanged", () => {
  const res = resolveTextPanelLoad({
    focus: { rowKind: "page", rowIndex: 2, columnName: "name" },
    panelDirty: true,
    lastFocusKey: "page:2:name",
    originalText: "ignored",
  });
  assert.equal(res.action, "noop");
  assert.equal(res.dirty, true);
});

test("resolveTextPanelLoad auto-loads the new value when the panel is clean", () => {
  const res = resolveTextPanelLoad({
    focus: { rowKind: "page", rowIndex: 2, columnName: "name" },
    panelDirty: false,
    lastFocusKey: "page:1:id",
    originalText: "Ada",
  });
  assert.deepEqual(res, {
    action: "load",
    draft: "Ada",
    focusKey: "page:2:name",
    dirty: false,
  });
});

test("resolveTextPanelLoad refuses to overwrite a dirty draft when focus changes", () => {
  const res = resolveTextPanelLoad({
    focus: { rowKind: "insert", rowIndex: 0, columnName: "note" },
    panelDirty: true,
    lastFocusKey: "page:1:id",
    originalText: "new",
  });
  assert.equal(res.action, "warn");
  assert.equal(res.focusKey, "page:1:id"); // stays on old focus
  assert.equal(res.dirty, true);
});

test("resolveTextPanelLoad falls back to empty string when originalText is undefined", () => {
  const res = resolveTextPanelLoad({
    focus: { rowKind: "page", rowIndex: 0, columnName: "id" },
    panelDirty: false,
    lastFocusKey: "",
  });
  assert.equal(res.action, "load");
  assert.equal(res.draft, "");
});

test("clampTextPanelHeight applies the 120px minimum and 60%-of-container maximum", () => {
  assert.equal(clampTextPanelHeight(50, 600), 120);
  assert.equal(clampTextPanelHeight(300, 600), 300);
  assert.equal(clampTextPanelHeight(1000, 600), 360);
  // No container → clamp only enforces the minimum.
  assert.equal(clampTextPanelHeight(50, 0), 120);
  // Any non-numeric height falls back to the minimum to avoid NaN.
  assert.equal(clampTextPanelHeight(NaN, 600), 120);
});

test("shouldRouteTextPanelKeyToGrid keeps text editing keys inside the textarea", () => {
  assert.equal(shouldRouteTextPanelKeyToGrid({ key: "a" }), false);
  assert.equal(shouldRouteTextPanelKeyToGrid({ key: "Backspace" }), false);
  assert.equal(shouldRouteTextPanelKeyToGrid({ key: "ArrowLeft" }), false);
  assert.equal(shouldRouteTextPanelKeyToGrid({ key: "z", ctrlKey: true }), false);
});

test("shouldRouteTextPanelKeyToGrid only lets plain F4 reach the grid dispatcher", () => {
  assert.equal(shouldRouteTextPanelKeyToGrid({ key: "F4" }), true);
  assert.equal(shouldRouteTextPanelKeyToGrid({ key: "F4", shiftKey: true }), false);
  assert.equal(shouldRouteTextPanelKeyToGrid({ key: "F4", ctrlKey: true }), false);
  assert.equal(shouldRouteTextPanelKeyToGrid({ key: "F4", altKey: true }), false);
});
