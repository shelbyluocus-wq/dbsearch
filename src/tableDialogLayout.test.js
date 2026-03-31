import test from "node:test";
import assert from "node:assert/strict";

import { resolveAdaptiveTablePageSize } from "./tableDialogLayout.js";

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
