function toPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function computeAutoCollapsedWidth({
  headerTextWidth,
  horizontalPadding = 16,
  badgeAllowance = 16,
  resizeHandleAllowance = 8,
  minimumWidth = 0,
} = {}) {
  const width = Math.round(
    toPositiveNumber(headerTextWidth) +
    toPositiveNumber(horizontalPadding) +
    toPositiveNumber(badgeAllowance) +
    toPositiveNumber(resizeHandleAllowance),
  );
  return Math.max(toPositiveNumber(minimumWidth), width);
}

export function toggleColumnCollapsedState({
  columnName,
  currentWidth,
  collapsedWidth,
  collapsedColumns = {},
  restoreWidths = {},
  fallbackWidth = currentWidth,
} = {}) {
  const nextCollapsedColumns = { ...(collapsedColumns || {}) };
  const nextRestoreWidths = { ...(restoreWidths || {}) };
  const key = String(columnName || "");

  if (!key) {
    return {
      isCollapsed: false,
      nextWidth: toPositiveNumber(fallbackWidth),
      nextCollapsedColumns,
      nextRestoreWidths,
    };
  }

  if (nextCollapsedColumns[key]) {
    const restoredWidth = toPositiveNumber(nextRestoreWidths[key], toPositiveNumber(fallbackWidth));
    delete nextCollapsedColumns[key];
    delete nextRestoreWidths[key];
    return {
      isCollapsed: false,
      nextWidth: restoredWidth,
      nextCollapsedColumns,
      nextRestoreWidths,
    };
  }

  nextCollapsedColumns[key] = true;
  nextRestoreWidths[key] = toPositiveNumber(currentWidth, toPositiveNumber(fallbackWidth));
  return {
    isCollapsed: true,
    nextWidth: toPositiveNumber(collapsedWidth),
    nextCollapsedColumns,
    nextRestoreWidths,
  };
}

export function clearCollapsedColumnState({
  columnName,
  collapsedColumns = {},
  restoreWidths = {},
} = {}) {
  const nextCollapsedColumns = { ...(collapsedColumns || {}) };
  const nextRestoreWidths = { ...(restoreWidths || {}) };
  const key = String(columnName || "");

  if (key) {
    delete nextCollapsedColumns[key];
    delete nextRestoreWidths[key];
  }

  return {
    nextCollapsedColumns,
    nextRestoreWidths,
  };
}
