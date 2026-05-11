export function normalizeFreezeBoundary(currentBoundary, nextBoundary) {
  return currentBoundary === nextBoundary ? null : nextBoundary;
}

function resolveColumnWidth(columnName, columnWidths = {}, measuredColumnWidths = {}, fallbackWidth = 120) {
  const explicit = Number(columnWidths?.[columnName]);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const measured = Number(measuredColumnWidths?.[columnName]);
  if (Number.isFinite(measured) && measured > 0) return measured;
  const fallback = Number(fallbackWidth);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 120;
}

export function buildFrozenColumnMeta({
  columns,
  columnWidths,
  measuredColumnWidths = {},
  frozenColumnName,
  leadingWidth = 0,
  fallbackWidth = 120,
}) {
  const frozenIndex = columns.indexOf(frozenColumnName);
  let left = leadingWidth;

  return columns.reduce((meta, columnName, index) => {
    if (frozenIndex >= 0 && index <= frozenIndex) {
      meta[columnName] = {
        frozen: true,
        left,
        edge: index === frozenIndex,
      };
      left += resolveColumnWidth(columnName, columnWidths, measuredColumnWidths, fallbackWidth);
      return meta;
    }

    meta[columnName] = { frozen: false, left: null, edge: false };
    return meta;
  }, {});
}

export function buildFrozenRowMeta({
  rowCount,
  frozenRowIndex,
  headerHeight,
  rowHeight,
}) {
  const hasValidFrozenRow =
    Number.isInteger(frozenRowIndex) &&
    frozenRowIndex >= 0 &&
    frozenRowIndex < rowCount;

  return Array.from({ length: rowCount }, (_, index) => {
    if (hasValidFrozenRow && index <= frozenRowIndex) {
      return {
        frozen: true,
        top: headerHeight + index * rowHeight,
        edge: index === frozenRowIndex,
      };
    }

    return { frozen: false, top: null, edge: false };
  });
}
