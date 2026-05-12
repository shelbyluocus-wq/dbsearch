import test from "node:test";
import assert from "node:assert/strict";

import { createTableDataCache } from "./tableDataCache.js";

function payload(rows = [{ id: "1", name: "Alice" }]) {
  return {
    tableName: "users",
    columns: [{ column_name: "id" }, { column_name: "name" }],
    rows,
    totalRows: rows.length,
    page: 1,
    pageSize: 80,
  };
}

test("table data cache reuses entries by connection table page and page size", () => {
  const cache = createTableDataCache();
  const key = { connectionKey: "local/db", tableName: "users", page: 1, pageSize: 80 };

  cache.set(key, payload());

  assert.deepEqual(cache.get(key)?.rows, [{ id: "1", name: "Alice" }]);
  assert.equal(cache.get({ ...key, page: 2 }), null);
  assert.equal(cache.get({ ...key, tableName: "orders" }), null);
});

test("table data cache clones payloads on read and write", () => {
  const cache = createTableDataCache();
  const key = { connectionKey: "local/db", tableName: "users", page: 1, pageSize: 80 };
  const source = payload();

  cache.set(key, source);
  source.rows[0].name = "Mutated source";
  const firstRead = cache.get(key);
  firstRead.rows[0].name = "Mutated read";

  assert.equal(cache.get(key).rows[0].name, "Alice");
});

test("table data cache clears one table without clearing other tables", () => {
  const cache = createTableDataCache();
  const users = { connectionKey: "local/db", tableName: "users", page: 1, pageSize: 80 };
  const orders = { connectionKey: "local/db", tableName: "orders", page: 1, pageSize: 80 };

  cache.set(users, payload([{ id: "1" }]));
  cache.set(orders, payload([{ id: "2" }]));
  cache.clearTable(users);

  assert.equal(cache.get(users), null);
  assert.deepEqual(cache.get(orders)?.rows, [{ id: "2" }]);
});

test("table data cache evicts the least recently used entry", () => {
  const cache = createTableDataCache({ maxEntries: 2 });
  const first = { connectionKey: "local/db", tableName: "a", page: 1, pageSize: 80 };
  const second = { connectionKey: "local/db", tableName: "b", page: 1, pageSize: 80 };
  const third = { connectionKey: "local/db", tableName: "c", page: 1, pageSize: 80 };

  cache.set(first, payload([{ id: "a" }]));
  cache.set(second, payload([{ id: "b" }]));
  cache.get(first);
  cache.set(third, payload([{ id: "c" }]));

  assert.deepEqual(cache.get(first)?.rows, [{ id: "a" }]);
  assert.equal(cache.get(second), null);
  assert.deepEqual(cache.get(third)?.rows, [{ id: "c" }]);
  assert.equal(cache.size(), 2);
});

test("App.vue wires table data cache around table loading and invalidation", async () => {
  const { readFile } = await import("node:fs/promises");
  const appVue = await readFile(new URL("./App.vue", import.meta.url), "utf8");

  assert.match(appVue, /createTableDataCache/);
  assert.match(appVue, /tableDataCache\.get/);
  assert.match(appVue, /tableDataCache\.set/);
  assert.match(appVue, /tableDataCache\.clear/);
  assert.match(appVue, /tableDataCache\.clearTable/);
});
