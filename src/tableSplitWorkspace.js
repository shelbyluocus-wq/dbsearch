const PANE_IDS = Object.freeze(["primary", "secondary"]);
const SPLIT_MODES = Object.freeze(["none", "vertical", "horizontal"]);

function normalizePaneId(id, fallback = "primary") {
  const value = String(id || "");
  return PANE_IDS.includes(value) ? value : fallback;
}

export function normalizeSplitMode(mode) {
  const value = String(mode || "none");
  return SPLIT_MODES.includes(value) ? value : "none";
}

export function normalizeSplitRatio(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(0.8, Math.max(0.2, numeric));
}

export function createTablePane({
  id = "primary",
  tabId = "",
  instanceId = "",
  viewState = {},
} = {}) {
  return {
    id: normalizePaneId(id),
    tabId: String(tabId || ""),
    instanceId: String(instanceId || ""),
    viewState: { ...(viewState || {}) },
  };
}

export function createSplitWorkspace({
  splitMode = "none",
  activePaneId = "primary",
  splitRatio = 0.5,
  primaryPane = null,
  panes = null,
} = {}) {
  const sourcePanes = Array.isArray(panes) && panes.length > 0
    ? panes
    : [primaryPane || createTablePane({ id: "primary" })];
  const normalizedPanes = sourcePanes
    .slice(0, 2)
    .map((pane, index) => createTablePane({
      ...pane,
      id: index === 0 ? "primary" : "secondary",
    }));
  const hasSecondary = normalizedPanes.length > 1;
  const nextMode = hasSecondary ? normalizeSplitMode(splitMode) : "none";
  const nextActive = normalizedPanes.some((pane) => pane.id === activePaneId)
    ? activePaneId
    : normalizedPanes[normalizedPanes.length - 1].id;

  return {
    splitMode: hasSecondary && nextMode !== "none" ? nextMode : "none",
    activePaneId: normalizePaneId(nextActive),
    splitRatio: normalizeSplitRatio(splitRatio),
    panes: normalizedPanes,
  };
}

export function isWorkspaceSplit(workspace = {}) {
  return normalizeSplitMode(workspace.splitMode) !== "none"
    && Array.isArray(workspace.panes)
    && workspace.panes.length > 1;
}

export function getWorkspacePane(workspace = {}, paneId = "primary") {
  const id = normalizePaneId(paneId);
  return Array.isArray(workspace.panes)
    ? workspace.panes.find((pane) => pane.id === id) || null
    : null;
}

export function getActiveWorkspacePane(workspace = {}) {
  return getWorkspacePane(workspace, workspace.activePaneId) || getWorkspacePane(workspace, "primary");
}

export function focusWorkspacePane(workspace = {}, paneId = "primary") {
  if (!getWorkspacePane(workspace, paneId)) return createSplitWorkspace(workspace);
  return createSplitWorkspace({ ...workspace, activePaneId: paneId, panes: workspace.panes });
}

export function splitWorkspace({ workspace = {}, mode = "vertical", pane } = {}) {
  const current = createSplitWorkspace(workspace);
  const primary = getWorkspacePane(current, "primary") || createTablePane({ id: "primary" });
  const secondary = createTablePane({ ...(pane || {}), id: "secondary" });
  return createSplitWorkspace({
    splitMode: normalizeSplitMode(mode) === "horizontal" ? "horizontal" : "vertical",
    activePaneId: "secondary",
    splitRatio: current.splitRatio,
    panes: [primary, secondary],
  });
}

export function closeWorkspacePane(workspace = {}, keepPaneId = "primary") {
  const current = createSplitWorkspace(workspace);
  const keep = getWorkspacePane(current, keepPaneId)
    || getActiveWorkspacePane(current)
    || getWorkspacePane(current, "primary");
  return createSplitWorkspace({
    splitMode: "none",
    activePaneId: keep?.id || "primary",
    splitRatio: current.splitRatio,
    panes: [createTablePane({ ...(keep || {}), id: "primary" })],
  });
}

export function resolveEffectiveSplitMode({
  splitMode = "none",
  width = 0,
  minVerticalWidth = 960,
} = {}) {
  const mode = normalizeSplitMode(splitMode);
  if (mode !== "vertical") return mode;
  return Number(width) >= Number(minVerticalWidth) ? "vertical" : "horizontal";
}

export function getTableTabDisplayName(tabs = [], tab = {}) {
  const tableName = String(tab?.tableName || "");
  if (!tableName) return "";
  const matches = (Array.isArray(tabs) ? tabs : []).filter(
    (item) => String(item?.tableName || "").toLowerCase() === tableName.toLowerCase(),
  );
  if (matches.length <= 1) return tableName;
  const index = matches.findIndex((item) => String(item?.id || "") === String(tab?.id || ""));
  return index <= 0 ? tableName : `${tableName} #${index + 1}`;
}
