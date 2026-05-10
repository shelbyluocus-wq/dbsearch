// tableGridFocus.js
//
// Pure functions for Navicat-style grid focus navigation in edit mode.
//
// The grid is logically split into two vertically-stacked regions that share
// the same column list:
//
//   rowKind === "page"    → existing rows on the current page (pageRowCount rows)
//   rowKind === "insert"  → pending new rows being inserted (insertRowCount rows)
//
// The focus model is a triple { rowKind, rowIndex, columnName }. All helpers
// here are pure — they take explicit parameters and return a new focus triple
// (or null when the move is impossible) so they can be unit tested without
// pulling in Vue or DOM state.

function toSafeColumns(columns) {
  return (Array.isArray(columns) ? columns : [])
    .map((column) => String(column || ""))
    .filter(Boolean);
}

function toSafeNonNegativeInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function inRangeOfKind(rowKind, rowIndex, pageCount, insertCount) {
  if (rowKind === "page") {
    return Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < pageCount;
  }
  if (rowKind === "insert") {
    return Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < insertCount;
  }
  return false;
}

/**
 * Resolve a focus move in the edit grid.
 *
 * @param {Object}   params
 * @param {"page"|"insert"|null} params.rowKind
 * @param {number}   params.rowIndex
 * @param {string}   params.columnName
 * @param {string[]} params.columns
 * @param {number}   params.pageRowCount
 * @param {number}   params.insertRowCount
 * @param {"up"|"down"|"left"|"right"|"home"|"end"|"pageUp"|"pageDown"} params.action
 * @returns {{rowKind: "page"|"insert", rowIndex: number, columnName: string}|null}
 */
export function resolveFocusMove({
  rowKind = null,
  rowIndex = -1,
  columnName = "",
  columns = [],
  pageRowCount = 0,
  insertRowCount = 0,
  action = "",
} = {}) {
  const safeColumns = toSafeColumns(columns);
  const pageCount = toSafeNonNegativeInt(pageRowCount);
  const insertCount = toSafeNonNegativeInt(insertRowCount);
  const colCount = safeColumns.length;

  if (colCount === 0) return null;
  const curCol = safeColumns.indexOf(String(columnName || ""));
  if (curCol < 0) return null;
  if (!inRangeOfKind(rowKind, rowIndex, pageCount, insertCount)) return null;

  const normalizedAction = String(action || "").toLowerCase();
  const curRow = Number(rowIndex);

  if (normalizedAction === "left") {
    const nextCol = (curCol - 1 + colCount) % colCount;
    return { rowKind, rowIndex: curRow, columnName: safeColumns[nextCol] };
  }
  if (normalizedAction === "right") {
    const nextCol = (curCol + 1) % colCount;
    return { rowKind, rowIndex: curRow, columnName: safeColumns[nextCol] };
  }
  if (normalizedAction === "home") {
    return { rowKind, rowIndex: curRow, columnName: safeColumns[0] };
  }
  if (normalizedAction === "end") {
    return { rowKind, rowIndex: curRow, columnName: safeColumns[colCount - 1] };
  }

  if (normalizedAction === "up") {
    if (rowKind === "page") {
      if (curRow > 0) {
        return { rowKind: "page", rowIndex: curRow - 1, columnName: safeColumns[curCol] };
      }
      return null;
    }
    // rowKind === "insert"
    if (curRow > 0) {
      return { rowKind: "insert", rowIndex: curRow - 1, columnName: safeColumns[curCol] };
    }
    if (pageCount > 0) {
      return { rowKind: "page", rowIndex: pageCount - 1, columnName: safeColumns[curCol] };
    }
    return null;
  }

  if (normalizedAction === "down") {
    if (rowKind === "page") {
      if (curRow + 1 < pageCount) {
        return { rowKind: "page", rowIndex: curRow + 1, columnName: safeColumns[curCol] };
      }
      if (insertCount > 0) {
        return { rowKind: "insert", rowIndex: 0, columnName: safeColumns[curCol] };
      }
      return null;
    }
    // rowKind === "insert"
    if (curRow + 1 < insertCount) {
      return { rowKind: "insert", rowIndex: curRow + 1, columnName: safeColumns[curCol] };
    }
    return null;
  }

  if (normalizedAction === "pageup") {
    if (rowKind === "insert") {
      if (pageCount > 0) {
        return { rowKind: "page", rowIndex: 0, columnName: safeColumns[curCol] };
      }
      return { rowKind: "insert", rowIndex: 0, columnName: safeColumns[curCol] };
    }
    return { rowKind: "page", rowIndex: 0, columnName: safeColumns[curCol] };
  }

  if (normalizedAction === "pagedown") {
    if (rowKind === "page") {
      if (insertCount > 0) {
        return { rowKind: "insert", rowIndex: insertCount - 1, columnName: safeColumns[curCol] };
      }
      return { rowKind: "page", rowIndex: pageCount - 1, columnName: safeColumns[curCol] };
    }
    return { rowKind: "insert", rowIndex: insertCount - 1, columnName: safeColumns[curCol] };
  }

  return null;
}

/**
 * Clamp an existing focus triple back inside a newly-sized grid. Useful when
 * the page data changes (pagination, insert removal) and the previously held
 * focus may be out of bounds.
 *
 * @returns {{rowKind: "page"|"insert", rowIndex: number, columnName: string}|null}
 */
export function clampFocus({
  rowKind = null,
  rowIndex = -1,
  columnName = "",
  columns = [],
  pageRowCount = 0,
  insertRowCount = 0,
} = {}) {
  const safeColumns = toSafeColumns(columns);
  if (safeColumns.length === 0) return null;
  const pageCount = toSafeNonNegativeInt(pageRowCount);
  const insertCount = toSafeNonNegativeInt(insertRowCount);
  const colIdx = safeColumns.indexOf(String(columnName || ""));
  const col = colIdx >= 0 ? safeColumns[colIdx] : safeColumns[0];

  if (rowKind === "page" && pageCount > 0) {
    const idx = Math.min(Math.max(Number(rowIndex) || 0, 0), pageCount - 1);
    return { rowKind: "page", rowIndex: idx, columnName: col };
  }
  if (rowKind === "insert" && insertCount > 0) {
    const idx = Math.min(Math.max(Number(rowIndex) || 0, 0), insertCount - 1);
    return { rowKind: "insert", rowIndex: idx, columnName: col };
  }
  if (pageCount > 0) return { rowKind: "page", rowIndex: 0, columnName: col };
  if (insertCount > 0) return { rowKind: "insert", rowIndex: 0, columnName: col };
  return null;
}

/**
 * Classify a KeyboardEvent-like object into an action accepted by
 * resolveFocusMove, or null if the key is not a grid-focus move key.
 *
 * @param {{key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean}} event
 * @returns {string|null}
 */
export function classifyFocusKey(event = {}) {
  const key = String(event.key || "");
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  if (key === "Home") return "home";
  if (key === "End") return "end";
  if (key === "PageUp") return "pageUp";
  if (key === "PageDown") return "pageDown";
  return null;
}
