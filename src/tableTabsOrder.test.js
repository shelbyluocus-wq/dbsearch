import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPersistedTableTabOrder,
  buildTableTabOrderStorageKey,
  moveTableTab,
  serializeTableTabOrder,
} from "./tableTabsOrder.js";

test("moveTableTab moves a tab from one index to another", () => {
  const tabs = [
    { id: "tab-1", tableName: "users" },
    { id: "tab-2", tableName: "orders" },
    { id: "tab-3", tableName: "audit_logs" },
  ];

  assert.deepEqual(
    moveTableTab(tabs, 0, 2).map((tab) => tab.tableName),
    ["orders", "audit_logs", "users"],
  );
});

test("applyPersistedTableTabOrder prioritizes saved order and appends new tabs", () => {
  const tabs = [
    { id: "tab-1", tableName: "users" },
    { id: "tab-2", tableName: "orders" },
    { id: "tab-3", tableName: "audit_logs" },
  ];

  assert.deepEqual(
    applyPersistedTableTabOrder(tabs, ["audit_logs", "users"]).map((tab) => tab.tableName),
    ["audit_logs", "users", "orders"],
  );
});

test("applyPersistedTableTabOrder matches table names case-insensitively", () => {
  const tabs = [
    { id: "tab-1", tableName: "Users" },
    { id: "tab-2", tableName: "Orders" },
  ];

  assert.deepEqual(
    applyPersistedTableTabOrder(tabs, ["orders", "users"]).map((tab) => tab.tableName),
    ["Orders", "Users"],
  );
});

test("serializeTableTabOrder emits de-duplicated table names in current order", () => {
  const tabs = [
    { id: "tab-1", tableName: "users" },
    { id: "tab-2", tableName: "Users" },
    { id: "tab-3", tableName: "audit_logs" },
  ];

  assert.deepEqual(serializeTableTabOrder(tabs), ["users", "audit_logs"]);
});

test("buildTableTabOrderStorageKey scopes persisted order to the active database connection", () => {
  assert.equal(
    buildTableTabOrderStorageKey({
      host: "127.0.0.1",
      port: 3306,
      database: "demo",
    }),
    "db_scout_table_tab_order_v1_127.0.0.1_3306_demo",
  );
});

test("tab order helpers degrade safely for empty or invalid input", () => {
  assert.deepEqual(moveTableTab(null, 0, 1), []);
  assert.deepEqual(applyPersistedTableTabOrder([{ id: "tab-1", tableName: "users" }], null), [{ id: "tab-1", tableName: "users" }]);
  assert.deepEqual(serializeTableTabOrder(null), []);
  assert.equal(buildTableTabOrderStorageKey({}), "");
});
