import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWhereKeys,
  resolvePendingCellValue,
  setPendingCellChange,
} from "./tableEditChanges.js";

test("buildWhereKeys uses primary keys from the original row", () => {
  assert.deepEqual(
    buildWhereKeys({
      row: { log_id: 50003, actor: "system" },
      columns: ["log_id", "actor"],
      primaryKeys: ["log_id"],
    }),
    { log_id: "50003" },
  );
});

test("setPendingCellChange overlays primary-key edits without mutating the row identity", () => {
  const row = { log_id: "50003", actor: "system" };
  const updates = new Map();
  const rowKey = "50003";

  setPendingCellChange({
    updates,
    rowKey,
    row,
    columns: ["log_id", "actor"],
    primaryKeys: ["log_id"],
    columnName: "log_id",
    nextValue: "500023",
  });
  setPendingCellChange({
    updates,
    rowKey,
    row,
    columns: ["log_id", "actor"],
    primaryKeys: ["log_id"],
    columnName: "actor",
    nextValue: "operator",
  });

  assert.equal(row.log_id, "50003");
  assert.equal(updates.size, 1);
  assert.deepEqual(updates.get(rowKey), {
    whereKeys: { log_id: "50003" },
    changes: { log_id: "500023", actor: "operator" },
  });
  assert.equal(resolvePendingCellValue({ row, rowKey, columnName: "log_id", updates }), "500023");
  assert.equal(resolvePendingCellValue({ row, rowKey, columnName: "actor", updates }), "operator");
});

test("setPendingCellChange removes a pending value when it returns to the original row value", () => {
  const row = { log_id: "50003", actor: "system" };
  const updates = new Map();
  const rowKey = "50003";

  setPendingCellChange({
    updates,
    rowKey,
    row,
    columns: ["log_id", "actor"],
    primaryKeys: ["log_id"],
    columnName: "log_id",
    nextValue: "500023",
  });
  setPendingCellChange({
    updates,
    rowKey,
    row,
    columns: ["log_id", "actor"],
    primaryKeys: ["log_id"],
    columnName: "log_id",
    nextValue: "50003",
  });

  assert.equal(updates.size, 0);
  assert.equal(resolvePendingCellValue({ row, rowKey, columnName: "log_id", updates }), "50003");
});
