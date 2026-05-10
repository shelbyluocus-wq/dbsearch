import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRange,
  expandRange,
  enumerateRangeCells,
  rangeSize,
  fillRangeValue,
  buildFillDownChanges,
  parseClipboardTsv,
  applyTsvToRange,
  buildRangeTsv,
} from "./tableCellRange.js";

const columns = ["id", "name", "remark"];

function point(rowKind, rowIndex, columnName) {
  return { rowKind, rowIndex, columnName };
}

test("normalizeRange orders an anchor/head rectangle", () => {
  const range = normalizeRange({
    anchor: point("page", 2, "remark"),
    head: point("page", 0, "id"),
    columns,
    pageCount: 3,
    insertCount: 0,
  });
  assert.deepEqual(range, {
    rowKind: "page",
    rowStart: 0,
    rowEnd: 2,
    colStart: 0,
    colEnd: 2,
    columns,
  });
});

test("normalizeRange clamps a head in the wrong rowKind into anchor's kind", () => {
  const range = normalizeRange({
    anchor: point("page", 1, "name"),
    head: point("insert", 5, "remark"),
    columns,
    pageCount: 3,
    insertCount: 2,
  });
  // When anchor is page and head falls into insert below, we pin head to the
  // last page row.
  assert.deepEqual(range, {
    rowKind: "page",
    rowStart: 1,
    rowEnd: 2,
    colStart: 1,
    colEnd: 2,
    columns,
  });
});

test("normalizeRange returns null when the column is unknown", () => {
  assert.equal(
    normalizeRange({
      anchor: point("page", 0, "unknown"),
      head: point("page", 0, "id"),
      columns,
      pageCount: 2,
      insertCount: 0,
    }),
    null,
  );
});

test("normalizeRange returns null when anchor row index exceeds count", () => {
  assert.equal(
    normalizeRange({
      anchor: point("page", 5, "id"),
      head: point("page", 0, "id"),
      columns,
      pageCount: 2,
      insertCount: 0,
    }),
    null,
  );
});

test("expandRange shifts the head down without crossing rowKind", () => {
  const result = expandRange({
    anchor: point("page", 0, "id"),
    head: point("page", 0, "id"),
    columns,
    pageCount: 3,
    insertCount: 2,
    direction: "down",
  });
  assert.deepEqual(result.head, { rowKind: "page", rowIndex: 1, columnName: "id" });
});

test("expandRange crosses from the last page row into insert rows", () => {
  const result = expandRange({
    anchor: point("page", 2, "id"),
    head: point("page", 2, "id"),
    columns,
    pageCount: 3,
    insertCount: 2,
    direction: "down",
  });
  assert.deepEqual(result.head, { rowKind: "insert", rowIndex: 0, columnName: "id" });
});

test("expandRange returns null when moving downward past the last insert row", () => {
  const result = expandRange({
    anchor: point("page", 2, "id"),
    head: point("insert", 1, "id"),
    columns,
    pageCount: 3,
    insertCount: 2,
    direction: "down",
  });
  assert.equal(result, null);
});

test("expandRange continues downward through existing insert rows after crossing from page", () => {
  const result = expandRange({
    anchor: point("page", 2, "id"),
    head: point("insert", 0, "id"),
    columns,
    pageCount: 3,
    insertCount: 2,
    direction: "down",
  });
  assert.deepEqual(result.head, { rowKind: "insert", rowIndex: 1, columnName: "id" });
});

test("expandRange moves upward from first insert row back to the last page row", () => {
  const result = expandRange({
    anchor: point("page", 2, "id"),
    head: point("insert", 0, "id"),
    columns,
    pageCount: 3,
    insertCount: 2,
    direction: "up",
  });
  assert.deepEqual(result.head, { rowKind: "page", rowIndex: 2, columnName: "id" });
});

test("expandRange does not wrap columns on right", () => {
  const result = expandRange({
    anchor: point("page", 0, "remark"),
    head: point("page", 0, "remark"),
    columns,
    pageCount: 3,
    insertCount: 0,
    direction: "right",
  });
  assert.deepEqual(result.head, { rowKind: "page", rowIndex: 0, columnName: "remark" });
});

test("enumerateRangeCells enumerates every cell in row-major order", () => {
  const range = normalizeRange({
    anchor: point("page", 0, "id"),
    head: point("page", 1, "name"),
    columns,
    pageCount: 3,
    insertCount: 0,
  });
  assert.deepEqual(enumerateRangeCells(range), [
    { rowKind: "page", rowIndex: 0, columnName: "id" },
    { rowKind: "page", rowIndex: 0, columnName: "name" },
    { rowKind: "page", rowIndex: 1, columnName: "id" },
    { rowKind: "page", rowIndex: 1, columnName: "name" },
  ]);
});

test("rangeSize reports rows × cols", () => {
  const range = normalizeRange({
    anchor: point("insert", 0, "id"),
    head: point("insert", 2, "remark"),
    columns,
    pageCount: 0,
    insertCount: 3,
  });
  assert.deepEqual(rangeSize(range), { rows: 3, cols: 3 });
});

