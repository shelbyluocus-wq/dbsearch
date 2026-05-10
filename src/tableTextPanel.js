// tableTextPanel.js
//
// Pure decision helpers for the bottom "文本选项" panel.
// The panel mirrors the currently-focused grid cell. When the user moves focus
// to a different cell we need to decide whether it is safe to auto-load the
// new cell's value, or whether we should instead warn them that they have
// un-saved edits pending in the panel.

/**
 * Build a stable string key from a cell focus descriptor so the caller can
 * compare the current vs. previously-loaded focus cheaply.
 */
export function buildFocusKey(focus) {
  if (!focus || !focus.rowKind) return "";
  return `${focus.rowKind}:${focus.rowIndex}:${String(focus.columnName || "")}`;
}

/**
 * Decide what the text panel should do when the grid focus changes.
 *
 * @param {Object} params
 * @param {{rowKind: string, rowIndex: number, columnName: string}|null} params.focus
 *        The new focus cell, or null if focus was cleared.
 * @param {boolean} params.panelDirty
 *        Whether the panel has un-saved edits.
 * @param {string}  params.lastFocusKey
 *        The focus key we previously loaded into the panel (buildFocusKey).
 * @param {string}  [params.originalText]
 *        The stored value of the new focus cell. Used when action === "load".
 *
 * @returns {{
 *   action: "load" | "warn" | "noop" | "clear",
 *   draft:  string,
 *   focusKey: string,
 *   dirty: boolean,
 * }}
 */
export function resolveTextPanelLoad({
  focus = null,
  panelDirty = false,
  lastFocusKey = "",
  originalText = "",
} = {}) {
  const newKey = buildFocusKey(focus);

  // No focus → blank the panel.
  if (!newKey) {
    return { action: "clear", draft: "", focusKey: "", dirty: false };
  }

  // Focus is the same cell the panel already mirrors; nothing to do.
  if (newKey === lastFocusKey) {
    return { action: "noop", draft: "", focusKey: newKey, dirty: panelDirty };
  }

  // Focus changed to a new cell.
  if (panelDirty) {
    return { action: "warn", draft: "", focusKey: lastFocusKey, dirty: true };
  }

  return {
    action: "load",
    draft: String(originalText ?? ""),
    focusKey: newKey,
    dirty: false,
  };
}

/**
 * Clamp a candidate panel height to the allowed range.
 *
 * Rule (from the plan): minimum 120px, maximum = 60% of container height.
 */
export function clampTextPanelHeight(value, containerHeight) {
  const min = 120;
  const h = Number(containerHeight) || 0;
  const max = h > 0 ? Math.max(min, Math.round(h * 0.6)) : 1000;
  const n = Number(value) || min;
  return Math.min(Math.max(n, min), max);
}

/**
 * The F4 textarea is a real text editor. Most keys must stay local so browser
 * text editing, selection movement, and native undo can work. Only the plain
 * F4 panel shortcut is routed back to the grid dispatcher.
 */
export function shouldRouteTextPanelKeyToGrid(event = {}) {
  return String(event.key || "") === "F4"
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.altKey;
}
