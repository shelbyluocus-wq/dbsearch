function toPositiveInteger(value, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveColumnWidth(column, getColumnWidth, fallbackWidth) {
  const name = column?.column_name ?? "";
  const width = typeof getColumnWidth === "function" ? getColumnWidth(name, column) : fallbackWidth;
  return toPositiveInteger(width, fallbackWidth);
}

export function buildFastGridScrollSize({
  totalRows = 0,
  rowHeight = 31,
  headerHeight = 34,
  rowNumberWidth = 52,
  columns = [],
  getColumnWidth,
  fallbackColumnWidth = 120,
} = {}) {
  const rows = Math.max(0, Math.floor(Number(totalRows) || 0));
  const bodyHeight = rows * toPositiveInteger(rowHeight, 31);
  const bodyWidth = (Array.isArray(columns) ? columns : []).reduce(
    (sum, column) => sum + resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth),
    0,
  );
  return {
    width: toPositiveInteger(rowNumberWidth, 52) + bodyWidth,
    height: toPositiveInteger(headerHeight, 34) + bodyHeight,
  };
}

export function resolveFastGridCellScrollTarget({
  rowIndex = 0,
  columnName = "",
  rowHeight = 31,
  rowNumberWidth = 52,
  columns = [],
  getColumnWidth,
  fallbackColumnWidth = 120,
  currentScrollLeft = 0,
  currentScrollTop = 0,
  frozenColumnName = "",
  frozenRowIndex = null,
} = {}) {
  const safeRowIndex = Math.max(0, Math.floor(Number(rowIndex) || 0));
  const safeColumnName = String(columnName ?? "");
  const rowPx = toPositiveInteger(rowHeight, 31);
  const rowHandleWidth = toPositiveInteger(rowNumberWidth, 52);
  const list = Array.isArray(columns) ? columns : [];
  const frozenIndex = list.findIndex((column) => String(column?.column_name ?? "") === String(frozenColumnName ?? ""));
  let cursor = rowHandleWidth;
  let scrollLeft = Math.max(0, Number(currentScrollLeft) || 0);
  let scrollTop = Math.max(0, Number(currentScrollTop) || 0);

  for (let index = 0; index < list.length; index += 1) {
    const column = list[index];
    const width = resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth);
    if (String(column?.column_name ?? "") === safeColumnName) {
      if (frozenIndex < 0 || index > frozenIndex) scrollLeft = Math.max(0, cursor - rowHandleWidth);
      break;
    }
    cursor += width;
  }

  if (!Number.isInteger(frozenRowIndex) || safeRowIndex > frozenRowIndex) {
    scrollTop = safeRowIndex * rowPx;
  }

  return {
    rowIndex: safeRowIndex,
    columnName: safeColumnName,
    scrollTop,
    scrollLeft,
  };
}

export function getVisibleFastGridRows({
  totalRows = 0,
  rowHeight = 31,
  scrollTop = 0,
  clientHeight = 0,
  overscan = 2,
  frozenRowIndex = null,
} = {}) {
  void frozenRowIndex;
  const total = Math.max(0, Math.floor(Number(totalRows) || 0));
  if (total === 0) return { start: 0, end: -1 };
  const rowPx = toPositiveInteger(rowHeight, 31);
  const extra = Math.max(0, Math.floor(Number(overscan) || 0));
  const first = Math.floor(Math.max(0, Number(scrollTop) || 0) / rowPx);
  const last = Math.ceil((Math.max(0, Number(scrollTop) || 0) + Math.max(0, Number(clientHeight) || 0)) / rowPx);
  return {
    start: clamp(first - extra, 0, total - 1),
    end: clamp(last + extra, 0, total - 1),
  };
}

export function getVisibleFastGridColumns({
  columns = [],
  scrollLeft = 0,
  clientWidth = 0,
  rowNumberWidth = 52,
  getColumnWidth,
  fallbackColumnWidth = 120,
  overscan = 1,
  frozenColumnName = "",
} = {}) {
  const list = Array.isArray(columns) ? columns : [];
  const left = Math.max(0, Number(scrollLeft) || 0);
  const right = left + Math.max(0, Number(clientWidth) || 0);
  const rowHandleWidth = toPositiveInteger(rowNumberWidth, 52);
  const extra = Math.max(0, Math.floor(Number(overscan) || 0));
  const frozenIndex = list.findIndex((column) => String(column?.column_name ?? "") === String(frozenColumnName ?? ""));
  const visible = [];
  let cursor = rowHandleWidth;

  list.forEach((column, index) => {
    const width = resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth);
    const columnLeft = cursor;
    const columnRight = cursor + width;
    const frozen = frozenIndex >= 0 && index <= frozenIndex;
    if (frozen) {
      visible.push({ column, index, x: columnLeft, width, frozen: true, edge: index === frozenIndex });
    } else if (columnRight >= left - extra * width && columnLeft <= right + extra * width) {
      const item = { column, index, x: columnLeft, width };
      if (frozenIndex >= 0) item.frozen = false;
      visible.push(item);
    }
    cursor = columnRight;
  });

  return visible;
}

