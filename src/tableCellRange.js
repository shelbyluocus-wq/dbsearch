// tableCellRange.js
//
// Pure functions for the rectangular cell-selection model used in the
// Navicat-style edit mode. The model has two anchors:
//
//   anchor: fixed corner (set on mousedown or first Shift+arrow)
//   head:   moving corner (follows the cursor / Shift+arrow)
//
// Each anchor is a triple { rowKind: "page"|"insert", rowIndex, columnName }.
// All helpers here are pure so they can be unit tested without Vue/DOM.

function toSafeColumns(columns) {
  return (Array.isArray(columns) ? columns : [])
    .map((column) => String(column || ""))
    .filter(Boolean);
}

function toSafeNonNegInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function kindRowCount(rowKind, pageCount, insertCount) {
  if (rowKind === "page") return pageCount;
  if (rowKind === "insert") return insertCount;
  return 0;
}

function clampRowIndex(value, rowCount) {
  const n = Number(value) || 0;
  if (rowCount <= 0) return 0;
  return Math.min(Math.max(n, 0), rowCount - 1);
}

function isValidCellPoint(point, columns) {
  if (!point || typeof point !== "object") return false;
  if (point.rowKind !== "page" && point.rowKind !== "insert") return false;
  if (!Number.isInteger(point.rowIndex) || point.rowIndex < 0) return false;
  return columns.includes(String(point.columnName || ""));
}

/**
 * Normalise an (anchor, head) pair into a canonical rectangle within a single
 * rowKind. If head.rowKind differs from anchor.rowKind the head is clamped
 * into anchor's kind so that the selection stays rectangular.
 *
 * @returns {{rowKind:"page"|"insert", rowStart:number, rowEnd:number,
 *            colStart:number, colEnd:number, columns:string[]}|null}
 */
export function normalizeRange({
  anchor = null,
  head = null,
  columns = [],
  pageCount = 0,
  insertCount = 0,
} = {}) {
  const safeColumns = toSafeColumns(columns);
  if (safeColumns.length === 0) return null;
  const pc = toSafeNonNegInt(pageCount);
  const ic = toSafeNonNegInt(insertCount);

  if (!isValidCellPoint(anchor, safeColumns)) return null;
  const effHead = head && isValidCellPoint(head, safeColumns) ? head : anchor;

  const rowKind = anchor.rowKind;
  const rowCount = kindRowCount(rowKind, pc, ic);
  if (rowCount <= 0) return null;
  if (anchor.rowIndex >= rowCount) return null;

  const anchorRow = anchor.rowIndex;
  // If head is in a different kind we clamp into anchor's kind. If moving
  // from a page anchor into insert below, the head pins to the last page row
  // (and vice-versa).
  let headRow = effHead.rowIndex;
  if (effHead.rowKind !== rowKind) {
    if (rowKind === "page" && effHead.rowKind === "insert") {
      headRow = rowCount - 1;
    } else if (rowKind === "insert" && effHead.rowKind === "page") {
      headRow = 0;
    }
  }
  headRow = clampRowIndex(headRow, rowCount);

  const anchorCol = safeColumns.indexOf(String(anchor.columnName));
  const headCol = safeColumns.indexOf(String(effHead.columnName));
  const colA = anchorCol >= 0 ? anchorCol : 0;
  const colB = headCol >= 0 ? headCol : colA;

  return {
    rowKind,
    rowStart: Math.min(anchorRow, headRow),
    rowEnd: Math.max(anchorRow, headRow),
    colStart: Math.min(colA, colB),
    colEnd: Math.max(colA, colB),
    columns: safeColumns,
  };
}

/**
 * Compute the next (anchor, head) pair when the user presses Shift + arrow
 * (or Shift + Home/End). Head moves within anchor's rowKind and is clamped to
 * the visible grid; columns do NOT wrap (Navicat behaviour).
 */
