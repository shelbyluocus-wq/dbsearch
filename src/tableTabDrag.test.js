import test from "node:test";
import assert from "node:assert/strict";

import {
  hasExceededTabDragThreshold,
  resolveTableTabDropIndex,
} from "./tableTabDrag.js";

test("hasExceededTabDragThreshold stays false until the pointer passes the drag threshold", () => {
  assert.equal(
    hasExceededTabDragThreshold({
      startX: 100,
      startY: 100,
      currentX: 104,
      currentY: 103,
      threshold: 6,
    }),
    false,
  );

  assert.equal(
    hasExceededTabDragThreshold({
      startX: 100,
      startY: 100,
      currentX: 107,
      currentY: 100,
      threshold: 6,
    }),
    true,
  );
});

test("resolveTableTabDropIndex inserts before or after the hovered tab based on the pointer side", () => {
  const tabs = [
    { id: "tab-1", tableName: "users" },
    { id: "tab-2", tableName: "orders" },
    { id: "tab-3", tableName: "audit_logs" },
  ];

  assert.equal(
    resolveTableTabDropIndex({
      tabs,
      draggedTabId: "tab-1",
      hoveredTabId: "tab-2",
      pointerX: 135,
      hoveredRect: { left: 100, width: 80 },
    }),
    0,
  );

  assert.equal(
    resolveTableTabDropIndex({
      tabs,
      draggedTabId: "tab-1",
      hoveredTabId: "tab-2",
      pointerX: 155,
      hoveredRect: { left: 100, width: 80 },
    }),
    1,
  );
});

test("resolveTableTabDropIndex works in both drag directions", () => {
  const tabs = [
    { id: "tab-1", tableName: "users" },
    { id: "tab-2", tableName: "orders" },
    { id: "tab-3", tableName: "audit_logs" },
    { id: "tab-4", tableName: "jobs" },
  ];

  assert.equal(
    resolveTableTabDropIndex({
      tabs,
      draggedTabId: "tab-4",
      hoveredTabId: "tab-2",
      pointerX: 110,
      hoveredRect: { left: 100, width: 80 },
    }),
    1,
  );

  assert.equal(
    resolveTableTabDropIndex({
      tabs,
      draggedTabId: "tab-2",
      hoveredTabId: "tab-4",
      pointerX: 170,
      hoveredRect: { left: 100, width: 80 },
    }),
    3,
  );
});

test("resolveTableTabDropIndex degrades safely for invalid drag input", () => {
  assert.equal(
    resolveTableTabDropIndex({
      tabs: null,
      draggedTabId: "tab-1",
      hoveredTabId: "tab-2",
      pointerX: 100,
      hoveredRect: { left: 100, width: 80 },
    }),
    -1,
  );

  assert.equal(
    resolveTableTabDropIndex({
      tabs: [{ id: "tab-1", tableName: "users" }],
      draggedTabId: "tab-1",
      hoveredTabId: "tab-1",
      pointerX: 100,
      hoveredRect: { left: 100, width: 80 },
    }),
    -1,
  );
});
