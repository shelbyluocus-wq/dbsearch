const BACKGROUND_OPACITY_MIN = 0.75;
const BACKGROUND_OPACITY_MAX = 1;
const BACKGROUND_OPACITY_STEP = 0.05;

function normalizeTableName(tableName) {
  return String(tableName || "").trim().toLowerCase();
}

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function fuzzyMatch(query, text) {
  if (!query || !text) return { matched: false, score: 0 };
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;
  for (let ti = 0; ti < text.length && qi < query.length; ti += 1) {
    if (text[ti] === query[qi]) {
      score += 1;
      if (ti === 0) score += 5;
      if (lastMatchIdx >= 0 && ti === lastMatchIdx + 1) score += 3;
      if (ti > 0 && /[_\-.\s]/.test(text[ti - 1])) score += 3;
      lastMatchIdx = ti;
      qi += 1;
    }
  }
  return { matched: qi === query.length, score };
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

export function rankTableSearchCandidates(query, candidates = []) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const list = Array.isArray(candidates) ? candidates : [];
  if (!normalizedQuery) return [...list];

  const scored = [];
  for (const item of list) {
    const name = normalizeTableName(item?.table_name);
    const comment = String(item?.table_comment || "").trim().toLowerCase();
    if (!name) continue;

    if (name.startsWith(normalizedQuery)) {
      scored.push({ item, score: 3000 + Math.max(0, 1000 - name.length) });
      continue;
    }

    if (name.includes(normalizedQuery)) {
      scored.push({ item, score: 2000 + Math.max(0, 1000 - name.length) });
      continue;
    }

    const nameMatch = fuzzyMatch(normalizedQuery, name);
    if (nameMatch.matched) {
      scored.push({
        item,
        score: 1000 + nameMatch.score + Math.max(0, 200 - name.length * 10),
      });
      continue;
    }

    if (comment.includes(normalizedQuery)) {
      scored.push({ item, score: 500 + Math.max(0, 500 - comment.length) });
      continue;
    }

    const commentMatch = fuzzyMatch(normalizedQuery, comment);
    if (commentMatch.matched) {
      scored.push({ item, score: commentMatch.score });
    }
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return String(left.item?.table_name || "").localeCompare(String(right.item?.table_name || ""), "zh-CN");
  });

  return scored.map(({ item }) => item);
}

export function shouldUseReducedTransparencyMode({
  reduceTransparency = false,
  isSettingsSurface = false,
  windowLabel = "",
} = {}) {
  if (!reduceTransparency || isSettingsSurface) return false;
  return String(windowLabel || "").trim().toLowerCase() !== "sync_workspace";
}

export const panelChromeConstants = {
  BACKGROUND_OPACITY_MIN,
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_STEP,
};
