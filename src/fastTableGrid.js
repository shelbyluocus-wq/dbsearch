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

export function getVisibleFastGridRows({
  totalRows = 0,
  rowHeight = 31,
  scrollTop = 0,
  clientHeight = 0,
  overscan = 2,
} = {}) {
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
} = {}) {
  const list = Array.isArray(columns) ? columns : [];
  const left = Math.max(0, Number(scrollLeft) || 0);
  const right = left + Math.max(0, Number(clientWidth) || 0);
  const rowHandleWidth = toPositiveInteger(rowNumberWidth, 52);
  const extra = Math.max(0, Math.floor(Number(overscan) || 0));
  const visible = [];
  let cursor = rowHandleWidth;

  list.forEach((column, index) => {
    const width = resolveColumnWidth(column, getColumnWidth, fallbackColumnWidth);
    const columnLeft = cursor;
    const columnRight = cursor + width;
    if (columnRight >= left - extra * width && columnLeft <= right + extra * width) {
      visible.push({ column, index, x: columnLeft, width });
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
} = {}) {
  const headerPx = toPositiveInteger(headerHeight, 34);
  const rowHandleWidth = toPositiveInteger(rowNumberWidth, 52);
  const rowPx = toPositiveInteger(rowHeight, 31);
  const pointX = Math.max(0, Number(x) || 0);
  const pointY = Math.max(0, Number(y) || 0);
  const virtualX = pointX + Math.max(0, Number(scrollLeft) || 0);

  if (pointY < headerPx) {
    if (pointX < rowHandleWidth) return { region: "corner" };
    const column = findColumnAtX({ columns, x: virtualX, rowNumberWidth: rowHandleWidth, getColumnWidth, fallbackColumnWidth });
    return column ? { region: "header", ...column } : { region: "empty" };
  }

  const rowIndex = Math.floor((pointY - headerPx + Math.max(0, Number(scrollTop) || 0)) / rowPx);
  if (rowIndex < 0 || rowIndex >= Math.max(0, Math.floor(Number(totalRows) || 0))) return { region: "empty" };
  if (pointX < rowHandleWidth) return { region: "row-header", rowIndex };

  const column = findColumnAtX({ columns, x: virtualX, rowNumberWidth: rowHandleWidth, getColumnWidth, fallbackColumnWidth });
  return column ? { region: "cell", rowIndex, ...column } : { region: "empty" };
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
  rowStartIndex = 0,
  visibleColumns = [],
  rowHeight = 31,
  headerHeight = 34,
  scrollTop = 0,
  scrollLeft = 0,
  focusedCell = null,
  isCellHit = () => false,
  formatCellValue = (value) => String(value ?? ""),
} = {}) {
  const rowPx = toPositiveInteger(rowHeight, 31);
  const headerPx = toPositiveInteger(headerHeight, 34);
  const top = Math.max(0, Number(scrollTop) || 0);
  const left = Math.max(0, Number(scrollLeft) || 0);
  const firstRow = Math.max(0, Math.floor(Number(rowStartIndex) || 0));
  const list = Array.isArray(rows) ? rows : [];
  const columns = Array.isArray(visibleColumns) ? visibleColumns : [];

  const cells = [];
  list.forEach((row, localIndex) => {
    const rowIndex = firstRow + localIndex;
    const y = headerPx + rowIndex * rowPx - top;
    columns.forEach(({ column, x, width }) => {
      const columnName = column?.column_name ?? "";
      const cell = {
        rowIndex,
        columnName,
        text: formatCellValue(row?.[columnName], row, column),
        x: x - left,
        y,
        width,
        height: rowPx,
      };
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
