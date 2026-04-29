import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBatchCellChanges,
  buildSelectedRowsTsv,
  resolveRowSelection,
  resolveSelectAllRowKeys,
} from "./tableEditSelection.js";

const rowKeys = ["row-1", "row-2", "row-3", "row-4"];

test("resolveRowSelection replaces selection with the clicked row by default", () => {
  assert.deepEqual(
    resolveRowSelection({
      rowKeys,
      selectedKeys: ["row-1", "row-2"],
      rowIndex: 2,
    }),
    { selectedKeys: ["row-3"], anchorIndex: 2 },
  );
});

test("resolveRowSelection supports ctrl/meta toggling without clearing other rows", () => {
  assert.deepEqual(
    resolveRowSelection({
      rowKeys,
      selectedKeys: ["row-1", "row-3"],
      rowIndex: 1,
      additiveKey: true,
    }),
    { selectedKeys: ["row-1", "row-3", "row-2"], anchorIndex: 1 },
  );

  assert.deepEqual(
    resolveRowSelection({
      rowKeys,
      selectedKeys: ["row-1", "row-2", "row-3"],
      rowIndex: 1,
      additiveKey: true,
    }),
    { selectedKeys: ["row-1", "row-3"], anchorIndex: 1 },
  );
});

test("resolveRowSelection shift-selects a contiguous range and skips deleted rows", () => {
  assert.deepEqual(
    resolveRowSelection({
      rowKeys,
      selectedKeys: ["row-1"],
      deletedKeys: ["row-3"],
      rowIndex: 3,
      anchorIndex: 0,
      shiftKey: true,
    }),
    { selectedKeys: ["row-1", "row-2", "row-4"], anchorIndex: 0 },
  );
});

test("resolveSelectAllRowKeys toggles all selectable rows on the current page", () => {
  assert.deepEqual(
    resolveSelectAllRowKeys({
      rowKeys,
      selectedKeys: [],
      deletedKeys: ["row-2"],
    }),
    ["row-1", "row-3", "row-4"],
  );

  assert.deepEqual(
    resolveSelectAllRowKeys({
      rowKeys,
      selectedKeys: ["row-1", "row-3", "row-4"],
      deletedKeys: ["row-2"],
    }),
    [],
  );
});

test("buildSelectedRowsTsv copies selected rows in table column order without a header", () => {
  const rows = [
    { id: 1, name: "Ada", note: "plain" },
    { id: 2, name: "Grace\tHopper", note: "line 1\n\"line 2\"" },
    { id: 3, name: "Linus", note: "" },
  ];
  const columns = ["id", "name", "note"];

  assert.equal(
    buildSelectedRowsTsv({
      rows,
      columns,
      rowKeys: ["a", "b", "c"],
      selectedKeys: ["b", "a"],
    }),
    "1\tAda\tplain\r\n2\t\"Grace\tHopper\"\t\"line 1\n\"\"line 2\"\"\"",
  );
});

test("buildBatchCellChanges keeps empty string values so selected rows can be cleared", () => {
  assert.deepEqual(
    buildBatchCellChanges({
      rowKeys,
      selectedKeys: ["row-1", "row-4"],
      deletedKeys: ["row-2"],
      columnName: "remark",
      value: "",
    }),
    [
      { rowKey: "row-1", columnName: "remark", value: "" },
      { rowKey: "row-4", columnName: "remark", value: "" },
    ],
  );
});