export function hitTestFastGrid({
  x = 0,
  y = 0,
  scrollLeft = 0,
  scrollTop = 0,
  rowHeight = 31,
  headerHeight = 34,
  rowNumberWidth = 52,
  totalRows = 0,
  columns = [],
  getColumnWidth,
  fallbackColumnWidth = 120,
  frozenColumnName = "",
  frozenRowIndex = null,
} = {}) {
  const headerPx = toPositiveInteger(headerHeight, 34);
  const rowHandleWidth = toPositiveInteger(rowNumberWidth, 52);
  const rowPx = toPositiveInteger(rowHeight, 31);
  const pointX = Math.max(0, Number(x) || 0);
  const pointY = Math.max(0, Number(y) || 0);
  const total = Math.max(0, Math.floor(Number(totalRows) || 0));
  const virtualX = pointX + Math.max(0, Number(scrollLeft) || 0);
  const frozenColumn = findFrozenColumnAtX({ columns, x: pointX, rowNumberWidth: rowHandleWidth, getColumnWidth, fallbackColumnWidth, frozenColumnName });

  if (pointY < headerPx) {
    if (pointX < rowHandleWidth) return { region: "corner" };
    if (frozenColumn) return { region: "header", ...frozenColumn, frozenColumn: true };
    const column = findColumnAtX({ columns, x: virtualX, rowNumberWidth: rowHandleWidth, getColumnWidth, fallbackColumnWidth });
    return column ? { region: "header", ...column } : { region: "empty" };
  }

  const frozenRow = findFrozenRowAtY({ y: pointY, headerHeight: headerPx, rowHeight: rowPx, totalRows: total, frozenRowIndex });
  const rowIndex = frozenRow ?? Math.floor((pointY - headerPx + Math.max(0, Number(scrollTop) || 0)) / rowPx);
  if (rowIndex < 0 || rowIndex >= total) return { region: "empty" };
  if (pointX < rowHandleWidth) {
    const result = { region: "row-header", rowIndex };
    if (frozenRow !== null) result.frozenRow = true;
    return result;
  }

  const column = frozenColumn ?? findColumnAtX({ columns, x: virtualX, rowNumberWidth: rowHandleWidth, getColumnWidth, fallbackColumnWidth });
  if (!column) return { region: "empty" };
  const result = { region: "cell", rowIndex, ...column };
  if (frozenColumn) result.frozenColumn = true;
  if (frozenRow !== null) result.frozenRow = true;
  return result;
}

export function hitTestFastGridColumnResize({
  x = 0,
  y = 0,
  scrollLeft = 0,
  headerHeight = 34,
  rowNumberWidth = 52,
  columns = [],
  getColumnWidth,
  fallbackColumnWidth = 120,
  handleWidth = 6,
  frozenColumnName = "",
} = {}) {
  const headerPx = toPositiveInteger(headerHeight, 34);
  const pointY = Math.max(0, Number(y) || 0);
  if (pointY >= headerPx) return null;

  const pointX = Math.max(0, Number(x) || 0);
  const virtualX = pointX + Math.max(0, Number(scrollLeft) || 0);
  const rowHandleWidth = toPositiveInteger(rowNumberWidth, 52);
  const edgeTolerance = Math.max(1, Number(handleWidth) || 6);
  let cursor = rowHandleWidth;
  const list = Array.isArray(columns) ? columns : [];
  const frozenIndex = list.findIndex((column) => String(column?.column_name ?? "") === String(frozenColumnName ?? ""));

  for (let index = 0; index <= frozenIndex; index += 1) {
    const column = list[index];
    const width = resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth);
    const edgeX = cursor + width;
    if (Math.abs(pointX - edgeX) <= edgeTolerance) {
      return { columnIndex: index, columnName: column?.column_name ?? "", edgeX, frozenColumn: true };
    }
    cursor = edgeX;
  }

  cursor = rowHandleWidth;
  for (let index = 0; index < list.length; index += 1) {
    const column = list[index];
    const width = resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth);
    const edgeX = cursor + width;
    if (Math.abs(virtualX - edgeX) <= edgeTolerance) {
      return { columnIndex: index, columnName: column?.column_name ?? "", edgeX };
    }
    cursor = edgeX;
  }
  return null;
}

