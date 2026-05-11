export function normalizeFreezeBoundary(currentBoundary, nextBoundary) {
  return currentBoundary === nextBoundary ? null : nextBoundary;
}

export function buildFrozenColumnMeta({
  columns,
  columnWidths,
  frozenColumnName,
  leadingWidth = 0,
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
      left += Number(columnWidths[columnName]) || 0;
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