test("fillRangeValue sets every cell in the range", () => {
  const range = normalizeRange({
    anchor: point("page", 0, "id"),
    head: point("page", 1, "name"),
    columns,
    pageCount: 2,
    insertCount: 0,
  });
  assert.deepEqual(fillRangeValue(range, "X"), [
    { rowKind: "page", rowIndex: 0, columnName: "id", value: "X" },
    { rowKind: "page", rowIndex: 0, columnName: "name", value: "X" },
    { rowKind: "page", rowIndex: 1, columnName: "id", value: "X" },
    { rowKind: "page", rowIndex: 1, columnName: "name", value: "X" },
  ]);
});

test("buildFillDownChanges copies the top row downwards, per column", () => {
  const range = normalizeRange({
    anchor: point("page", 0, "id"),
    head: point("page", 2, "name"),
    columns,
    pageCount: 3,
    insertCount: 0,
  });
  const store = {
    page: [
      { id: "a", name: "A", remark: "" },
      { id: "b", name: "B", remark: "" },
      { id: "c", name: "C", remark: "" },
    ],
  };
  const changes = buildFillDownChanges(range, (kind, r, col) => store[kind][r][col]);
  assert.deepEqual(changes, [
    { rowKind: "page", rowIndex: 1, columnName: "id", value: "a" },
    { rowKind: "page", rowIndex: 2, columnName: "id", value: "a" },
    { rowKind: "page", rowIndex: 1, columnName: "name", value: "A" },
    { rowKind: "page", rowIndex: 2, columnName: "name", value: "A" },
  ]);
});

test("parseClipboardTsv splits simple matrices", () => {
  assert.deepEqual(parseClipboardTsv("a\tb\nc\td"), [["a", "b"], ["c", "d"]]);
});

test("parseClipboardTsv keeps embedded tabs/newlines in quoted fields", () => {
  const src = '1\t"two\ttabs"\r\n3\t"line 1\nline ""2"""';
  assert.deepEqual(parseClipboardTsv(src), [
    ["1", "two\ttabs"],
    ["3", 'line 1\nline "2"'],
  ]);
});

test("parseClipboardTsv treats a trailing newline as row terminator", () => {
  assert.deepEqual(parseClipboardTsv("a\tb\n"), [["a", "b"]]);
});

test("applyTsvToRange expands a 1×1 selection to the TSV shape", () => {
  const range = normalizeRange({
    anchor: point("page", 0, "id"),
    head: point("page", 0, "id"),
    columns,
    pageCount: 5,
    insertCount: 0,
  });
  const tsv = [
    ["A", "B"],
    ["C", "D"],
  ];
  const { changes, newRange } = applyTsvToRange({
    tsv,
    range,
    pageCount: 5,
    insertCount: 0,
  });
  assert.deepEqual(newRange, {
    rowKind: "page",
    rowStart: 0,
    rowEnd: 1,
    colStart: 0,
    colEnd: 1,
    columns,
  });
  assert.deepEqual(changes, [
    { rowKind: "page", rowIndex: 0, columnName: "id", value: "A" },
    { rowKind: "page", rowIndex: 0, columnName: "name", value: "B" },
    { rowKind: "page", rowIndex: 1, columnName: "id", value: "C" },
    { rowKind: "page", rowIndex: 1, columnName: "name", value: "D" },
  ]);
});

test("applyTsvToRange tiles a smaller TSV into a larger selection", () => {
  const range = normalizeRange({
    anchor: point("page", 0, "id"),
    head: point("page", 1, "remark"),
    columns,
    pageCount: 2,
    insertCount: 0,
  });
  const tsv = [["X"]];
  const { changes } = applyTsvToRange({
    tsv,
    range,
    pageCount: 2,
    insertCount: 0,
  });
  assert.equal(changes.length, 6);
  assert.ok(changes.every((c) => c.value === "X"));
});

test("applyTsvToRange clamps an over-large 1×1 paste to grid bounds", () => {
  const range = normalizeRange({
    anchor: point("page", 1, "name"),
    head: point("page", 1, "name"),
    columns,
    pageCount: 2,
    insertCount: 0,
  });
  const tsv = [
    ["A", "B", "C", "D"],
    ["E", "F", "G", "H"],
    ["I", "J", "K", "L"],
  ];
  const { changes, newRange } = applyTsvToRange({
    tsv,
    range,
    pageCount: 2,
    insertCount: 0,
  });
  // Anchored at (1, 'name'): only 1 row × 2 cols fit (name, remark).
  assert.deepEqual(newRange, {
    rowKind: "page",
    rowStart: 1,
    rowEnd: 1,
    colStart: 1,
    colEnd: 2,
    columns,
  });
  assert.deepEqual(changes, [
    { rowKind: "page", rowIndex: 1, columnName: "name", value: "A" },
    { rowKind: "page", rowIndex: 1, columnName: "remark", value: "B" },
  ]);
});

test("buildRangeTsv quotes cells containing tabs or newlines", () => {
  const range = normalizeRange({
    anchor: point("page", 0, "id"),
    head: point("page", 1, "name"),
    columns,
    pageCount: 2,
    insertCount: 0,
  });
  const store = [
    { id: "1", name: "plain" },
    { id: "2", name: "has\ttab" },
  ];
  const tsv = buildRangeTsv(range, (kind, r, col) => store[r][col]);
  assert.equal(tsv, '1\tplain\r\n2\t"has\ttab"');
});