export function resolveFastGridColumnResizeCursor(options = {}) {
  return hitTestFastGridColumnResize(options) ? "col-resize" : "default";
}

export function truncateFastGridText(value, maxWidth, context) {
  const text = String(value ?? "");
  const limit = Math.max(0, Number(maxWidth) || 0);
  const measureText = typeof context?.measureText === "function" ? (input) => context.measureText(input).width : null;
  if (!text || limit <= 0) return "";
  if (!measureText || measureText(text) <= limit) return text;
  const ellipsis = "…";
  let result = "";
  for (const char of text) {
    if (measureText(`${result}${char}${ellipsis}`) > limit) break;
    result += char;
  }
  return result ? `${result}${ellipsis}` : ellipsis;
}

export function buildFastGridDrawModel({
  rows = [],
  rowIndexes = [],
  rowStartIndex = 0,
  visibleColumns = [],
  rowHeight = 31,
  headerHeight = 34,
  scrollTop = 0,
  scrollLeft = 0,
  frozenRowIndex = null,
  focusedCell = null,
  isCellHit = () => false,
  formatCellValue = (value) => String(value ?? ""),
} = {}) {
  const rowPx = toPositiveInteger(rowHeight, 31);
  const headerPx = toPositiveInteger(headerHeight, 34);
  const top = Math.max(0, Number(scrollTop) || 0);
  const left = Math.max(0, Number(scrollLeft) || 0);
  const firstRow = Math.max(0, Math.floor(Number(rowStartIndex) || 0));
  const frozenRowBoundary = Number.isInteger(frozenRowIndex) && frozenRowIndex >= 0 ? frozenRowIndex : null;
  const list = Array.isArray(rows) ? rows : [];
  const columns = Array.isArray(visibleColumns) ? visibleColumns : [];

  const cells = [];
  list.forEach((row, localIndex) => {
    const rowIndex = Number.isInteger(rowIndexes[localIndex]) ? rowIndexes[localIndex] : firstRow + localIndex;
    const frozenRow = frozenRowBoundary !== null && rowIndex <= frozenRowBoundary;
    const y = frozenRow ? headerPx + rowIndex * rowPx : headerPx + rowIndex * rowPx - top;
    columns.forEach(({ column, x, width, frozen, edge }) => {
      const columnName = column?.column_name ?? "";
      const cell = {
        rowIndex,
        columnName,
        text: formatCellValue(row?.[columnName], row, column),
        x: frozen ? x : x - left,
        y,
        width,
        height: rowPx,
      };
      if (frozen) {
        cell.frozenColumn = true;
        cell.frozenColumnEdge = Boolean(edge);
      }
      if (frozenRow) {
        cell.frozenRow = true;
        cell.frozenRowEdge = rowIndex === frozenRowBoundary;
      }
      if (focusedCell?.rowIndex === rowIndex && focusedCell?.columnName === columnName) cell.focused = true;
      if (isCellHit({ row, rowIndex, columnName, column })) cell.hit = true;
      cells.push(cell);
    });
  });

  return { cells };
}

function findColumnAtX({ columns, x, rowNumberWidth, getColumnWidth, fallbackColumnWidth }) {
  let cursor = rowNumberWidth;
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    const width = resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth);
    if (x >= cursor && x < cursor + width) {
      return { columnIndex: index, columnName: column.column_name };
    }
    cursor += width;
  }
  return null;
}

function findFrozenColumnAtX({ columns, x, rowNumberWidth, getColumnWidth, fallbackColumnWidth, frozenColumnName }) {
  const list = Array.isArray(columns) ? columns : [];
  const frozenIndex = list.findIndex((column) => String(column?.column_name ?? "") === String(frozenColumnName ?? ""));
  if (frozenIndex < 0) return null;
  let cursor = rowNumberWidth;
  for (let index = 0; index <= frozenIndex; index += 1) {
    const column = list[index];
    const width = resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth);
    if (x >= cursor && x < cursor + width) {
      return { columnIndex: index, columnName: column.column_name };
    }
    cursor += width;
  }
  return null;
}

function findFrozenRowAtY({ y, headerHeight, rowHeight, totalRows, frozenRowIndex }) {
  if (!Number.isInteger(frozenRowIndex) || frozenRowIndex < 0 || frozenRowIndex >= totalRows) return null;
  const offset = y - headerHeight;
  if (offset < 0) return null;
  const rowIndex = Math.floor(offset / rowHeight);
  return rowIndex <= frozenRowIndex ? rowIndex : null;
}
