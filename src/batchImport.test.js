import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBatchImportFileItems,
  describeTableDefaultViewLabel,
  resolveBatchImportTableName,
  summarizeBatchImportSelection,
  toggleTableDefaultView,
} from "./batchImport.js";

test("resolveBatchImportTableName maps an xlsx filename to its table name", () => {
  assert.equal(resolveBatchImportTableName("C:\\exports\\demo_orders.xlsx"), "demo_orders");
  assert.equal(resolveBatchImportTableName("/tmp/demo.audit.logs.xlsx"), "demo.audit.logs");
});

test("buildBatchImportFileItems defaults every selected xlsx file to selected import", () => {
  const items = buildBatchImportFileItems([
    "C:/exports/demo_orders.xlsx",
    "D:\\exports\\demo_audit_logs.xlsx",
  ]);

  assert.deepEqual(
    items.map((item) => ({
      path: item.path,
      fileName: item.fileName,
      tableName: item.tableName,
      selected: item.selected,
      status: item.status,
    })),
    [
      {
        path: "C:/exports/demo_orders.xlsx",
        fileName: "demo_orders.xlsx",
        tableName: "demo_orders",
        selected: true,
        status: "pending",
      },
      {
        path: "D:\\exports\\demo_audit_logs.xlsx",
        fileName: "demo_audit_logs.xlsx",
        tableName: "demo_audit_logs",
        selected: true,
        status: "pending",
      },
    ],
  );
});

test("summarizeBatchImportSelection blocks import when any selected file failed preview", () => {
  const summary = summarizeBatchImportSelection([
    { selected: true, status: "ready", rowCount: 3 },
    { selected: true, status: "error", errors: ["fields differ"] },
    { selected: false, status: "error", errors: ["ignored"] },
  ]);

  assert.equal(summary.selectedCount, 2);
  assert.equal(summary.readyCount, 1);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.totalRows, 3);
  assert.equal(summary.canPreview, true);
  assert.equal(summary.canImport, false);
});

test("toggleTableDefaultView switches between hit-only and full table defaults", () => {
  assert.equal(toggleTableDefaultView("hits"), "full");
  assert.equal(toggleTableDefaultView("full"), "hits");
  assert.equal(toggleTableDefaultView("weird"), "full");
});

test("describeTableDefaultViewLabel mirrors the current sidebar button state", () => {
  assert.equal(describeTableDefaultViewLabel("hits"), "TAP视图");
  assert.equal(describeTableDefaultViewLabel("full"), "正常视图");
  assert.equal(describeTableDefaultViewLabel("unknown"), "TAP视图");
});
