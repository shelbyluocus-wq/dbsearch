function normalizeTableName(tableName) {
  return String(tableName || "").trim().toLowerCase();
}

export function moveTableTab(tabs = [], fromIndex = -1, toIndex = -1) {
  const list = Array.isArray(tabs) ? [...tabs] : [];
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return list;
  }

  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list;
}

export function serializeTableTabOrder(tabs = []) {
  const list = Array.isArray(tabs) ? tabs : [];
  const seen = new Set();
  const order = [];

  for (const tab of list) {
    const normalized = normalizeTableName(tab?.tableName);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    order.push(String(tab.tableName).trim());
  }

  return order;
}

export function applyPersistedTableTabOrder(tabs = [], persistedOrder = []) {
  const list = Array.isArray(tabs) ? [...tabs] : [];
  const saved = Array.isArray(persistedOrder) ? persistedOrder : [];
  if (list.length <= 1 || saved.length === 0) return list;

  const unmatched = [...list];
  const ordered = [];

  for (const savedName of saved) {
    const normalizedSaved = normalizeTableName(savedName);
    if (!normalizedSaved) continue;
    const index = unmatched.findIndex((tab) => normalizeTableName(tab?.tableName) === normalizedSaved);
    if (index < 0) continue;
    ordered.push(unmatched[index]);
    unmatched.splice(index, 1);
  }

  return [...ordered, ...unmatched];
}

export function buildTableTabOrderStorageKey(connection = {}) {
  const host = String(connection?.host || "").trim().toLowerCase();
  const port = Number(connection?.port) || 0;
  const database = String(connection?.database || "").trim();
  if (!host || !port || !database) return "";
  return `db_scout_table_tab_order_v1_${host}_${port}_${database}`;
}
