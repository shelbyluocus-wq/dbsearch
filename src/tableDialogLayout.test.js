import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAdaptiveTablePageSize,
  shouldApplyAdaptiveTablePageSize,
} from "./tableDialogLayout.js";

test("resolveAdaptiveTablePageSize computes rows from measurements in the same visual coordinate system", () => {
  assert.equal(
    resolveAdaptiveTablePageSize({
      visibleHeight: 360,
      headerHeight: 32,
      rowHeight: 41,
      minRows: 1,
      maxRows: 200,
    }),
    8,
  );
});

test("resolveAdaptiveTablePageSize clamps the result into the supported range", () => {
  assert.equal(
    resolveAdaptiveTablePageSize({
      visibleHeight: 5000,
      headerHeight: 32,
      rowHeight: 20,
      minRows: 1,
      maxRows: 200,
    }),
    200,
  );
});

test("resolveAdaptiveTablePageSize degrades safely for invalid or tiny measurements", () => {
  assert.equal(
    resolveAdaptiveTablePageSize({
      visibleHeight: 28,
      headerHeight: 32,
      rowHeight: 20,
      minRows: 1,
      maxRows: 200,
    }),
    null,
  );

  assert.equal(
    resolveAdaptiveTablePageSize({
      visibleHeight: 280,
      headerHeight: 32,
      rowHeight: 0,
      minRows: 1,
      maxRows: 200,
    }),
    null,
  );
});

test("shouldApplyAdaptiveTablePageSize skips reload-prone resizing during fullscreen transitions", () => {
  assert.equal(
    shouldApplyAdaptiveTablePageSize({
      currentPageSize: 50,
      nextPageSize: 72,
      fullscreenTransitioning: true,
    }),
    false,
  );
});

test("shouldApplyAdaptiveTablePageSize skips reload-prone resizing during seamless scrolling", () => {
  assert.equal(
    shouldApplyAdaptiveTablePageSize({
      currentPageSize: 50,
      nextPageSize: 72,
      seamlessScrolling: true,
    }),
    false,
  );
});

test("shouldApplyAdaptiveTablePageSize applies stable page size changes only when needed", () => {
  assert.equal(
    shouldApplyAdaptiveTablePageSize({
      currentPageSize: 50,
      nextPageSize: 72,
      fullscreenTransitioning: false,
    }),
    true,
  );

  assert.equal(
    shouldApplyAdaptiveTablePageSize({
      currentPageSize: 50,
      nextPageSize: 50,
      fullscreenTransitioning: false,
    }),
    false,
  );
});
