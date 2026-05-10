// tableEditChanges.js
//
// Helpers for edit-mode pending page-row changes. Page rows keep their
// original loaded values so primary-key edits do not change the row identity
// used by the pending updates map.

function toColumnNames(columns = []) {
  return (Array.isArray(columns) ? columns : [])
    .map((column) => typeof column === "string" ? column : column?.column_name)
    .map((columnName) => String(columnName || ""))
    .filter(Boolean);
}

export function buildWhereKeys({ row = {}, columns = [], primaryKeys = [] } = {}) {
  const keys = Array.isArray(primaryKeys) ? primaryKeys.filter(Boolean) : [];
  const out = {};
  if (keys.length > 0) {
    keys.forEach((key) => { out[key] = String(row?.[key] ?? ""); });
    return out;
  }
  toColumnNames(columns).forEach((columnName) => {
    out[columnName] = String(row?.[columnName] ?? "");
  });
  return out;
}

export function setPendingCellChange({
  updates = null,
  rowKey = "",
  row = {},
  columns = [],
  primaryKeys = [],
  columnName = "",
  nextValue = "",
} = {}) {
  if (!updates || typeof updates.has !== "function" || !rowKey || !columnName) {
    return null;
  }
  const value = String(nextValue ?? "");
  const originalValue = String(row?.[columnName] ?? "");
  if (value === originalValue) {
    if (updates.has(rowKey)) {
      const entry = updates.get(rowKey);
      if (entry?.changes) delete entry.changes[columnName];
      if (!entry?.changes || Object.keys(entry.changes).length === 0) {
        updates.delete(rowKey);
        return null;
      }
      return entry;
    }
    return null;
  }
  if (!updates.has(rowKey)) {
    updates.set(rowKey, {
      whereKeys: buildWhereKeys({ row, columns, primaryKeys }),
      changes: {},
    });
  }
  const entry = updates.get(rowKey);
  entry.changes[columnName] = value;
  return entry;
}

export function resolvePendingCellValue({
  row = {},
  rowKey = "",
  columnName = "",
  updates = null,
} = {}) {
  if (updates && rowKey && updates.has(rowKey)) {
    const entry = updates.get(rowKey);
    if (entry?.changes && Object.prototype.hasOwnProperty.call(entry.changes, columnName)) {
      return String(entry.changes[columnName] ?? "");
    }
  }
  return String(row?.[columnName] ?? "");
}
