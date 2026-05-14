function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function shouldApplyAdaptiveTablePageSize({
  currentPageSize,
  nextPageSize,
  fullscreenTransitioning = false,
  seamlessScrolling = false,
} = {}) {
  if (fullscreenTransitioning || seamlessScrolling) return false;
  const current = Number(currentPageSize);
  const next = Number(nextPageSize);
  return Number.isFinite(next) && next > 0 && next !== current;
}

export function resolveAdaptiveTablePageSize({
  visibleHeight,
  headerHeight,
  rowHeight,
  minRows = 1,
  maxRows = 200,
} = {}) {
  const visible = Math.round(toPositiveNumber(visibleHeight));
  const header = Math.round(toPositiveNumber(headerHeight));
  const row = Math.round(toPositiveNumber(rowHeight));
  const minimum = Math.max(1, Math.round(toPositiveNumber(minRows)) || 1);
  const maximum = Math.max(minimum, Math.round(toPositiveNumber(maxRows)) || minimum);

  if (visible <= 0 || row <= 0) return null;
  const bodyVisible = visible - header;
  if (bodyVisible <= 0) return null;

  const rows = Math.floor(bodyVisible / row);
  if (!Number.isFinite(rows) || rows <= 0) return null;

  return Math.max(minimum, Math.min(maximum, rows));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clampFloatingSchemaWindow({
  window,
  container,
  minWidth = 320,
  minHeight = 180,
  margin = 8,
} = {}) {
  const containerWidth = Math.max(0, toFiniteNumber(container?.width));
  const containerHeight = Math.max(0, toFiniteNumber(container?.height));
  const safeMargin = Math.max(0, toFiniteNumber(margin));
  const minimumWidth = Math.max(1, toFiniteNumber(minWidth, 320));
  const minimumHeight = Math.max(1, toFiniteNumber(minHeight, 180));
  const maxWidth = Math.max(minimumWidth, containerWidth - safeMargin * 2);
  const maxHeight = Math.max(minimumHeight, containerHeight - safeMargin * 2);
  const width = Math.min(maxWidth, Math.max(minimumWidth, toFiniteNumber(window?.width, minimumWidth)));
  const height = Math.min(maxHeight, Math.max(minimumHeight, toFiniteNumber(window?.height, minimumHeight)));
  const maxLeft = Math.max(safeMargin, containerWidth - safeMargin - width);
  const maxTop = Math.max(safeMargin, containerHeight - safeMargin - height);
  const left = Math.min(maxLeft, Math.max(safeMargin, toFiniteNumber(window?.left, safeMargin)));
  const top = Math.min(maxTop, Math.max(safeMargin, toFiniteNumber(window?.top, safeMargin)));

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function resolveFloatingSchemaDrag({
  startWindow,
  startPointer,
  pointer,
  container,
  minWidth = 320,
  minHeight = 180,
  margin = 8,
} = {}) {
  const dx = toFiniteNumber(pointer?.x) - toFiniteNumber(startPointer?.x);
  const dy = toFiniteNumber(pointer?.y) - toFiniteNumber(startPointer?.y);
  return clampFloatingSchemaWindow({
    window: {
      left: toFiniteNumber(startWindow?.left) + dx,
      top: toFiniteNumber(startWindow?.top) + dy,
      width: startWindow?.width,
      height: startWindow?.height,
    },
    container,
    minWidth,
    minHeight,
    margin,
  });
}

export function resolveFloatingSchemaResize({
  startWindow,
  startPointer,
  pointer,
  container,
  minWidth = 320,
  minHeight = 180,
  margin = 8,
} = {}) {
  const dx = toFiniteNumber(pointer?.x) - toFiniteNumber(startPointer?.x);
  const dy = toFiniteNumber(pointer?.y) - toFiniteNumber(startPointer?.y);
  const safeMargin = Math.max(0, toFiniteNumber(margin));
  const containerWidth = Math.max(0, toFiniteNumber(container?.width));
  const containerHeight = Math.max(0, toFiniteNumber(container?.height));
  const anchoredWindow = clampFloatingSchemaWindow({
    window: {
      left: startWindow?.left,
      top: startWindow?.top,
      width: startWindow?.width,
      height: startWindow?.height,
    },
    container,
    minWidth,
    minHeight,
    margin,
  });
  const maxWidthFromAnchor = Math.max(
    Math.max(1, toFiniteNumber(minWidth, 320)),
    containerWidth - safeMargin - anchoredWindow.left,
  );
  const maxHeightFromAnchor = Math.max(
    Math.max(1, toFiniteNumber(minHeight, 180)),
    containerHeight - safeMargin - anchoredWindow.top,
  );

  return {
    left: anchoredWindow.left,
    top: anchoredWindow.top,
    width: Math.round(Math.min(maxWidthFromAnchor, Math.max(Math.max(1, toFiniteNumber(minWidth, 320)), toFiniteNumber(startWindow?.width) + dx))),
    height: Math.round(Math.min(maxHeightFromAnchor, Math.max(Math.max(1, toFiniteNumber(minHeight, 180)), toFiniteNumber(startWindow?.height) + dy))),
  };
}