export function expandRange({
  anchor = null,
  head = null,
  columns = [],
  pageCount = 0,
  insertCount = 0,
  direction = "",
} = {}) {
  const safeColumns = toSafeColumns(columns);
  if (safeColumns.length === 0) return null;
  const pc = toSafeNonNegInt(pageCount);
  const ic = toSafeNonNegInt(insertCount);
  if (!isValidCellPoint(anchor, safeColumns)) return null;

  const currentHead = head && isValidCellPoint(head, safeColumns)
    ? { ...head }
    : { ...anchor };

  const headRowCount = kindRowCount(currentHead.rowKind, pc, ic);
  if (headRowCount <= 0) return null;
  currentHead.rowIndex = clampRowIndex(currentHead.rowIndex, headRowCount);

  const headColIdx = safeColumns.indexOf(String(currentHead.columnName));
  const colIdx = headColIdx >= 0 ? headColIdx : 0;
  const colCount = safeColumns.length;

  const dir = String(direction || "").toLowerCase();
  let nextRow = currentHead.rowIndex;
  let nextColIdx = colIdx;

  switch (dir) {
    case "up":
      if (currentHead.rowIndex > 0) {
        nextRow = currentHead.rowIndex - 1;
      } else if (currentHead.rowKind === "insert" && pc > 0) {
        return {
          anchor: { ...anchor },
          head: {
            rowKind: "page",
            rowIndex: pc - 1,
            columnName: safeColumns[colIdx],
          },
        };
      } else {
        return null;
      }
      break;
    case "down":
      if (currentHead.rowIndex < headRowCount - 1) {
        nextRow = currentHead.rowIndex + 1;
      } else if (currentHead.rowKind === "page" && ic > 0) {
        return {
          anchor: { ...anchor },
          head: {
            rowKind: "insert",
            rowIndex: 0,
            columnName: safeColumns[colIdx],
          },
        };
      } else {
        return null;
      }
      break;
    case "left":
      nextColIdx = Math.max(0, colIdx - 1);
      break;
    case "right":
      nextColIdx = Math.min(colCount - 1, colIdx + 1);
      break;
    case "home":
      nextColIdx = 0;
      break;
    case "end":
      nextColIdx = colCount - 1;
      break;
    default:
      return null;
  }

  return {
    anchor: { ...anchor },
    head: {
      rowKind: currentHead.rowKind,
      rowIndex: nextRow,
      columnName: safeColumns[nextColIdx],
    },
  };
}

/**
 * Emit the list of cells contained in a normalized range.
 * @returns {{rowKind:string, rowIndex:number, columnName:string}[]}
 */
export function enumerateRangeCells(range) {
  if (!range || !Array.isArray(range.columns)) return [];
  const cells = [];
  for (let r = range.rowStart; r <= range.rowEnd; r++) {
    for (let c = range.colStart; c <= range.colEnd; c++) {
      cells.push({
        rowKind: range.rowKind,
        rowIndex: r,
        columnName: range.columns[c],
      });
    }
  }
  return cells;
}

/**
 * Return the pixel-free dimensions of a normalized range.
 */
export function rangeSize(range) {
  if (!range) return { rows: 0, cols: 0 };
  return {
    rows: range.rowEnd - range.rowStart + 1,
    cols: range.colEnd - range.colStart + 1,
  };
}

/**
 * Build a list of batch cell updates that set every cell in the range to a
 * single value. Primarily used for printable-char overwrite and the Delete key.
 */
export function fillRangeValue(range, value) {
  return enumerateRangeCells(range).map((cell) => ({
    ...cell,
    value: String(value ?? ""),
  }));
}

/**
 * Build a list of batch cell updates that copy the top row of the range
 * downwards through the rest of the range (Ctrl+D).
 *
 * @param range normalized range
 * @param getValue function(rowKind, rowIndex, columnName) → current cell string
 */
export function buildFillDownChanges(range, getValue) {
  if (!range) return [];
  const changes = [];
  const reader = typeof getValue === "function" ? getValue : () => "";
  for (let c = range.colStart; c <= range.colEnd; c++) {
    const columnName = range.columns[c];
    const sourceValue = String(
      reader(range.rowKind, range.rowStart, columnName) ?? "",
    );
    for (let r = range.rowStart + 1; r <= range.rowEnd; r++) {
      changes.push({
        rowKind: range.rowKind,
        rowIndex: r,
        columnName,
        value: sourceValue,
      });
    }
  }
  return changes;
}

