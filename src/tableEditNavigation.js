export function resolveEditNavigation({
  rowIndex = -1,
  columnName = "",
  columns = [],
  rowCount = 0,
  action = "",
} = {}) {
  const normalizedColumns = (Array.isArray(columns) ? columns : [])
    .map((column) => String(column || ""))
    .filter(Boolean);
  const currentRow = Number(rowIndex);
  const totalRows = Number(rowCount);
  const currentColumnIndex = normalizedColumns.indexOf(String(columnName || ""));

  if (
    !Number.isInteger(currentRow) ||
    currentRow < 0 ||
    !Number.isInteger(totalRows) ||
    totalRows <= 0 ||
    currentRow >= totalRows ||
    currentColumnIndex < 0
  ) {
    return null;
  }

  if (action === "enter") {
    return currentRow + 1 < totalRows
      ? { rowIndex: currentRow + 1, columnName: normalizedColumns[currentColumnIndex] }
      : null;
  }

  if (action === "shift-enter") {
    return currentRow > 0
      ? { rowIndex: currentRow - 1, columnName: normalizedColumns[currentColumnIndex] }
      : null;
  }

  if (action === "tab") {
    if (currentColumnIndex + 1 < normalizedColumns.length) {
      return { rowIndex: currentRow, columnName: normalizedColumns[currentColumnIndex + 1] };
    }
    return currentRow + 1 < totalRows
      ? { rowIndex: currentRow + 1, columnName: normalizedColumns[0] }
      : null;
  }

  if (action === "shift-tab") {
    if (currentColumnIndex > 0) {
      return { rowIndex: currentRow, columnName: normalizedColumns[currentColumnIndex - 1] };
    }
    return currentRow > 0
      ? { rowIndex: currentRow - 1, columnName: normalizedColumns[normalizedColumns.length - 1] }
      : null;
  }

  return null;
}
