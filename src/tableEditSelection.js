function normalizeKeyList(keys = []) {
  return (Array.isArray(keys) ? keys : Array.from(keys || []))
    .map((key) => String(key ?? ""))
    .filter(Boolean);
}

function uniqueKeyList(keys = []) {
  return [...new Set(normalizeKeyList(keys))];
}

function isSelectableRow(rowKeys, deletedSet, rowIndex) {
  return Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < rowKeys.length && !deletedSet.has(rowKeys[rowIndex]);
}

export function resolveRowSelection({
  rowKeys = [],
  selectedKeys = [],
  deletedKeys = [],
  rowIndex = -1,
  anchorIndex = -1,
  shiftKey = false,
  additiveKey = false,
} = {}) {
  const normalizedRowKeys = normalizeKeyList(rowKeys);
  const deletedSet = new Set(normalizeKeyList(deletedKeys));
  const selectedSet = new Set(normalizeKeyList(selectedKeys));

  if (!isSelectableRow(normalizedRowKeys, deletedSet, rowIndex)) {
    return {
      selectedKeys: uniqueKeyList(selectedSet).filter((key) => normalizedRowKeys.includes(key)),
      anchorIndex,
    };
  }

  if (shiftKey) {
    const baseIndex = isSelectableRow(normalizedRowKeys, deletedSet, anchorIndex) ? anchorIndex : rowIndex;
    const start = Math.min(baseIndex, rowIndex);
    const end = Math.max(baseIndex, rowIndex);
    const rangeKeys = normalizedRowKeys
      .slice(start, end + 1)
      .filter((key) => !deletedSet.has(key));
    const next = additiveKey ? [...selectedSet, ...rangeKeys] : rangeKeys;
    return {
      selectedKeys: uniqueKeyList(next).filter((key) => normalizedRowKeys.includes(key)),
      anchorIndex: baseIndex,
    };
  }

  const key = normalizedRowKeys[rowIndex];
  if (additiveKey) {
    if (selectedSet.has(key)) selectedSet.delete(key);
    else selectedSet.add(key);
    return {
      selectedKeys: uniqueKeyList(selectedSet).filter((item) => normalizedRowKeys.includes(item)),
      anchorIndex: rowIndex,
    };
  }

  return {
    selectedKeys: [key],
    anchorIndex: rowIndex,
  };
}

export function resolveSelectAllRowKeys({ rowKeys = [], selectedKeys = [], deletedKeys = [] } = {}) {
  const deletedSet = new Set(normalizeKeyList(deletedKeys));
  const selectableKeys = normalizeKeyList(rowKeys).filter((key) => !deletedSet.has(key));
  const selectedSet = new Set(normalizeKeyList(selectedKeys));
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selectedSet.has(key));
  return allSelected ? [] : selectableKeys;
}

function formatTsvValue(value) {
  const text = String(value ?? "");
  if (!/[\t\r\n"]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildSelectedRowsTsv({ rows = [], columns = [], rowKeys = [], selectedKeys = [] } = {}) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const normalizedColumns = normalizeKeyList(columns);
  const selectedSet = new Set(normalizeKeyList(selectedKeys));
  const normalizedRowKeys = normalizeKeyList(rowKeys);

  return normalizedRows
    .map((row, index) => ({ row, key: normalizedRowKeys[index] }))
    .filter((item) => item.key && selectedSet.has(item.key))
    .map(({ row }) => normalizedColumns.map((column) => formatTsvValue(row?.[column])).join("\t"))
    .join("\r\n");
}

export function buildBatchCellChanges({
  rowKeys = [],
  selectedKeys = [],
  deletedKeys = [],
  columnName = "",
  value = "",
} = {}) {
  const column = String(columnName || "");
  if (!column) return [];
  const deletedSet = new Set(normalizeKeyList(deletedKeys));
  const selectedSet = new Set(normalizeKeyList(selectedKeys));
  return normalizeKeyList(rowKeys)
    .filter((rowKey) => selectedSet.has(rowKey) && !deletedSet.has(rowKey))
    .map((rowKey) => ({ rowKey, columnName: column, value: String(value ?? "") }));
}
