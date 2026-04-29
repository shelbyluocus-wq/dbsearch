import test from "node:test";
import assert from "node:assert/strict";
import { resolveEditNavigation } from "./tableEditNavigation.js";

const columns = ["id", "feature_name", "remark"];

test("resolveEditNavigation moves Enter down within the same column", () => {
  assert.deepEqual(
    resolveEditNavigation({
      rowIndex: 0,
      columnName: "feature_name",
      columns,
      rowCount: 3,
      action: "enter",
    }),
    { rowIndex: 1, columnName: "feature_name" },
  );
});

test("resolveEditNavigation moves Shift+Enter up within the same column", () => {
  assert.deepEqual(
    resolveEditNavigation({
      rowIndex: 2,
      columnName: "remark",
      columns,
      rowCount: 3,
      action: "shift-enter",
    }),
    { rowIndex: 1, columnName: "remark" },
  );
});

test("resolveEditNavigation tabs across columns and wraps to the next row", () => {
  assert.deepEqual(
    resolveEditNavigation({
      rowIndex: 0,
      columnName: "feature_name",
      columns,
      rowCount: 3,
      action: "tab",
    }),
    { rowIndex: 0, columnName: "remark" },
  );

  assert.deepEqual(
    resolveEditNavigation({
      rowIndex: 0,
      columnName: "remark",
      columns,
      rowCount: 3,
      action: "tab",
    }),
    { rowIndex: 1, columnName: "id" },
  );
});

test("resolveEditNavigation shift-tabs across columns and wraps to the previous row", () => {
  assert.deepEqual(
    resolveEditNavigation({
      rowIndex: 1,
      columnName: "feature_name",
      columns,
      rowCount: 3,
      action: "shift-tab",
    }),
    { rowIndex: 1, columnName: "id" },
  );

  assert.deepEqual(
    resolveEditNavigation({
      rowIndex: 1,
      columnName: "id",
      columns,
      rowCount: 3,
      action: "shift-tab",
    }),
    { rowIndex: 0, columnName: "remark" },
  );
});

test("resolveEditNavigation returns null at grid boundaries or invalid input", () => {
  assert.equal(
    resolveEditNavigation({
      rowIndex: 2,
      columnName: "remark",
      columns,
      rowCount: 3,
      action: "tab",
    }),
    null,
  );
  assert.equal(
    resolveEditNavigation({
      rowIndex: 0,
      columnName: "id",
      columns,
      rowCount: 3,
      action: "shift-tab",
    }),
    null,
  );
  assert.equal(
    resolveEditNavigation({
      rowIndex: 0,
      columnName: "missing",
      columns,
      rowCount: 3,
      action: "enter",
    }),
    null,
  );
});
