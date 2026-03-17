import test from "node:test";
import assert from "node:assert/strict";

import {
  clearCollapsedColumnState,
  computeAutoCollapsedWidth,
  shouldShowColumnCollapseBadge,
  toggleColumnCollapsedState,
} from "./columnCollapse.js";

test("computeAutoCollapsedWidth uses header content width instead of forcing the old 80px minimum", () => {
  const width = computeAutoCollapsedWidth({
    headerTextWidth: 26,
    horizontalPadding: 16,
    badgeAllowance: 16,
    resizeHandleAllowance: 8,
  });

  assert.equal(width, 66);
  assert.ok(width < 80);
});

test("toggleColumnCollapsedState stores the previous width the first time a column is collapsed", () => {
  const next = toggleColumnCollapsedState({
    columnName: "doctor_note",
    currentWidth: 240,
    collapsedWidth: 72,
    collapsedColumns: {},
    restoreWidths: {},
  });

  assert.equal(next.nextWidth, 72);
  assert.equal(next.isCollapsed, true);
  assert.deepEqual(next.nextCollapsedColumns, { doctor_note: true });
  assert.deepEqual(next.nextRestoreWidths, { doctor_note: 240 });
});

test("toggleColumnCollapsedState restores the remembered width when toggled again", () => {
  const next = toggleColumnCollapsedState({
    columnName: "doctor_note",
    currentWidth: 72,
    collapsedWidth: 72,
    collapsedColumns: { doctor_note: true },
    restoreWidths: { doctor_note: 240 },
    fallbackWidth: 120,
  });

  assert.equal(next.nextWidth, 240);
  assert.equal(next.isCollapsed, false);
  assert.deepEqual(next.nextCollapsedColumns, {});
  assert.deepEqual(next.nextRestoreWidths, {});
});

test("toggleColumnCollapsedState falls back to the provided width when no remembered width exists", () => {
  const next = toggleColumnCollapsedState({
    columnName: "doctor_note",
    currentWidth: 72,
    collapsedWidth: 72,
    collapsedColumns: { doctor_note: true },
    restoreWidths: {},
    fallbackWidth: 132,
  });

  assert.equal(next.nextWidth, 132);
  assert.equal(next.isCollapsed, false);
});

test("clearCollapsedColumnState removes collapse bookkeeping after manual resize", () => {
  const next = clearCollapsedColumnState({
    columnName: "doctor_note",
    collapsedColumns: { doctor_note: true, summary: true },
    restoreWidths: { doctor_note: 240, summary: 180 },
  });

  assert.deepEqual(next.nextCollapsedColumns, { summary: true });
  assert.deepEqual(next.nextRestoreWidths, { summary: 180 });
});

test("shouldShowColumnCollapseBadge returns true when the current width is clearly larger than the target width", () => {
  const visible = shouldShowColumnCollapseBadge({
    currentWidth: 220,
    targetWidth: 80,
    isCollapsed: false,
  });

  assert.equal(visible, true);
});

test("shouldShowColumnCollapseBadge returns false when the current width is only slightly larger than the target width", () => {
  const visible = shouldShowColumnCollapseBadge({
    currentWidth: 102,
    targetWidth: 80,
    isCollapsed: false,
  });

  assert.equal(visible, false);
});

test("shouldShowColumnCollapseBadge stays visible for already collapsed columns", () => {
  const visible = shouldShowColumnCollapseBadge({
    currentWidth: 66,
    targetWidth: 66,
    isCollapsed: true,
  });

  assert.equal(visible, true);
});
