import test from "node:test";
import assert from "node:assert/strict";
import { resolveFocusMove, clampFocus, classifyFocusKey } from "./tableGridFocus.js";

const columns = ["id", "name", "note"];

test("resolveFocusMove moves down inside the page region", () => {
  assert.deepEqual(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 0,
      columnName: "name",
      columns,
      pageRowCount: 3,
      insertRowCount: 0,
      action: "down",
    }),
    { rowKind: "page", rowIndex: 1, columnName: "name" },
  );
});

test("resolveFocusMove moves up inside the page region", () => {
  assert.deepEqual(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 2,
      columnName: "id",
      columns,
      pageRowCount: 3,
      insertRowCount: 0,
      action: "up",
    }),
    { rowKind: "page", rowIndex: 1, columnName: "id" },
  );
});

test("resolveFocusMove crosses the page→insert boundary when moving down", () => {
  assert.deepEqual(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 2,
      columnName: "note",
      columns,
      pageRowCount: 3,
      insertRowCount: 2,
      action: "down",
    }),
    { rowKind: "insert", rowIndex: 0, columnName: "note" },
  );
});

test("resolveFocusMove crosses the insert→page boundary when moving up", () => {
  assert.deepEqual(
    resolveFocusMove({
      rowKind: "insert",
      rowIndex: 0,
      columnName: "name",
      columns,
      pageRowCount: 4,
      insertRowCount: 2,
      action: "up",
    }),
    { rowKind: "page", rowIndex: 3, columnName: "name" },
  );
});

test("resolveFocusMove returns null when moving down past the last insert row", () => {
  assert.equal(
    resolveFocusMove({
      rowKind: "insert",
      rowIndex: 1,
      columnName: "id",
      columns,
      pageRowCount: 2,
      insertRowCount: 2,
      action: "down",
    }),
    null,
  );
});

test("resolveFocusMove returns null when moving down from the last page row and there are no insert rows", () => {
  assert.equal(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 2,
      columnName: "note",
      columns,
      pageRowCount: 3,
      insertRowCount: 0,
      action: "down",
    }),
    null,
  );
});

test("resolveFocusMove returns null when moving up from the top of the page region", () => {
  assert.equal(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 0,
      columnName: "id",
      columns,
      pageRowCount: 3,
      insertRowCount: 2,
      action: "up",
    }),
    null,
  );
});

test("resolveFocusMove cycles columns with left/right", () => {
  assert.deepEqual(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 0,
      columnName: "id",
      columns,
      pageRowCount: 3,
      insertRowCount: 0,
      action: "left",
    }),
    { rowKind: "page", rowIndex: 0, columnName: "note" },
  );

  assert.deepEqual(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 0,
      columnName: "note",
      columns,
      pageRowCount: 3,
      insertRowCount: 0,
      action: "right",
    }),
    { rowKind: "page", rowIndex: 0, columnName: "id" },
  );
});

test("resolveFocusMove home/end jumps to the first/last column on the same row", () => {
  assert.deepEqual(
    resolveFocusMove({
      rowKind: "insert",
      rowIndex: 0,
      columnName: "name",
      columns,
      pageRowCount: 3,
      insertRowCount: 2,
      action: "home",
    }),
    { rowKind: "insert", rowIndex: 0, columnName: "id" },
  );

  assert.deepEqual(
    resolveFocusMove({
      rowKind: "insert",
      rowIndex: 0,
      columnName: "name",
      columns,
      pageRowCount: 3,
      insertRowCount: 2,
      action: "end",
    }),
    { rowKind: "insert", rowIndex: 0, columnName: "note" },
  );
});

test("resolveFocusMove returns null when the column name does not exist", () => {
  assert.equal(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 0,
      columnName: "missing",
      columns,
      pageRowCount: 3,
      insertRowCount: 0,
      action: "down",
    }),
    null,
  );
});

test("resolveFocusMove returns null for an out-of-range row index", () => {
  assert.equal(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 5,
      columnName: "id",
      columns,
      pageRowCount: 3,
      insertRowCount: 0,
      action: "down",
    }),
    null,
  );
});

test("resolveFocusMove handles an empty insert region by refusing to cross down", () => {
  assert.equal(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 0,
      columnName: "id",
      columns,
      pageRowCount: 1,
      insertRowCount: 0,
      action: "down",
    }),
    null,
  );
});

test("resolveFocusMove pageDown jumps from page to the last insert row", () => {
  assert.deepEqual(
    resolveFocusMove({
      rowKind: "page",
      rowIndex: 1,
      columnName: "id",
      columns,
      pageRowCount: 3,
      insertRowCount: 4,
      action: "pageDown",
    }),
    { rowKind: "insert", rowIndex: 3, columnName: "id" },
  );
});

test("resolveFocusMove pageUp jumps from insert back to the first page row", () => {
  assert.deepEqual(
    resolveFocusMove({
      rowKind: "insert",
      rowIndex: 2,
      columnName: "note",
      columns,
      pageRowCount: 3,
      insertRowCount: 4,
      action: "pageUp",
    }),
    { rowKind: "page", rowIndex: 0, columnName: "note" },
  );
});

test("clampFocus normalises out-of-range indices back into the page region", () => {
  assert.deepEqual(
    clampFocus({
      rowKind: "page",
      rowIndex: 99,
      columnName: "name",
      columns,
      pageRowCount: 3,
      insertRowCount: 0,
    }),
    { rowKind: "page", rowIndex: 2, columnName: "name" },
  );
});

test("clampFocus falls back to page[0] when the focus kind has no rows", () => {
  assert.deepEqual(
    clampFocus({
      rowKind: "insert",
      rowIndex: 5,
      columnName: "id",
      columns,
      pageRowCount: 2,
      insertRowCount: 0,
    }),
    { rowKind: "page", rowIndex: 0, columnName: "id" },
  );
});

test("clampFocus returns null when there are no rows at all", () => {
  assert.equal(
    clampFocus({
      rowKind: null,
      rowIndex: 0,
      columnName: "id",
      columns,
      pageRowCount: 0,
      insertRowCount: 0,
    }),
    null,
  );
});

test("classifyFocusKey maps arrow/home/end keys to move actions", () => {
  assert.equal(classifyFocusKey({ key: "ArrowUp" }), "up");
  assert.equal(classifyFocusKey({ key: "ArrowDown" }), "down");
  assert.equal(classifyFocusKey({ key: "ArrowLeft" }), "left");
  assert.equal(classifyFocusKey({ key: "ArrowRight" }), "right");
  assert.equal(classifyFocusKey({ key: "Home" }), "home");
  assert.equal(classifyFocusKey({ key: "End" }), "end");
  assert.equal(classifyFocusKey({ key: "PageUp" }), "pageUp");
  assert.equal(classifyFocusKey({ key: "PageDown" }), "pageDown");
  assert.equal(classifyFocusKey({ key: "Enter" }), null);
});
