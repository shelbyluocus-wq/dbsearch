const BACKGROUND_OPACITY_MIN = 0.75;
const BACKGROUND_OPACITY_MAX = 1;
const BACKGROUND_OPACITY_STEP = 0.05;

function normalizeTableName(tableName) {
  return String(tableName || "").trim().toLowerCase();
}

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function toSearchText(value) {
  return String(value || "").toLowerCase();
}

function buildContiguousRanges(start, length) {
  if (start < 0 || length <= 0) return [];
  return [{ start, end: start + length }];
}

function mergeRanges(ranges = []) {
  const normalized = (Array.isArray(ranges) ? ranges : [])
    .filter((range) => Number.isFinite(range?.start) && Number.isFinite(range?.end) && range.end > range.start)
    .sort((left, right) => {
      if (left.start !== right.start) return left.start - right.start;
      return left.end - right.end;
    });

  if (normalized.length === 0) return [];

  const merged = [normalized[0]];
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    const previous = merged[merged.length - 1];
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function fuzzyMatch(query, text) {
  if (!query || !text) return { matched: false, score: 0, mode: "none", ranges: [] };
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;
  const ranges = [];
  for (let ti = 0; ti < text.length && qi < query.length; ti += 1) {
    if (text[ti] === query[qi]) {
      score += 1;
      if (ti === 0) score += 5;
      if (lastMatchIdx >= 0 && ti === lastMatchIdx + 1) score += 3;
      if (ti > 0 && /[_\-.\s]/.test(text[ti - 1])) score += 3;
      lastMatchIdx = ti;
       ranges.push({ start: ti, end: ti + 1 });
      qi += 1;
    }
  }
  return {
    matched: qi === query.length,
    score: qi === query.length ? score : 0,
    mode: qi === query.length ? "fuzzy" : "none",
    ranges: qi === query.length ? ranges : [],
  };
}

function matchSearchTerm(term, text) {
  const normalizedTerm = toSearchText(term).trim();
  const normalizedText = toSearchText(text);
  if (!normalizedTerm || !normalizedText) {
    return { matched: false, score: 0, mode: "none", ranges: [], index: -1 };
  }

  const index = normalizedText.indexOf(normalizedTerm);
  if (index >= 0) {
    return {
      matched: true,
      score: normalizedTerm.length * 10 + Math.max(0, 20 - index),
      mode: "contiguous",
      ranges: buildContiguousRanges(index, normalizedTerm.length),
      index,
    };
  }

  const fuzzy = fuzzyMatch(normalizedTerm, normalizedText);
  return {
    ...fuzzy,
    index: fuzzy.ranges[0]?.start ?? -1,
  };
}

export function findHighlightRanges(text, termsInput) {
  const terms = [...new Set((Array.isArray(termsInput) ? termsInput : []).map((term) => String(term).trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);

  if (!String(text || "") || terms.length === 0) return [];

  return mergeRanges(
    terms.flatMap((term) => {
      const match = matchSearchTerm(term, text);
      return match.matched ? match.ranges : [];
    }),
  );
}

export function resolveTableDialogKeyAction({
  key = "",
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  shiftKey = false,
  tableOpen = false,
  settingsOpen = false,
  isEditable = false,
} = {}) {
  if (!tableOpen || settingsOpen || isEditable) return "none";

  const lower = String(key || "").toLowerCase();
  const withPrimary = ctrlKey || metaKey;
  if (lower !== "w" || shiftKey) return "none";

  if (withPrimary && !altKey) return "closeTable";
  if (!withPrimary && altKey) return "closeAllTables";
  if (!withPrimary && !altKey) return "toggleFullscreen";
  return "none";
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
  const openedByName = new Map();
  const closedStarred = [];

  for (const tab of tableTabs) {
    const normalized = normalizeTableName(tab?.tableName);
    if (!normalized) continue;

    const item = {
      key: `opened:${tab.id || normalized}`,
      tableName: String(tab.tableName).trim(),
      tabId: String(tab.id || ""),
      kind: "opened",
      draggable: true,
      starred: false,
      opened: true,
      active: String(tab.id || "") === activeTableTabId,
    };

    openedByName.set(normalized, item);
    merged.push(item);
  }

  for (const tableName of starredTables) {
    const normalized = normalizeTableName(tableName);
    if (!normalized) continue;

    const existing = openedByName.get(normalized);
    if (existing) {
      existing.starred = true;
      continue;
    }

    closedStarred.push({
      key: `starred:${normalized}`,
      tableName: String(tableName).trim(),
      tabId: "",
      kind: "starred-closed",
      draggable: false,
      starred: true,
      opened: false,
      active: false,
    });
  }

  return [...merged, ...closedStarred];
}

export function getTableSortMeta(sortMode = "name_asc") {
  const [rawColumn, rawDirection] = String(sortMode || "name_asc").toLowerCase().split("_");
  const column = rawColumn === "comment" ? "comment" : "name";
  const direction = rawDirection === "desc" ? "desc" : "asc";
  return { column, direction };
}

export function resolveNextTableSortMode(currentMode = "name_asc", column = "name") {
  const targetColumn = column === "comment" ? "comment" : "name";
  const current = getTableSortMeta(currentMode);
  if (current.column !== targetColumn) return `${targetColumn}_asc`;
  return `${targetColumn}_${current.direction === "asc" ? "desc" : "asc"}`;
}

export function buildFavoritesMenuItems({
  starredTables = [],
  tableFolders = [],
  activeFolder = "all",
} = {}) {
  const starredCount = Array.isArray(starredTables)
    ? starredTables.filter(Boolean).length
    : 0;
  const folders = (Array.isArray(tableFolders) ? tableFolders : [])
    .map((folder) => {
      const id = String(folder?.id || "").trim();
      const name = String(folder?.name || "").trim();
      const tables = Array.isArray(folder?.tables) ? folder.tables.filter(Boolean) : [];
      if (!id || !name) return null;
      return {
        key: `folder:${id}`,
        kind: "folder",
        id,
        label: name,
        tableCount: tables.length,
        active: activeFolder === id,
      };
    })
    .filter(Boolean);

  return [
    {
      key: "starred",
      kind: "starred",
      id: "starred",
      label: "星标",
      tableCount: starredCount,
      active: activeFolder === "starred",
    },
    ...folders,
  ];
}

export function shouldShowPanelTabStrip({
  dbConnected = false,
  panelTabsCount = 0,
  recentTablesCount = 0,
} = {}) {
  if (dbConnected) return true;
  return Number(panelTabsCount) > 0 || Number(recentTablesCount) > 0;
}

export function shouldShowOrgToolbar({
  dbConnected = false,
  starredCount = 0,
  folderCount = 0,
} = {}) {
  if (dbConnected) return true;
  return Number(starredCount) > 0 || Number(folderCount) > 0;
}

export function getDefaultTableDialogState() {
  return {
    fullscreen: false,
    backdropClosable: false,
  };
}

export function resolveTableDialogSurfaceMode({
  isPanelWindow = false,
} = {}) {
  if (isPanelWindow) {
    return {
      fillHostWindow: true,
      muteBackdrop: true,
    };
  }

  return {
    fillHostWindow: false,
    muteBackdrop: false,
  };
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

    const nameMatch = matchSearchTerm(normalizedQuery, name);
    if (nameMatch.matched && nameMatch.mode === "contiguous" && nameMatch.index === 0) {
      scored.push({ item, score: 3000 + Math.max(0, 1000 - name.length) });
      continue;
    }

    if (nameMatch.matched && nameMatch.mode === "contiguous") {
      scored.push({ item, score: 2000 + Math.max(0, 1000 - name.length) });
      continue;
    }

    if (nameMatch.matched) {
      scored.push({
        item,
        score: 1000 + nameMatch.score + Math.max(0, 200 - name.length * 10),
      });
      continue;
    }

    const commentMatch = matchSearchTerm(normalizedQuery, comment);
    if (commentMatch.matched && commentMatch.mode === "contiguous") {
      scored.push({ item, score: 500 + Math.max(0, 500 - comment.length) });
      continue;
    }

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
