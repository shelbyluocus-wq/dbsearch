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

export function resolveTableTabDropIndex({
  tabs = [],
  draggedTabId = "",
  hoveredTabId = "",
  pointerX = 0,
  hoveredRect = {},
} = {}) {
  const list = Array.isArray(tabs) ? tabs : [];
  if (list.length <= 1) return -1;

  const draggedId = String(draggedTabId || "");
  const hoveredId = String(hoveredTabId || "");
  if (!draggedId || !hoveredId || draggedId === hoveredId) return -1;

  const draggedIndex = list.findIndex((tab) => String(tab?.id || "") === draggedId);
  const hoveredIndex = list.findIndex((tab) => String(tab?.id || "") === hoveredId);
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
