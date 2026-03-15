const BACKGROUND_OPACITY_MIN = 0.75;
const BACKGROUND_OPACITY_MAX = 1;
const BACKGROUND_OPACITY_STEP = 0.05;

function normalizeTableName(tableName) {
  return String(tableName || "").trim().toLowerCase();
}

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

export function normalizeBackgroundOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return BACKGROUND_OPACITY_MAX;

  const clamped = Math.min(
    BACKGROUND_OPACITY_MAX,
    Math.max(BACKGROUND_OPACITY_MIN, numeric),
  );

  return Number(roundToStep(clamped, BACKGROUND_OPACITY_STEP).toFixed(2));
}

export function buildPanelTabs({
  starredTables = [],
  tableTabs = [],
  activeTableTabId = "",
} = {}) {
  const merged = [];
  const seen = new Map();

  for (const tableName of starredTables) {
    const normalized = normalizeTableName(tableName);
    if (!normalized || seen.has(normalized)) continue;

    const item = {
      key: `starred:${normalized}`,
      tableName: String(tableName).trim(),
      tabId: "",
      starred: true,
      opened: false,
      active: false,
    };

    seen.set(normalized, item);
    merged.push(item);
  }

  for (const tab of tableTabs) {
    const normalized = normalizeTableName(tab?.tableName);
    if (!normalized) continue;

    const existing = seen.get(normalized);
    if (existing) {
      existing.opened = true;
      existing.tabId = existing.tabId || String(tab.id || "");
      existing.active =
        existing.active ||
        existing.tabId === activeTableTabId ||
        String(tab.id || "") === activeTableTabId;
      continue;
    }

    const item = {
      key: `opened:${tab.id || normalized}`,
      tableName: String(tab.tableName).trim(),
      tabId: String(tab.id || ""),
      starred: false,
      opened: true,
      active: String(tab.id || "") === activeTableTabId,
    };

    seen.set(normalized, item);
    merged.push(item);
  }

  return merged;
}

export function describeTableFolderChip(tableName, tableFolders = []) {
  const normalizedTable = normalizeTableName(tableName);
  if (!normalizedTable) {
    return {
      label: "",
      extraCount: 0,
      title: "",
      visible: false,
      uncategorized: true,
      folders: [],
    };
  }

  const folders = [];
  for (const folder of Array.isArray(tableFolders) ? tableFolders : []) {
    const folderName = String(folder?.name || "").trim();
    const tables = Array.isArray(folder?.tables) ? folder.tables : [];
    if (!folderName) continue;
    if (!tables.some((item) => normalizeTableName(item) === normalizedTable)) continue;
    folders.push(folderName);
  }

  if (folders.length === 0) {
    return {
      label: "",
      extraCount: 0,
      title: "",
      visible: false,
      uncategorized: true,
      folders: [],
    };
  }

  return {
    label: folders[0],
    extraCount: Math.max(0, folders.length - 1),
    title: folders.join(" · "),
    visible: true,
    uncategorized: false,
    folders,
  };
}

export const panelChromeConstants = {
  BACKGROUND_OPACITY_MIN,
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_STEP,
};