/**
 * Parse a TSV-ish clipboard string into a matrix. Supports:
 *  - Tabs as column separators
 *  - CRLF / LF / CR as row separators
 *  - Quoted fields with `""` escapes for embedded tabs / newlines / quotes
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseClipboardTsv(text) {
  const src = String(text ?? "");
  if (src.length === 0) return [];
  const rows = [];
  let row = [];
  let field = "";
  let inQuote = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuote = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuote = true;
      i++;
      continue;
    }
    if (ch === "\t") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      if (src[i] === "\n") i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Flush trailing field/row unless the last char was a newline that already
  // pushed the terminating row.
  row.push(field);
  // Trailing-newline heuristic: if we just pushed a single empty cell after a
  // newline, drop it so "a\n" parses as [["a"]].
  const justClosed = src.endsWith("\n") || src.endsWith("\r");
  if (justClosed && row.length === 1 && row[0] === "") {
    // skip pushing empty trailing row
  } else {
    rows.push(row);
  }
  return rows;
}

/**
 * Build the changeset (and possibly an expanded range) when pasting a TSV
 * matrix into an existing range.
 *
 *  - If the range is exactly 1×1, the paste expands starting at the anchor
 *    to the TSV's dimensions (clamped to the grid's rowKind and column count).
 *  - Otherwise the TSV is tiled to fill the selection.
 *
 * @returns {{
 *   changes: Array<{rowKind, rowIndex, columnName, value}>,
 *   newRange: {rowKind, rowStart, rowEnd, colStart, colEnd, columns} | null,
 * }}
 */
export function applyTsvToRange({
  tsv = [],
  range = null,
  pageCount = 0,
  insertCount = 0,
} = {}) {
  if (!range || !Array.isArray(tsv) || tsv.length === 0) {
    return { changes: [], newRange: null };
  }
  const tRows = tsv.length;
  const tCols = Math.max(...tsv.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
  if (tCols <= 0) return { changes: [], newRange: null };

  const { rows, cols } = rangeSize(range);
  const rowCount = kindRowCount(range.rowKind, pageCount, insertCount);
  const colCount = range.columns.length;

  let targetRange = range;
  if (rows === 1 && cols === 1) {
    // Expand starting at anchor.
    const rowEnd = Math.min(rowCount - 1, range.rowStart + tRows - 1);
    const colEnd = Math.min(colCount - 1, range.colStart + tCols - 1);
    targetRange = {
      ...range,
      rowEnd,
      colEnd,
    };
  }

  const { rows: outRows, cols: outCols } = rangeSize(targetRange);
  const changes = [];
  for (let r = 0; r < outRows; r++) {
    for (let c = 0; c < outCols; c++) {
      const tr = tsv[r % tRows] || [];
      const value = tr[c % tCols] ?? "";
      changes.push({
        rowKind: targetRange.rowKind,
        rowIndex: targetRange.rowStart + r,
        columnName: targetRange.columns[targetRange.colStart + c],
        value: String(value),
      });
    }
  }

  return { changes, newRange: targetRange };
}

/**
 * Build a TSV string from a normalised range by looking up each cell's
 * current value. Used for Ctrl+C.
 */
export function buildRangeTsv(range, getValue) {
  if (!range) return "";
  const reader = typeof getValue === "function" ? getValue : () => "";
  const lines = [];
  for (let r = range.rowStart; r <= range.rowEnd; r++) {
    const cells = [];
    for (let c = range.colStart; c <= range.colEnd; c++) {
      const columnName = range.columns[c];
      cells.push(formatTsvCell(reader(range.rowKind, r, columnName)));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\r\n");
}

function formatTsvCell(value) {
  const text = String(value ?? "");
  if (!/[\t\r\n"]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
