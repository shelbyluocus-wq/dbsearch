function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function hasExceededTabDragThreshold({
  startX = 0,
  startY = 0,
  currentX = 0,
  currentY = 0,
  threshold = 6,
} = {}) {
  const deltaX = toNumber(currentX) - toNumber(startX);
  const deltaY = toNumber(currentY) - toNumber(startY);
  return Math.hypot(deltaX, deltaY) >= Math.max(0, toNumber(threshold));
}

function defaultGetItemId(item) {
  return String(item?.id || "");
}

export function resolveTabStripDropIndex({
  items = [],
  draggedId = "",
  hoveredId = "",
  pointerX = 0,
  hoveredRect = {},
  getId = defaultGetItemId,
} = {}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= 1) return -1;

  const normalizedDraggedId = String(draggedId || "");
  const normalizedHoveredId = String(hoveredId || "");
  if (!normalizedDraggedId || !normalizedHoveredId || normalizedDraggedId === normalizedHoveredId) return -1;

  const resolveId = typeof getId === "function" ? getId : defaultGetItemId;
  const draggedIndex = list.findIndex((item) => String(resolveId(item) || "") === normalizedDraggedId);
  const hoveredIndex = list.findIndex((item) => String(resolveId(item) || "") === normalizedHoveredId);
  if (draggedIndex < 0 || hoveredIndex < 0) return -1;

  const left = toNumber(hoveredRect?.left);
  const width = Math.max(0, toNumber(hoveredRect?.width));
  if (width <= 0) return -1;

  const midpoint = left + width / 2;
  const insertAfter = toNumber(pointerX) >= midpoint;
  if (!insertAfter && draggedIndex === hoveredIndex - 1) return draggedIndex;
  if (insertAfter && draggedIndex === hoveredIndex + 1) return hoveredIndex;

  if (insertAfter) {
    return draggedIndex < hoveredIndex ? hoveredIndex : hoveredIndex + 1;
  }
  return draggedIndex < hoveredIndex ? hoveredIndex - 1 : hoveredIndex;
}

export function resolveTableTabDropIndex({
  tabs = [],
  draggedTabId = "",
  hoveredTabId = "",
  pointerX = 0,
  hoveredRect = {},
} = {}) {
  return resolveTabStripDropIndex({
    items: tabs,
    draggedId: draggedTabId,
    hoveredId: hoveredTabId,
    pointerX,
    hoveredRect,
    getId: (tab) => tab?.id,
  });
}
