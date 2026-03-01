<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";

const isTauriWindow = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const windowLabel = ref("browser");

const isPetWindow = computed(() => isTauriWindow && windowLabel.value === "main");
const isMenuWindow = computed(() => isTauriWindow && windowLabel.value === "pet_menu");
const isPanelWindow = computed(() => !isPetWindow.value && !isMenuWindow.value);

const settingsOpen = ref(false);
const tableOpen = ref(false);
const tableDetailView = ref("hits");
const tableFullscreen = ref(false);
const schemaCollapsed = ref(true);
const dataCollapsed = ref(false);
const historyOpen = ref(false);
const resultZoomOpen = ref(false);
const resultZoomType = ref("table");
const settingsMsg = ref("");

const keyword = ref("");
const dbConnected = ref(false);
const dbName = ref("未连接");
const summaryText = ref("输入关键词开始搜索");
const copyToast = reactive({
  visible: false,
  text: "",
  tone: "success",
  version: 0,
});

const options = reactive({
  table: true,
  column: true,
  comment: true,
  data: false,
});

const results = reactive({
  table: [],
  column: [],
  comment: [],
  data: [],
});

const themeId = ref(localStorage.getItem('dbsearch-theme') || 'azure')

const THEMES = [
  { id: 'azure',    name: 'Azure',    color: '#0284c7' },
  { id: 'midnight', name: 'Midnight', color: '#334155' },
  { id: 'emerald',  name: 'Emerald',  color: '#059669' },
  { id: 'violet',   name: 'Violet',   color: '#7c3aed' },
]

function applyTheme(id) {
  themeId.value = id
  document.documentElement.dataset.theme = id
  localStorage.setItem('dbsearch-theme', id)
}

const progress = reactive({
  show: false,
  text: "",
  percent: 0,
});

const config = reactive({
  shared: {
    db: {
      host: "",
      port: 3306,
      username: "",
      password: "",
      database: "",
    },
    search: {
      exclude_tables: ["^t_log_.*", "^tmp_.*"],
      per_table_timeout_sec: 10,
      per_table_max_rows: 50,
    },
  },
  personal: {
    widget_mode: "tray",
    hotkey: "Ctrl+Shift+F",
    quick_date_hotkey: "F9",
    always_on_top: true,
    auto_start: false,
    ui_scale: 1.0,
    table_default_view: "hits",
    pet_locked: false,
    pet_position: null,
    idle_states: ["float_breathe", "sleep_zzz", "look_around", "ghost_fade"],
  },
});

const history = ref([]);
const allHitRows = ref([]);
const allHitRowsLoading = ref(false);
const tableFindOpen = ref(false);
const tableFindKeyword = ref("");
const tableFindIndexing = ref(false);
const tableFindMatches = ref([]);
const tableFindCursor = ref(-1);
const tableFindIndex = ref([]);
const tableFindTable = ref("");
const tableFindCacheVersion = ref(0);
const tableOptions = ref([]);
const selectedTables = ref([]);
const slashModeOpen = ref(false);
const slashQuery = ref("");
const slashActiveIndex = ref(0);
const tableTabs = ref([]);
const activeTableTabId = ref("");
const tableCommandOpen = ref(false);
const tableCommandQuery = ref("");
const tableCommandActiveIndex = ref(0);
const tableCommandSlashMode = ref(false);
let debounceTimer = null;
let currentSearchToken = 0;
let hitCollectToken = 0;
let tableFindIndexPromise = null;
let tableTabIdSeed = 0;
let tableTabRestoring = false;
let unlistenProgress = null;
let unlistenPanelOpenSettings = null;
let unlistenPetLockChanged = null;
let unlistenMenuOpened = null;
let unlistenPetMoved = null;
let unlistenSearchFound = null;
let unlistenPetIdleStatesChanged = null;
let unlistenPetIdlePreview = null;
let copyToastTimer = null;
let uiScalePersistTimer = null;

const petIdleActive = ref(false);
const currentIdleState = ref("float_breathe");
const petIdlePreviewing = ref(false);
const petFound = ref(false);
const tableModalRef = ref(null);
const tableGridWrapRef = ref(null);
const tableFullscreenMode = ref("none");
const tableFullscreenRestoreMaximized = ref(false);
let idleTimer = null;
let idleStateTimer = null;
let resetIdleHandler = null;
const columnWidthMap = reactive({});
let columnResizeState = null;
let tableLayoutObserver = null;
let tableLayoutRaf = 0;
let tablePageSizeAdjustToken = 0;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_STATE_CHANGE_MS = 7 * 1000;
const UI_SCALE_MIN = 0.8;
const UI_SCALE_MAX = 1.4;
const UI_SCALE_STEP = 0.1;
const TABLE_PAGE_SIZE_MIN = 1;
const TABLE_PAGE_SIZE_MAX = 200;
const TABLE_ROW_HEIGHT_FALLBACK = 28;
const TABLE_HEADER_HEIGHT_FALLBACK = 32;
const ALLOWED_IDLE_STATES = ["float_breathe", "sleep_zzz", "look_around", "ghost_fade"];
const TABLE_TAB_LIMIT = 8;
const TABLE_COMMAND_LIMIT = 12;

const tableView = reactive({
  tableName: "",
  tableComment: "",
  columns: [],
  rows: [],
  page: 1,
  pageSize: 50,
  totalRows: 0,
  hitRowIndex: null,
  hitColumn: null,
  hitNavCursor: -1,
  focusedHitLocalIndex: null,
});
const tableFindFocus = reactive({
  type: "none",
  schemaKey: "",
  page: 0,
  localIndex: null,
  columnName: "",
});

const detailHitContext = reactive({
  source: "none",
  terms: [],
  columns: [],
  externalHitCount: 0,
});

const settingsDraft = reactive({
  host: "",
  port: 3306,
  username: "",
  password: "",
  database: "",
  hotkey: "Ctrl+Shift+F",
  quickDateHotkey: "F9",
  autoStart: false,
  tableDefaultView: "hits",
  idleStates: ["float_breathe", "sleep_zzz", "look_around", "ghost_fade"],
  excludeTables: "^t_log_.*,^tmp_.*",
  perTableTimeoutSec: 10,
  perTableMaxRows: 50,
});

const totalMetaCount = computed(() => results.table.length + results.column.length + results.comment.length);
const canSearchData = computed(() => dbConnected.value && keyword.value.trim().length > 0);

const flatDataResults = computed(() => {
  const flat = [];
  for (const item of results.data) {
    const rows = item.matched_rows || [];
    const matchedCols = item.matched_columns || [];
    for (const row of rows) {
      if (matchedCols.length > 0) {
        for (const col of matchedCols) {
          flat.push({
            table_name: item.table_name,
            column: col,
            preview: `${col}: ${row[col] ?? ''}`,
            _item: item,
          });
        }
      } else {
        flat.push({ table_name: item.table_name, column: '', preview: '(匹配行)', _item: item });
      }
    }
    if (!rows.length && item.total_matches > 0) {
      flat.push({ table_name: item.table_name, column: '', preview: `${item.total_matches} 条命中`, _item: item });
    }
  }
  return flat;
});

const activeResultTab = ref('全部');

const totalResultCount = computed(() =>
  results.table.length + results.column.length + results.comment.length + flatDataResults.value.length
);

const resultTabs = computed(() => [
  { key: '全部',  label: '全部',  count: totalResultCount.value },
  { key: '表名',  label: '表名',  count: results.table.length },
  { key: '字段名', label: '字段名', count: results.column.length },
  { key: '备注',  label: '备注',  count: results.comment.length },
  { key: '数据值', label: '数据值', count: flatDataResults.value.length },
]);

const filteredResults = computed(() => {
  switch (activeResultTab.value) {
    case '表名':  return results.table.map(i => ({ ...i, _type: 'table' }));
    case '字段名': return results.column.map(i => ({ ...i, _type: 'column' }));
    case '备注':  return results.comment.map(i => ({ ...i, _type: 'comment' }));
    case '数据值': return flatDataResults.value.map(i => ({ ...i, _type: 'data' }));
    default: return [
      ...results.table.map(i => ({ ...i, _type: 'table' })),
      ...results.column.map(i => ({ ...i, _type: 'column' })),
      ...results.comment.map(i => ({ ...i, _type: 'comment' })),
      ...flatDataResults.value.map(i => ({ ...i, _type: 'data' })),
    ];
  }
});
const tableSwitchCandidates = computed(() => {
  const seen = new Set();
  const out = [];
  for (const item of filteredResults.value) {
    const tableName = String(item?.table_name || "").trim();
    if (!tableName) continue;
    const key = tableName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tableName);
  }
  return out;
});
const tableCommandCandidates = computed(() => {
  const query = tableCommandQuery.value.trim().toLowerCase();
  const base = Array.isArray(tableOptions.value) ? tableOptions.value : [];
  if (!query) return base.slice(0, TABLE_COMMAND_LIMIT);
  const starts = base.filter((item) => item.table_name.toLowerCase().startsWith(query));
  const includes = base.filter(
    (item) =>
      !item.table_name.toLowerCase().startsWith(query) &&
      item.table_name.toLowerCase().includes(query),
  );
  const comments = base.filter(
    (item) =>
      !item.table_name.toLowerCase().includes(query) &&
      String(item.table_comment || "").toLowerCase().includes(query),
  );
  return [...starts, ...includes, ...comments].slice(0, TABLE_COMMAND_LIMIT);
});
const tableCommandHint = computed(() =>
  tableCommandSlashMode.value ? "Slash 模式 / 选择表" : "Ctrl+P 输入表名，Enter 打开",
);
const totalPages = computed(() => Math.max(1, Math.ceil(tableView.totalRows / tableView.pageSize)));
const resultZoomTitle = computed(() => {
  if (resultZoomType.value === "table") return "表名匹配";
  if (resultZoomType.value === "column") return "字段名匹配";
  if (resultZoomType.value === "comment") return "备注匹配";
  if (resultZoomType.value === "data") return "数据值匹配";
  return "";
});
const resultZoomItems = computed(() => results[resultZoomType.value] || []);
const petSpriteClasses = computed(() => ({
  searching: progress.show,
  found: petFound.value,
  sleeping: petIdleActive.value && currentIdleState.value === "sleep_zzz",
  "idle-float": petIdleActive.value && currentIdleState.value === "float_breathe",
  "idle-look": petIdleActive.value && currentIdleState.value === "look_around",
  "idle-ghost": petIdleActive.value && currentIdleState.value === "ghost_fade",
}));
const hotkeyPlaceholder = "点击后按下快捷键";
const quickDateHotkeyPlaceholder = "点击后按下快捷键";
const contentScaleStyle = computed(() => ({
  "--content-scale": String(normalizeUiScale(config.personal.ui_scale)),
}));
const tableContentScaleStyle = computed(() => ({
  "--content-scale": String(normalizeUiScale(config.personal.ui_scale)),
}));
const hitOnlySchemaColumns = computed(() => tableView.columns.filter((col) => isSchemaColumnHit(col)));
const hitOnlyPrimaryKeyColumns = computed(() =>
  tableView.columns
    .filter((col) => !!col?.is_primary_key && !!col?.column_name)
    .map((col) => col.column_name),
);
const hitOnlyPrimaryHeader = computed(() => {
  if (hitOnlyPrimaryKeyColumns.value.length === 0) return "主键";
  return `主键(${hitOnlyPrimaryKeyColumns.value.join(", ")})`;
});
const hitOnlyDisplayColumns = computed(() => {
  const allColumnNames = tableView.columns.map((col) => col.column_name);
  const scoped = detailHitContext.columns.filter((name) => allColumnNames.includes(name));
  if (scoped.length > 0) return scoped;
  const terms = getDetailTerms();
  if (terms.length === 0) return allColumnNames;
  const inferred = allColumnNames.filter((name) => allHitRows.value.some((item) => containsAnyTerms(item.row?.[name], terms)));
  return inferred.length > 0 ? inferred : allColumnNames;
});
const hitOnlyRows = computed(() => allHitRows.value);
const slashCandidates = computed(() => {
  const query = slashQuery.value.trim().toLowerCase();
  const selectedSet = new Set(selectedTables.value.map((item) => item.toLowerCase()));
  const base = tableOptions.value.filter((item) => !selectedSet.has(item.table_name.toLowerCase()));
  if (!query) return base.slice(0, 12);
  const starts = base.filter((item) => item.table_name.toLowerCase().startsWith(query));
  const includes = base.filter((item) => !item.table_name.toLowerCase().startsWith(query) && item.table_name.toLowerCase().includes(query));
  const comments = base.filter((item) => !item.table_name.toLowerCase().includes(query) && String(item.table_comment || "").toLowerCase().includes(query));
  return [...starts, ...includes, ...comments].slice(0, 12);
});
const tableFindCounterText = computed(() => {
  if (tableFindIndexing.value) return "索引中...";
  if (tableFindMatches.value.length === 0 || tableFindCursor.value < 0) return "0/0";
  return `${tableFindCursor.value + 1}/${tableFindMatches.value.length}`;
});

function normalizeUiScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1.0;
  const rounded = Math.round(numeric / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Number(rounded.toFixed(1))));
}

function normalizeTableDefaultView(value) {
  return String(value || "").toLowerCase() === "full" ? "full" : "hits";
}

function scheduleUiScalePersist() {
  if (uiScalePersistTimer) clearTimeout(uiScalePersistTimer);
  uiScalePersistTimer = setTimeout(() => {
    persistConfig().catch(() => {});
    uiScalePersistTimer = null;
  }, 180);
}

function setUiScale(nextValue, { persist = false } = {}) {
  const normalized = normalizeUiScale(nextValue);
  config.personal.ui_scale = normalized;
  if (persist) {
    scheduleUiScalePersist();
  }
}

function renderHitPrimaryKey(row, fallbackIndex = null) {
  const primaryColumns = hitOnlyPrimaryKeyColumns.value;
  if (primaryColumns.length === 0) {
    return fallbackIndex === null || fallbackIndex === undefined ? "-" : String(fallbackIndex);
  }
  return primaryColumns.map((name) => `${name}=${String(row?.[name] ?? "")}`).join(" | ");
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  if (target.closest("[contenteditable]")) return true;
  return !!target.isContentEditable;
}

function sanitizeIdleStates(states) {
  const values = Array.isArray(states) ? states : [];
  const normalized = [...new Set(values.filter((item) => ALLOWED_IDLE_STATES.includes(item)))];
  return normalized.length > 0 ? normalized : ["float_breathe"];
}

function getDetailTerms() {
  const contextTerms = sanitizeTerms(detailHitContext.terms);
  if (contextTerms.length > 0) return contextTerms;
  return sanitizeTerms(splitKeywordTerms(keyword.value));
}

function pickNextIdleState() {
  const enabled = sanitizeIdleStates(config.personal.idle_states);
  if (enabled.length === 1) return enabled[0];
  const pool = enabled.filter((state) => state !== currentIdleState.value);
  const candidates = pool.length > 0 ? pool : enabled;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

function scheduleIdleStateSwitch() {
  clearTimeout(idleStateTimer);
  if (!petIdleActive.value || petIdlePreviewing.value) return;
  idleStateTimer = setTimeout(() => {
    currentIdleState.value = pickNextIdleState();
    scheduleIdleStateSwitch();
  }, IDLE_STATE_CHANGE_MS);
}

function enterIdleMode() {
  petIdleActive.value = true;
  currentIdleState.value = pickNextIdleState();
  scheduleIdleStateSwitch();
}

function exitIdleMode() {
  petIdleActive.value = false;
  petIdlePreviewing.value = false;
  currentIdleState.value = "float_breathe";
  clearTimeout(idleStateTimer);
}

function previewIdleState(state) {
  if (!isTauriWindow) return;
  emit("pet-idle-preview", { state }).catch(() => {});
}

function clearIdlePreview() {
  if (!isTauriWindow) return;
  emit("pet-idle-preview", { state: null }).catch(() => {});
}

function ensureDbConnectedForSearch() {
  if (dbConnected.value) return true;
  summaryText.value = "当前数据库未连接";
  return false;
}

function syncSummaryAfterConnectionCheck() {
  if (summaryText.value !== "正在连接数据库...") return;
  summaryText.value = dbConnected.value ? "输入关键词开始搜索" : "当前数据库未连接";
}

function currentSearchTargets() {
  return selectedTables.value.length > 0 ? [...selectedTables.value] : null;
}

async function loadTableOptions() {
  if (!isPanelWindow.value) return;
  try {
    const list = await invoke("list_tables");
    tableOptions.value = Array.isArray(list) ? list : [];
  } catch {
    tableOptions.value = [];
  }
}

function openSlashMode() {
  slashModeOpen.value = true;
  slashQuery.value = "";
  slashActiveIndex.value = 0;
  historyOpen.value = false;
}

function closeSlashMode() {
  slashModeOpen.value = false;
  slashQuery.value = "";
  slashActiveIndex.value = 0;
}

function selectSlashCandidate(item) {
  if (!item?.table_name) return;
  if (!selectedTables.value.includes(item.table_name)) {
    selectedTables.value.push(item.table_name);
  }
  closeSlashMode();
  focusKeyword();
}

function removeSelectedTable(tableName) {
  selectedTables.value = selectedTables.value.filter((item) => item !== tableName);
}

function onKeywordInputKeydown(event) {
  if (!slashModeOpen.value && event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    openSlashMode();
    return;
  }

  if (slashModeOpen.value) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (slashCandidates.value.length > 0) {
        slashActiveIndex.value = (slashActiveIndex.value + 1) % slashCandidates.value.length;
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (slashCandidates.value.length > 0) {
        slashActiveIndex.value = (slashActiveIndex.value - 1 + slashCandidates.value.length) % slashCandidates.value.length;
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const candidate = slashCandidates.value[slashActiveIndex.value];
      if (candidate) {
        selectSlashCandidate(candidate);
      } else {
        closeSlashMode();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashMode();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      if (slashQuery.value.length > 0) {
        slashQuery.value = slashQuery.value.slice(0, -1);
      } else {
        closeSlashMode();
      }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      slashQuery.value += event.key;
      return;
    }
    return;
  }

  if (event.key === "Backspace" && !keyword.value && selectedTables.value.length > 0) {
    removeSelectedTable(selectedTables.value[selectedTables.value.length - 1]);
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    runDataSearch();
  }
}

function setDetailHitContext({ source = "none", columns = [], terms = [], externalHitCount = 0 } = {}) {
  detailHitContext.source = source;
  detailHitContext.columns = [...new Set((Array.isArray(columns) ? columns : []).filter(Boolean))];
  detailHitContext.terms = sanitizeTerms(terms);
  detailHitContext.externalHitCount = Number(externalHitCount) || 0;
}

function normalizeHitContext(context = {}) {
  return {
    source: String(context?.source || "none"),
    columns: [...new Set((Array.isArray(context?.columns) ? context.columns : []).filter(Boolean))],
    terms: sanitizeTerms(context?.terms),
    externalHitCount: Number(context?.externalHitCount) || 0,
  };
}

function cloneRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => ({ ...(row || {}) })) : [];
}

function cloneColumns(columns) {
  return Array.isArray(columns) ? columns.map((column) => ({ ...(column || {}) })) : [];
}

function cloneFindEntries(entries) {
  return Array.isArray(entries) ? entries.map((item) => ({ ...(item || {}) })) : [];
}

function cloneHitRows(rows) {
  return Array.isArray(rows)
    ? rows.map((item) => ({
        ...(item || {}),
        row: { ...(item?.row || {}) },
      }))
    : [];
}

function cloneTableFindFocus(input = tableFindFocus) {
  return {
    type: String(input?.type || "none"),
    schemaKey: String(input?.schemaKey || ""),
    page: Number(input?.page) || 0,
    localIndex: input?.localIndex ?? null,
    columnName: String(input?.columnName || ""),
  };
}

function cloneColumnWidthMap(input = columnWidthMap) {
  const out = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    const width = Number(value);
    if (Number.isFinite(width) && width > 0) out[key] = width;
  });
  return out;
}

function nextTableTabId() {
  tableTabIdSeed += 1;
  return `table-tab-${tableTabIdSeed}`;
}

function createLiveTableSnapshot({ id, tableName } = {}) {
  return {
    id: id || nextTableTabId(),
    tableName: tableName || tableView.tableName,
    tableComment: tableView.tableComment,
    columns: cloneColumns(tableView.columns),
    rows: cloneRows(tableView.rows),
    page: tableView.page,
    pageSize: tableView.pageSize,
    totalRows: tableView.totalRows,
    hitRowIndex: tableView.hitRowIndex,
    hitColumn: tableView.hitColumn,
    hitNavCursor: tableView.hitNavCursor,
    focusedHitLocalIndex: tableView.focusedHitLocalIndex,
    tableDetailView: tableDetailView.value,
    tableFullscreen: tableFullscreen.value,
    schemaCollapsed: schemaCollapsed.value,
    dataCollapsed: dataCollapsed.value,
    tableFind: {
      open: tableFindOpen.value,
      keyword: tableFindKeyword.value,
      indexing: tableFindIndexing.value,
      matches: cloneFindEntries(tableFindMatches.value),
      cursor: tableFindCursor.value,
      index: cloneFindEntries(tableFindIndex.value),
      table: tableFindTable.value,
      cacheVersion: tableFindCacheVersion.value,
      focus: cloneTableFindFocus(tableFindFocus),
    },
    detailHitContext: normalizeHitContext(detailHitContext),
    allHitRows: cloneHitRows(allHitRows.value),
    allHitRowsLoading: allHitRowsLoading.value,
    columnWidthMap: cloneColumnWidthMap(columnWidthMap),
  };
}

function createNewTableSnapshot(tableName, rowIndex = null, columnName = null, hitContext = {}) {
  const pageSize = Math.max(TABLE_PAGE_SIZE_MIN, Number(tableView.pageSize) || 50);
  const normalizedHit = normalizeHitContext(hitContext);
  return {
    id: nextTableTabId(),
    tableName,
    tableComment: "",
    columns: [],
    rows: [],
    page: rowIndex !== null && rowIndex >= 0 ? Math.floor(rowIndex / pageSize) + 1 : 1,
    pageSize,
    totalRows: 0,
    hitRowIndex: rowIndex,
    hitColumn: columnName,
    hitNavCursor: -1,
    focusedHitLocalIndex: null,
    tableDetailView: normalizeTableDefaultView(config.personal.table_default_view),
    tableFullscreen: false,
    schemaCollapsed: true,
    dataCollapsed: false,
    tableFind: {
      open: false,
      keyword: "",
      indexing: false,
      matches: [],
      cursor: -1,
      index: [],
      table: "",
      cacheVersion: 0,
      focus: cloneTableFindFocus(),
    },
    detailHitContext: normalizedHit,
    allHitRows: [],
    allHitRowsLoading: false,
    columnWidthMap: {},
  };
}

function applyColumnWidthMap(nextMap = {}) {
  clearColumnWidths();
  Object.entries(nextMap || {}).forEach(([key, value]) => {
    const width = Number(value);
    if (Number.isFinite(width) && width > 0) {
      columnWidthMap[key] = width;
    }
  });
}

function restoreLiveStateFromTableSnapshot(tab) {
  if (!tab) return;
  tableTabRestoring = true;
  tableDetailView.value = normalizeTableDefaultView(tab.tableDetailView);
  schemaCollapsed.value = !!tab.schemaCollapsed;
  dataCollapsed.value = !!tab.dataCollapsed;
  tableView.tableName = String(tab.tableName || "");
  tableView.tableComment = String(tab.tableComment || "");
  tableView.columns = cloneColumns(tab.columns);
  tableView.rows = cloneRows(tab.rows);
  tableView.page = Number(tab.page) || 1;
  tableView.pageSize = Math.max(TABLE_PAGE_SIZE_MIN, Number(tab.pageSize) || 50);
  tableView.totalRows = Number(tab.totalRows) || 0;
  tableView.hitRowIndex = tab.hitRowIndex ?? null;
  tableView.hitColumn = tab.hitColumn ?? null;
  tableView.hitNavCursor = Number(tab.hitNavCursor ?? -1);
  tableView.focusedHitLocalIndex = tab.focusedHitLocalIndex ?? null;
  tableFindOpen.value = !!tab.tableFind?.open;
  tableFindKeyword.value = String(tab.tableFind?.keyword || "");
  tableFindIndexing.value = false;
  tableFindMatches.value = cloneFindEntries(tab.tableFind?.matches);
  tableFindCursor.value = Number(tab.tableFind?.cursor ?? -1);
  tableFindIndex.value = cloneFindEntries(tab.tableFind?.index);
  tableFindTable.value = String(tab.tableFind?.table || tab.tableName || "");
  tableFindCacheVersion.value = Math.max(
    Number(tab.tableFind?.cacheVersion) || 0,
    Date.now(),
  );
  tableFindIndexPromise = null;
  const focus = cloneTableFindFocus(tab.tableFind?.focus || {});
  tableFindFocus.type = focus.type;
  tableFindFocus.schemaKey = focus.schemaKey;
  tableFindFocus.page = focus.page;
  tableFindFocus.localIndex = focus.localIndex;
  tableFindFocus.columnName = focus.columnName;
  setDetailHitContext(tab.detailHitContext || {});
  allHitRows.value = cloneHitRows(tab.allHitRows);
  allHitRowsLoading.value = !!tab.allHitRowsLoading;
  applyColumnWidthMap(tab.columnWidthMap || {});
  tableTabRestoring = false;
}

function snapshotActiveTableTab() {
  if (!tableOpen.value || !activeTableTabId.value || tableTabRestoring) return;
  const index = tableTabs.value.findIndex((item) => item.id === activeTableTabId.value);
  if (index < 0) return;
  const current = tableTabs.value[index];
  tableTabs.value[index] = createLiveTableSnapshot({
    id: current.id,
    tableName: current.tableName,
  });
}

async function syncTableFullscreenForSwitch(targetFullscreen) {
  if (targetFullscreen) {
    if (!tableFullscreen.value) {
      await enterTableFullscreen();
    }
  } else if (tableFullscreen.value) {
    await exitTableFullscreen();
  }
}

async function activateTableTab(tabId, { skipSnapshot = false } = {}) {
  const next = tableTabs.value.find((item) => item.id === tabId);
  if (!next) return;
  if (activeTableTabId.value === tabId) return;
  if (!skipSnapshot) {
    snapshotActiveTableTab();
  }
  hitCollectToken += 1;
  activeTableTabId.value = next.id;
  const targetFullscreen = !!next.tableFullscreen;
  restoreLiveStateFromTableSnapshot(next);
  tableOpen.value = true;
  await syncTableFullscreenForSwitch(targetFullscreen);
  if (tableDetailView.value === "hits" && allHitRows.value.length === 0 && tableView.totalRows > 0) {
    collectAllHitRows().catch(() => {});
  }
  if (tableDetailView.value === "full" && !dataCollapsed.value) {
    startTableLayoutObserver().catch(() => {});
  } else {
    stopTableLayoutObserver();
  }
  scheduleAdaptiveTablePageSize();
}

async function openOrActivateTableTab(tableName, rowIndex = null, columnName = null, hitContext = {}) {
  const normalizedName = String(tableName || "").trim();
  if (!normalizedName) return;

  const exists = tableTabs.value.find(
    (item) => item.tableName.toLowerCase() === normalizedName.toLowerCase(),
  );
  if (exists) {
    await activateTableTab(exists.id);
    return;
  }

  if (tableTabs.value.length >= TABLE_TAB_LIMIT) {
    summaryText.value = `最多只能同时打开 ${TABLE_TAB_LIMIT} 个表标签`;
    showCopyToast(`最多打开 ${TABLE_TAB_LIMIT} 个标签`, "error");
    return;
  }

  snapshotActiveTableTab();
  hitCollectToken += 1;
  const nextTab = createNewTableSnapshot(normalizedName, rowIndex, columnName, hitContext);
  tableTabs.value.push(nextTab);
  activeTableTabId.value = nextTab.id;

  resultZoomOpen.value = false;
  restoreLiveStateFromTableSnapshot(nextTab);
  tableOpen.value = true;
  await syncTableFullscreenForSwitch(false);
  await loadTablePage({ resetFocus: true, clearHitCache: true });
  if (tableDetailView.value === "hits") {
    collectAllHitRows().catch(() => {});
  }
  await startTableLayoutObserver();
  scheduleAdaptiveTablePageSize();
  snapshotActiveTableTab();
}

async function switchTableByStep(step = 1) {
  if (!tableOpen.value) return;
  const candidates = tableSwitchCandidates.value;
  if (candidates.length === 0) {
    summaryText.value = "当前结果中无可切换表";
    return;
  }
  const current = String(tableView.tableName || "").toLowerCase();
  const delta = step >= 0 ? 1 : -1;
  const currentIndex = candidates.findIndex((name) => name.toLowerCase() === current);
  const seed = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : 0;
  const nextIndex = ((seed + delta) % candidates.length + candidates.length) % candidates.length;
  await openOrActivateTableTab(candidates[nextIndex]);
}

async function closeTableTab(tabId) {
  const index = tableTabs.value.findIndex((item) => item.id === tabId);
  if (index < 0) return;

  snapshotActiveTableTab();
  const wasActive = activeTableTabId.value === tabId;
  tableTabs.value.splice(index, 1);

  if (tableTabs.value.length === 0) {
    closeTableDialog();
    return;
  }

  if (!wasActive) return;
  const nextIndex = Math.min(index, tableTabs.value.length - 1);
  const nextTab = tableTabs.value[nextIndex];
  if (!nextTab) {
    closeTableDialog();
    return;
  }
  await activateTableTab(nextTab.id, { skipSnapshot: true });
}

function clearTableTabs() {
  tableTabs.value = [];
  activeTableTabId.value = "";
}

function openTableCommandPalette({ slash = false } = {}) {
  if (!isPanelWindow.value || settingsOpen.value) return;
  tableCommandOpen.value = true;
  tableCommandQuery.value = "";
  tableCommandActiveIndex.value = 0;
  tableCommandSlashMode.value = !!slash;
  historyOpen.value = false;
  closeSlashMode();
  nextTick(() => {
    const input = document.getElementById("tableCommandInput");
    input?.focus();
  });
}

function closeTableCommandPalette() {
  tableCommandOpen.value = false;
  tableCommandQuery.value = "";
  tableCommandActiveIndex.value = 0;
  tableCommandSlashMode.value = false;
}

function resolveTableCommandTarget() {
  if (tableCommandCandidates.value.length > 0) {
    return tableCommandCandidates.value[tableCommandActiveIndex.value] || tableCommandCandidates.value[0];
  }
  const query = tableCommandQuery.value.trim().toLowerCase();
  if (!query) return null;
  return tableOptions.value.find((item) => item.table_name.toLowerCase() === query) || null;
}

async function chooseTableCommandCandidate(item) {
  if (!item?.table_name) return;
  closeTableCommandPalette();
  await openOrActivateTableTab(item.table_name);
}

function isTableOpenedInTabs(tableName) {
  const normalized = String(tableName || "").trim().toLowerCase();
  if (!normalized) return false;
  return tableTabs.value.some((tab) => tab.tableName.toLowerCase() === normalized);
}

async function submitTableCommand() {
  const target = resolveTableCommandTarget();
  if (!target) {
    summaryText.value = "未匹配到可打开的表";
    return;
  }
  await chooseTableCommandCandidate(target);
}

function onTableCommandInputKeydown(event) {
  if (!tableCommandOpen.value) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (tableCommandCandidates.value.length > 0) {
      tableCommandActiveIndex.value =
        (tableCommandActiveIndex.value + 1) % tableCommandCandidates.value.length;
    }
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (tableCommandCandidates.value.length > 0) {
      tableCommandActiveIndex.value =
        (tableCommandActiveIndex.value - 1 + tableCommandCandidates.value.length) %
        tableCommandCandidates.value.length;
    }
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    submitTableCommand().catch(() => {});
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeTableCommandPalette();
    return;
  }

  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!tableCommandSlashMode.value && tableCommandQuery.value.length === 0) {
      event.preventDefault();
      tableCommandSlashMode.value = true;
    }
    return;
  }

  if (
    event.key === "Backspace" &&
    tableCommandSlashMode.value &&
    tableCommandQuery.value.length === 0
  ) {
    tableCommandSlashMode.value = false;
  }
}

onMounted(async () => {
  if (isTauriWindow) {
    windowLabel.value = getCurrentWindow().label;
  }

  applyTheme(themeId.value)
  await loadConfig();
  tableDetailView.value = normalizeTableDefaultView(config.personal.table_default_view);

  if (isPanelWindow.value) {
    if (isTauriWindow && config.shared.db.host && config.shared.db.database) {
      summaryText.value = "正在连接数据库...";
      await invoke("connect_db", {
        config: {
          host: config.shared.db.host,
          port: config.shared.db.port,
          username: config.shared.db.username,
          password: config.shared.db.password,
          database: config.shared.db.database,
        },
      }).catch(() => { summaryText.value = "自动连接失败，请检查设置"; });
    }
    await refreshConnectionStatus();
    syncSummaryAfterConnectionCheck();
    await attachProgressListener();
    await loadTableOptions();
    loadHistory();
    bindPanelListeners();
    if (isTauriWindow) {
      unlistenPanelOpenSettings = await listen("panel-open-settings", async () => {
        await invoke("consume_panel_open_settings").catch(() => false);
        openSettings();
      });
      const pendingOpenSettings = await invoke("consume_panel_open_settings").catch(() => false);
      if (pendingOpenSettings) {
        openSettings();
      }
    }
    return;
  }

  if (isPetWindow.value) {
    config.personal.idle_states = sanitizeIdleStates(config.personal.idle_states);

    if (isTauriWindow) {
      const appWindow = getCurrentWindow();
      unlistenPetMoved = await appWindow.onMoved((event) => {
        const pos = event?.payload ?? event;
        if (typeof pos?.x !== "number" || typeof pos?.y !== "number") {
          return;
        }
        invoke("save_pet_position", { x: Math.round(pos.x), y: Math.round(pos.y) }).catch(() => {});
      });
    }

    unlistenPetLockChanged = await listen("pet-lock-changed", (event) => {
      const payload = event.payload;
      if (payload && typeof payload.locked === "boolean") {
        config.personal.pet_locked = payload.locked;
      }
    });

    unlistenSearchFound = await listen("search-found", () => {
      petFound.value = true;
      setTimeout(() => { petFound.value = false; }, 800);
    });

    unlistenPetIdleStatesChanged = await listen("pet-idle-states-changed", (event) => {
      const payload = event.payload;
      config.personal.idle_states = sanitizeIdleStates(payload?.idleStates);
      if (petIdleActive.value && !petIdlePreviewing.value) {
        currentIdleState.value = pickNextIdleState();
        scheduleIdleStateSwitch();
      }
    });

    unlistenPetIdlePreview = await listen("pet-idle-preview", (event) => {
      const payload = event.payload;
      const state = payload?.state;
      if (typeof state === "string" && ALLOWED_IDLE_STATES.includes(state)) {
        petIdlePreviewing.value = true;
        petIdleActive.value = true;
        currentIdleState.value = state;
        clearTimeout(idleTimer);
        clearTimeout(idleStateTimer);
        return;
      }
      petIdlePreviewing.value = false;
      if (resetIdleHandler) {
        resetIdleHandler();
      } else {
        exitIdleMode();
      }
    });

    resetIdleHandler = () => {
      exitIdleMode();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { enterIdleMode(); }, IDLE_TIMEOUT_MS);
    };
    document.addEventListener("mousemove", resetIdleHandler);
    document.addEventListener("click", resetIdleHandler);
    resetIdleHandler();
    return;
  }

  if (isMenuWindow.value) {
    unlistenMenuOpened = await listen("pet-menu-opened", (event) => {
      const payload = event.payload;
      if (payload && typeof payload.pet_locked === "boolean") {
        config.personal.pet_locked = payload.pet_locked;
      }
    });
  }
});

onBeforeUnmount(() => {
  if (isPanelWindow.value) {
    detachPanelListeners();
    clearIdlePreview();
  }

  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
  }
  if (unlistenPanelOpenSettings) {
    unlistenPanelOpenSettings();
    unlistenPanelOpenSettings = null;
  }
  if (unlistenPetLockChanged) {
    unlistenPetLockChanged();
    unlistenPetLockChanged = null;
  }
  if (unlistenMenuOpened) {
    unlistenMenuOpened();
    unlistenMenuOpened = null;
  }
  if (unlistenPetMoved) {
    unlistenPetMoved();
    unlistenPetMoved = null;
  }
  if (unlistenSearchFound) {
    unlistenSearchFound();
    unlistenSearchFound = null;
  }
  if (unlistenPetIdleStatesChanged) {
    unlistenPetIdleStatesChanged();
    unlistenPetIdleStatesChanged = null;
  }
  if (unlistenPetIdlePreview) {
    unlistenPetIdlePreview();
    unlistenPetIdlePreview = null;
  }
  if (resetIdleHandler) {
    document.removeEventListener("mousemove", resetIdleHandler);
    document.removeEventListener("click", resetIdleHandler);
    resetIdleHandler = null;
  }
  clearTimeout(idleTimer);
  clearTimeout(idleStateTimer);
  clearTimeout(copyToastTimer);
  clearTimeout(uiScalePersistTimer);
  stopTableLayoutObserver();
  stopColumnResize();
});

watch(keyword, () => {
  if (!isPanelWindow.value) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runMetaSearch(), 300);
});

watch(
  () => [options.table, options.column, options.comment],
  () => {
    if (!isPanelWindow.value) return;
    runMetaSearch();
  },
);

watch(tableDetailView, (view) => {
  if (tableTabRestoring) return;
  if (!tableOpen.value) return;
  if (view === "hits") {
    stopTableLayoutObserver();
    collectAllHitRows().catch(() => {});
  } else {
    startTableLayoutObserver().catch(() => {});
  }
  scheduleAdaptiveTablePageSize();
});

watch(slashCandidates, (items) => {
  if (items.length === 0) {
    slashActiveIndex.value = 0;
  } else if (slashActiveIndex.value >= items.length) {
    slashActiveIndex.value = 0;
  }
});

watch(slashActiveIndex, async () => {
  if (!slashModeOpen.value || slashCandidates.value.length === 0) return;
  await nextTick();
  const active = document.getElementById(`slash-item-${slashActiveIndex.value}`);
  active?.scrollIntoView?.({ block: "nearest" });
});

watch(tableFindKeyword, () => {
  if (tableTabRestoring) return;
  runTableFind().catch(() => {});
});

watch(
  () => config.personal.ui_scale,
  () => {
    scheduleAdaptiveTablePageSize();
  },
);

watch(
  () => [tableOpen.value, dataCollapsed.value, schemaCollapsed.value, tableFullscreen.value],
  ([open]) => {
    if (!open) {
      stopTableLayoutObserver();
      return;
    }
    if (tableDetailView.value === "full" && !dataCollapsed.value) {
      startTableLayoutObserver().catch(() => {});
    } else {
      stopTableLayoutObserver();
    }
    scheduleAdaptiveTablePageSize();
  },
);

watch(
  () => [tableView.rows.length, tableView.columns.length, tableView.page],
  () => {
    scheduleAdaptiveTablePageSize();
  },
);

watch(selectedTables, () => {
  if (!isPanelWindow.value) return;
  if (!keyword.value.trim()) return;
  runMetaSearch();
}, { deep: true });

watch(tableCommandCandidates, (items) => {
  if (items.length === 0) {
    tableCommandActiveIndex.value = 0;
  } else if (tableCommandActiveIndex.value >= items.length) {
    tableCommandActiveIndex.value = 0;
  }
});

watch(tableCommandActiveIndex, async () => {
  if (!tableCommandOpen.value || tableCommandCandidates.value.length === 0) return;
  await nextTick();
  const active = document.getElementById(`table-command-item-${tableCommandActiveIndex.value}`);
  active?.scrollIntoView?.({ block: "nearest" });
});

function onDocDragover(e) { e.preventDefault(); }

function onDocDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!settingsOpen.value) openSettings();
  onDropConfig(e);
}

function bindPanelListeners() {
  window.addEventListener("click", onWindowClick);
  window.addEventListener("keydown", onWindowKeydown);
  window.addEventListener("wheel", onWindowWheel, { passive: false });
  window.addEventListener("resize", onWindowResize);
  document.addEventListener("dragover", onDocDragover);
  document.addEventListener("drop", onDocDrop);
}

function detachPanelListeners() {
  window.removeEventListener("click", onWindowClick);
  window.removeEventListener("keydown", onWindowKeydown);
  window.removeEventListener("wheel", onWindowWheel);
  window.removeEventListener("resize", onWindowResize);
  document.removeEventListener("dragover", onDocDragover);
  document.removeEventListener("drop", onDocDrop);
}

function onWindowClick(event) {
  const slashPanel = document.getElementById("slashDropdown");
  if (slashPanel && !slashPanel.contains(event.target) && !event.target?.closest?.("#keywordInput")) {
    slashModeOpen.value = false;
  }

  const historyPanel = document.getElementById("historyDropdown");
  if (historyPanel && !historyPanel.contains(event.target) && event.target.id !== "historyBtn") {
    historyOpen.value = false;
  }

  if (tableCommandOpen.value) {
    const commandPanel = document.getElementById("tableCommandPalette");
    if (
      commandPanel &&
      !commandPanel.contains(event.target) &&
      !event.target?.closest?.(".table-tab-add")
    ) {
      closeTableCommandPalette();
    }
  }
}

function onWindowWheel(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.deltaY === 0) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? UI_SCALE_STEP : -UI_SCALE_STEP;
  setUiScale(config.personal.ui_scale + delta, { persist: true });
}

function onWindowResize() {
  scheduleAdaptiveTablePageSize();
}

function formatTodayYmdByLocalTime() {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function insertTextIntoEditable(target, text) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    if (target.disabled || target.readOnly) return false;
    if (target instanceof HTMLInputElement) {
      const type = String(target.type || "").toLowerCase();
      const allowed = new Set(["", "text", "search", "url", "tel", "password", "email", "number"]);
      if (!allowed.has(type)) return false;
    }
    const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
    const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : target.value.length;
    const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
    target.value = nextValue;
    const cursor = start + text.length;
    target.setSelectionRange(cursor, cursor);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    target.focus();
    if (document.queryCommandSupported?.("insertText")) {
      document.execCommand("insertText", false, text);
      return true;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  return false;
}

function insertTodayDateToken() {
  const token = formatTodayYmdByLocalTime();
  const active = document.activeElement;
  if (insertTextIntoEditable(active, token)) {
    return true;
  }
  keyword.value = `${keyword.value}${token}`;
  focusKeyword();
  return true;
}

function onWindowKeydown(event) {
  const lower = String(event.key || "").toLowerCase();
  const withPrimary = event.ctrlKey || event.metaKey;

  if (!settingsOpen.value && !event.repeat && isEventMatchingHotkey(event, config.personal.quick_date_hotkey)) {
    event.preventDefault();
    insertTodayDateToken();
    return;
  }

  if (withPrimary && !event.altKey && !event.shiftKey && lower === "p") {
    if (settingsOpen.value) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    openTableCommandPalette();
    return;
  }

  if (
    tableOpen.value &&
    withPrimary &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "[" || event.key === "]") &&
    !isEditableTarget(event.target)
  ) {
    event.preventDefault();
    switchTableByStep(event.key === "]" ? 1 : -1).catch(() => {});
    return;
  }

  if (tableCommandOpen.value && event.key === "Escape") {
    closeTableCommandPalette();
    return;
  }

  if (tableCommandOpen.value) return;

  if (tableOpen.value && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
    event.preventDefault();
    openTableFind();
    return;
  }

  if (!tableOpen.value && event.key === "Escape" && slashModeOpen.value) {
    closeSlashMode();
    return;
  }

  if (tableOpen.value && tableFindOpen.value && event.key === "Escape") {
    closeTableFind();
    return;
  }

  if (tableOpen.value && event.key === "Tab") {
    event.preventDefault();
    toggleTableDetailView();
    return;
  }

  if (
    tableOpen.value &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !isEditableTarget(event.target)
  ) {
    if (lower === "q") {
      event.preventDefault();
      jumpHitRow(-1).catch(() => {});
      return;
    }
    if (lower === "e") {
      event.preventDefault();
      jumpHitRow(1).catch(() => {});
      return;
    }
    if (lower === "w") {
      event.preventDefault();
      toggleTableFullscreen();
      return;
    }
  }

  if (event.key !== "Escape") return;

  if (resultZoomOpen.value) {
    resultZoomOpen.value = false;
    return;
  }

  if (tableOpen.value) {
    closeTableDialog();
    return;
  }

  if (settingsOpen.value) {
    closeSettings();
    return;
  }

  historyOpen.value = false;
  if (isTauriWindow) {
    invoke("hide_panel_window").catch(() => {});
  }
}

function focusKeyword() {
  requestAnimationFrame(() => {
    const input = document.getElementById("keywordInput");
    input?.focus();
  });
}

async function attachProgressListener() {
  unlistenProgress = await listen("search-progress", (event) => {
    const payload = event.payload;
    if (!payload) return;

    if (payload.status === "searching") {
      progress.show = true;
      progress.text = `正在搜索 ${payload.current_table || "..."} (${payload.current}/${payload.total})`;
      progress.percent = payload.total > 0 ? Math.floor((payload.current / payload.total) * 100) : 0;
    }

    if (payload.status === "completed") {
      progress.text = "搜索完成";
      progress.percent = 100;
      setTimeout(() => {
        progress.show = false;
        progress.percent = 0;
      }, 800);
    }

    if (payload.status === "cancelled" || payload.status === "error") {
      progress.text = payload.status === "cancelled" ? "搜索已取消" : "搜索失败";
      setTimeout(() => {
        progress.show = false;
        progress.percent = 0;
      }, 800);
    }
  });
}

async function togglePanel() {
  if (!isTauriWindow) return;
  await invoke("toggle_panel_window", { openSettings: false });
}

function normalizeHotkeyDisplay(value) {
  return String(value || "")
    .split("+")
    .map((part) => normalizeHotkeyToken(part))
    .filter(Boolean)
    .join("+");
}

function normalizeQuickDateHotkey(value) {
  const normalized = normalizeHotkeyDisplay(value);
  if (!normalized || isModifierOnlyHotkey(normalized)) return "F9";
  return normalized;
}

function normalizeHotkeyToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "ctrl" || lower === "control") return "Ctrl";
  if (lower === "shift") return "Shift";
  if (lower === "alt" || lower === "option") return "Alt";
  if (lower === "meta" || lower === "win" || lower === "super" || lower === "command" || lower === "cmd") return "Meta";
  if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase();
  if (raw.length === 1 && /[a-z0-9]/i.test(raw)) return raw.toUpperCase();
  const named = {
    escape: "Esc",
    esc: "Esc",
    enter: "Enter",
    tab: "Tab",
    space: "Space",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    insert: "Insert",
    ins: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
  };
  return named[lower] || raw;
}

function isModifierOnlyHotkey(value) {
  const parts = String(value || "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return true;
  const modifiers = new Set(["ctrl", "control", "shift", "alt", "option", "meta", "win", "super", "command", "cmd"]);
  return parts.every((part) => modifiers.has(part));
}

function mapEventKeyToHotkey(event) {
  const key = String(event.key || "");
  const lower = key.toLowerCase();
  if (lower === "control" || lower === "shift" || lower === "alt" || lower === "meta" || lower === "os") {
    return "";
  }
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) {
    if (key === " ") return "Space";
    if (/[a-z0-9]/i.test(key)) return key.toUpperCase();
  }
  const named = {
    escape: "Esc",
    enter: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
  };
  return named[lower] || "";
}

function buildHotkeyFromEvent(event) {
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  const key = mapEventKeyToHotkey(event);
  if (key) parts.push(key);
  return parts.join("+");
}

function isEventMatchingHotkey(event, hotkey) {
  const target = normalizeHotkeyDisplay(hotkey);
  if (!target) return false;
  const actual = buildHotkeyFromEvent(event);
  return target === actual;
}

function onDraftHotkeyInputKeydown(event, draftKey) {
  if (event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Backspace" || event.key === "Delete") {
    settingsDraft[draftKey] = "";
    return;
  }

  settingsDraft[draftKey] = buildHotkeyFromEvent(event);
}

function onHotkeyInputKeydown(event) {
  onDraftHotkeyInputKeydown(event, "hotkey");
}

function onQuickDateHotkeyInputKeydown(event) {
  onDraftHotkeyInputKeydown(event, "quickDateHotkey");
}

async function panelClose() {
  if (!isTauriWindow) return;
  clearIdlePreview();
  await invoke("hide_panel_window").catch(() => {});
}

async function panelMinimize() {
  if (!isTauriWindow || !isPanelWindow.value) return;
  await getCurrentWindow().minimize().catch(() => {});
}

async function panelToggleMaximize() {
  if (!isTauriWindow || !isPanelWindow.value) return;
  const appWindow = getCurrentWindow();
  const maximized = await appWindow.isMaximized().catch(() => false);
  if (maximized) {
    await appWindow.unmaximize().catch(() => {});
  } else {
    await appWindow.maximize().catch(() => {});
  }
}

function panelHeaderPointerDown(event) {
  if (event.button !== 0 || !isTauriWindow || !isPanelWindow.value) return;
  const target = event.target;
  if (target instanceof Element && target.closest("button, input, textarea, select, label, a")) {
    return;
  }
  getCurrentWindow().startDragging().catch(() => {});
}

function openSettings() {
  settingsDraft.host = config.shared.db.host;
  settingsDraft.port = config.shared.db.port;
  settingsDraft.username = config.shared.db.username;
  settingsDraft.password = config.shared.db.password;
  settingsDraft.database = config.shared.db.database;
  settingsDraft.hotkey = normalizeHotkeyDisplay(config.personal.hotkey);
  settingsDraft.quickDateHotkey = normalizeQuickDateHotkey(config.personal.quick_date_hotkey);
  settingsDraft.autoStart = config.personal.auto_start;
  settingsDraft.tableDefaultView = normalizeTableDefaultView(config.personal.table_default_view);
  settingsDraft.idleStates = [...sanitizeIdleStates(config.personal.idle_states)];
  settingsDraft.excludeTables = (config.shared.search.exclude_tables || []).join(",");
  settingsDraft.perTableTimeoutSec = config.shared.search.per_table_timeout_sec;
  settingsDraft.perTableMaxRows = config.shared.search.per_table_max_rows;
  settingsMsg.value = "";
  settingsOpen.value = true;
}

function closeSettings() {
  clearIdlePreview();
  settingsOpen.value = false;
}

async function testConnect() {
  settingsMsg.value = "连接中...";
  try {
    const msg = await invoke("connect_db", {
      config: {
        host: settingsDraft.host,
        port: Number(settingsDraft.port),
        username: settingsDraft.username,
        password: settingsDraft.password,
        database: settingsDraft.database,
      },
    });
    settingsMsg.value = `✓ ${msg}`;
    await refreshConnectionStatus();
  } catch (error) {
    settingsMsg.value = `✗ 连接失败：${String(error)}`;
  }
}

async function saveSettings() {
  const previousHotkey = config.personal.hotkey;
  config.shared.db.host = settingsDraft.host.trim();
  config.shared.db.port = Number(settingsDraft.port) || 3306;
  config.shared.db.username = settingsDraft.username.trim();
  config.shared.db.password = settingsDraft.password;
  config.shared.db.database = settingsDraft.database.trim();

  config.personal.hotkey = normalizeHotkeyDisplay(settingsDraft.hotkey.trim() || "Ctrl+Shift+F");
  config.personal.quick_date_hotkey = normalizeQuickDateHotkey(settingsDraft.quickDateHotkey.trim() || "F9");
  config.personal.idle_states = sanitizeIdleStates(settingsDraft.idleStates);
  config.personal.table_default_view = normalizeTableDefaultView(settingsDraft.tableDefaultView);
  if (isModifierOnlyHotkey(config.personal.hotkey)) {
    settingsMsg.value = "✗ 快捷键必须包含至少一个非修饰键，例如 Ctrl+Shift+F";
    return;
  }
  if (isModifierOnlyHotkey(config.personal.quick_date_hotkey)) {
    settingsMsg.value = "✗ 日期快捷键必须包含至少一个非修饰键，例如 F9";
    return;
  }
  config.shared.search.exclude_tables = settingsDraft.excludeTables
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  config.shared.search.per_table_timeout_sec = Number(settingsDraft.perTableTimeoutSec) || 10;
  config.shared.search.per_table_max_rows = Number(settingsDraft.perTableMaxRows) || 50;

  if (isTauriWindow) {
    try {
      await invoke("register_hotkey", { hotkey: config.personal.hotkey });
    } catch (error) {
      config.personal.hotkey = previousHotkey;
      settingsMsg.value = `✗ 快捷键注册失败：${String(error)}`;
      return;
    }
  }

  config.personal.auto_start = !!settingsDraft.autoStart;
  await persistConfig();
  if (isTauriWindow) {
    emit("pet-idle-states-changed", {
      idleStates: config.personal.idle_states,
    }).catch(() => {});
  }
  await invoke("set_autostart", { enable: config.personal.auto_start }).catch(() => {});

  try {
    await invoke("connect_db", {
      config: {
        host: config.shared.db.host,
        port: config.shared.db.port,
        username: config.shared.db.username,
        password: config.shared.db.password,
        database: config.shared.db.database,
      },
    });
  } catch {
    // keep saved config even if connect failed
  }

  await refreshConnectionStatus();
  clearIdlePreview();
  settingsOpen.value = false;
}

function toggleHistory() {
  closeSlashMode();
  historyOpen.value = !historyOpen.value;
}

function openResultZoom(type) {
  resultZoomType.value = type;
  resultZoomOpen.value = true;
}

function closeResultZoom() {
  resultZoomOpen.value = false;
}

function toggleTableDetailView() {
  tableDetailView.value = tableDetailView.value === "full" ? "hits" : "full";
  if (tableDetailView.value === "full") {
    startTableLayoutObserver().catch(() => {});
  } else {
    stopTableLayoutObserver();
  }
  scheduleAdaptiveTablePageSize();
}

function resetTableFullscreenTracking() {
  tableFullscreenMode.value = "none";
  tableFullscreenRestoreMaximized.value = false;
}

async function enterTableFullscreen() {
  tableFullscreen.value = true;
  if (!isTauriWindow || !isPanelWindow.value) {
    resetTableFullscreenTracking();
    return;
  }

  const appWindow = getCurrentWindow();
  tableFullscreenRestoreMaximized.value = await appWindow.isMaximized().catch(() => false);

  try {
    await appWindow.setFullscreen(true);
    tableFullscreenMode.value = "system";
    return;
  } catch {
    // Fall back to maximize if system fullscreen is unavailable.
  }

  if (!tableFullscreenRestoreMaximized.value) {
    await appWindow.maximize().catch(() => {});
  }
  tableFullscreenMode.value = "maximize";
}

async function exitTableFullscreen() {
  if (!tableFullscreen.value && tableFullscreenMode.value === "none") {
    return;
  }

  if (!isTauriWindow || !isPanelWindow.value) {
    tableFullscreen.value = false;
    resetTableFullscreenTracking();
    return;
  }

  const appWindow = getCurrentWindow();
  if (tableFullscreenMode.value === "system") {
    await appWindow.setFullscreen(false).catch(() => {});
  } else if (tableFullscreenMode.value === "maximize") {
    if (!tableFullscreenRestoreMaximized.value) {
      await appWindow.unmaximize().catch(() => {});
    }
  }

  tableFullscreen.value = false;
  resetTableFullscreenTracking();
}

async function toggleTableFullscreen() {
  if (tableFullscreen.value) {
    await exitTableFullscreen();
  } else {
    await enterTableFullscreen();
  }
  scheduleAdaptiveTablePageSize();
}

function getTargetColumns(columnNames = null) {
  const all = Array.isArray(columnNames) && columnNames.length > 0
    ? columnNames
    : tableView.columns.map((column) => column.column_name);
  if (detailHitContext.columns.length === 0) return all;
  const scoped = detailHitContext.columns.filter((name) => all.includes(name));
  return scoped.length > 0 ? scoped : all;
}

function rowMatchesContext(row, columnNames = null) {
  const terms = getDetailTerms();
  if (terms.length === 0) return false;
  const targetColumns = getTargetColumns(columnNames);
  return targetColumns.some((columnName) => containsAllTerms(row?.[columnName], terms));
}

async function collectAllHitRows() {
  if (!tableView.tableName || tableView.totalRows <= 0) {
    allHitRows.value = [];
    return [];
  }

  const token = ++hitCollectToken;
  allHitRowsLoading.value = true;
  try {
    const pageCount = totalPages.value;
    const collected = [];
    for (let page = 1; page <= pageCount; page += 1) {
      let columns = tableView.columns;
      let rows = [];
      if (page === tableView.page) {
        rows = tableView.rows;
      } else {
        const payload = await invoke("get_table_data", {
          tableName: tableView.tableName,
          page,
          pageSize: tableView.pageSize,
        });
        columns = payload.columns || columns;
        rows = payload.rows || [];
      }

      if (token !== hitCollectToken) return [];

      const columnNames = (columns || []).map((column) => column.column_name);
      rows.forEach((row, idx) => {
        if (rowMatchesContext(row, columnNames)) {
          collected.push({
            row,
            page,
            localIndex: idx,
            globalIndex: (page - 1) * tableView.pageSize + idx + 1,
          });
        }
      });
    }
    allHitRows.value = collected;
    return collected;
  } finally {
    if (token === hitCollectToken) {
      allHitRowsLoading.value = false;
    }
  }
}

async function jumpHitRow(step = 1) {
  if (allHitRows.value.length === 0) {
    await collectAllHitRows();
  }
  if (allHitRows.value.length === 0) {
    summaryText.value = "未找到命中数据行";
    return;
  }

  const total = allHitRows.value.length;
  const delta = step >= 0 ? 1 : -1;
  const seedCursor = tableView.hitNavCursor < 0
    ? (delta > 0 ? -1 : 0)
    : tableView.hitNavCursor;
  const nextCursor = ((seedCursor + delta) % total + total) % total;
  tableView.hitNavCursor = nextCursor;
  const targetHit = allHitRows.value[tableView.hitNavCursor];
  if (!targetHit) return;

  if (tableView.page !== targetHit.page) {
    tableView.page = targetHit.page;
    await loadTablePage({ resetFocus: false, clearHitCache: false });
  }
  tableView.focusedHitLocalIndex = targetHit.localIndex;

  await nextTick();
  const target = document.querySelector(`[data-hit-row-index="${tableView.focusedHitLocalIndex}"]`);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function jumpToNextHitRow() {
  await jumpHitRow(1);
}

function clearTableFindFocus() {
  tableFindFocus.type = "none";
  tableFindFocus.schemaKey = "";
  tableFindFocus.page = 0;
  tableFindFocus.localIndex = null;
  tableFindFocus.columnName = "";
}

function invalidateTableFindIndex() {
  tableFindIndexing.value = false;
  tableFindMatches.value = [];
  tableFindCursor.value = -1;
  tableFindIndex.value = [];
  tableFindTable.value = "";
  tableFindCacheVersion.value += 1;
  tableFindIndexPromise = null;
  clearTableFindFocus();
}

function resetTableFindState() {
  tableFindOpen.value = false;
  tableFindKeyword.value = "";
  invalidateTableFindIndex();
}

function openTableFind() {
  tableFindOpen.value = true;
  nextTick(() => {
    const input = document.getElementById("tableFindInput");
    input?.focus();
    input?.select?.();
  });
}

function closeTableFind() {
  tableFindOpen.value = false;
  tableFindKeyword.value = "";
  invalidateTableFindIndex();
}

function shouldAutoAdjustTablePageSize() {
  return tableOpen.value && tableDetailView.value === "full" && !dataCollapsed.value && !!tableView.tableName;
}

function readAdaptiveTablePageSize() {
  if (!shouldAutoAdjustTablePageSize()) return null;
  const wrap = tableGridWrapRef.value;
  if (!(wrap instanceof HTMLElement)) return null;

  const tableEl = wrap.querySelector("table.data-table");
  if (!(tableEl instanceof HTMLElement)) return null;

  const headerRow = tableEl.querySelector("thead tr");
  const bodyRow = tableEl.querySelector("tbody tr");
  const headerHeight = Math.max(
    1,
    Math.round(headerRow?.getBoundingClientRect?.().height || TABLE_HEADER_HEIGHT_FALLBACK),
  );
  const rowHeight = Math.max(
    1,
    Math.round(bodyRow?.getBoundingClientRect?.().height || TABLE_ROW_HEIGHT_FALLBACK),
  );
  const visibleHeight = Math.round(wrap.clientHeight || 0);
  const bodyVisible = visibleHeight - headerHeight;
  if (bodyVisible <= 0) return null;
  const rows = Math.floor(bodyVisible / rowHeight);
  if (!Number.isFinite(rows) || rows <= 0) return null;
  return Math.max(TABLE_PAGE_SIZE_MIN, Math.min(TABLE_PAGE_SIZE_MAX, rows));
}

async function applyAdaptiveTablePageSize() {
  const nextPageSize = readAdaptiveTablePageSize();
  if (!nextPageSize || nextPageSize === tableView.pageSize) return;
  const token = ++tablePageSizeAdjustToken;
  const anchorGlobalStart = Math.max(0, (tableView.page - 1) * tableView.pageSize);
  tableView.pageSize = nextPageSize;
  const expectedTotalPages = Math.max(1, Math.ceil(tableView.totalRows / tableView.pageSize));
  tableView.page = Math.min(expectedTotalPages, Math.floor(anchorGlobalStart / tableView.pageSize) + 1);
  invalidateTableFindIndex();
  await loadTablePage({ resetFocus: true, clearHitCache: true });
  if (token !== tablePageSizeAdjustToken) return;
  if (tableFindOpen.value && tableFindKeyword.value.trim()) {
    runTableFind().catch(() => {});
  }
}

function scheduleAdaptiveTablePageSize() {
  if (tableLayoutRaf) {
    cancelAnimationFrame(tableLayoutRaf);
  }
  tableLayoutRaf = requestAnimationFrame(() => {
    tableLayoutRaf = 0;
    nextTick(() => {
      applyAdaptiveTablePageSize().catch(() => {});
    });
  });
}

function stopTableLayoutObserver() {
  if (tableLayoutObserver) {
    tableLayoutObserver.disconnect();
    tableLayoutObserver = null;
  }
  if (tableLayoutRaf) {
    cancelAnimationFrame(tableLayoutRaf);
    tableLayoutRaf = 0;
  }
}

async function startTableLayoutObserver() {
  stopTableLayoutObserver();
  if (!shouldAutoAdjustTablePageSize()) return;
  if (typeof ResizeObserver === "undefined") return;
  await nextTick();

  const targets = [tableModalRef.value, tableGridWrapRef.value].filter(
    (item) => item instanceof HTMLElement,
  );
  if (targets.length === 0) return;

  tableLayoutObserver = new ResizeObserver(() => {
    scheduleAdaptiveTablePageSize();
  });
  targets.forEach((target) => tableLayoutObserver.observe(target));
  scheduleAdaptiveTablePageSize();
}

async function ensureTableFindIndex() {
  if (!tableView.tableName) return;
  if (tableFindTable.value === tableView.tableName && tableFindIndex.value.length > 0) return;
  if (tableFindIndexPromise) {
    await tableFindIndexPromise;
    return;
  }

  const version = tableFindCacheVersion.value + 1;
  tableFindCacheVersion.value = version;
  tableFindIndexing.value = true;
  tableFindIndexPromise = (async () => {
    try {
      const entries = [];
      entries.push({ type: "schema", schemaKey: "table_name", text: tableView.tableName });
      if (tableView.tableComment) {
        entries.push({ type: "schema", schemaKey: "table_comment", text: tableView.tableComment });
      }
      tableView.columns.forEach((column) => {
        entries.push({ type: "schema", schemaKey: `col-${column.column_name}`, text: column.column_name });
        if (column.column_comment) {
          entries.push({ type: "schema", schemaKey: `col-${column.column_name}`, text: column.column_comment });
        }
      });

      for (let page = 1; page <= totalPages.value; page += 1) {
        let columns = tableView.columns;
        let rows = [];
        if (page === tableView.page) {
          rows = tableView.rows;
        } else {
          const payload = await invoke("get_table_data", {
            tableName: tableView.tableName,
            page,
            pageSize: tableView.pageSize,
          });
          columns = payload.columns || [];
          rows = payload.rows || [];
        }
        if (version !== tableFindCacheVersion.value) return;

        const columnNames = (columns || []).map((column) => column.column_name);
        rows.forEach((row, localIndex) => {
          columnNames.forEach((columnName) => {
            const value = String(row?.[columnName] ?? "");
            if (!value) return;
            entries.push({
              type: "data",
              page,
              localIndex,
              columnName,
              text: value,
            });
          });
        });
      }

      if (version !== tableFindCacheVersion.value) return;
      tableFindIndex.value = entries;
      tableFindTable.value = tableView.tableName;
    } finally {
      if (version === tableFindCacheVersion.value) {
        tableFindIndexing.value = false;
      }
      tableFindIndexPromise = null;
    }
  })();
  await tableFindIndexPromise;
}

async function focusTableFindMatch(match) {
  if (!match) return;
  clearTableFindFocus();
  tableDetailView.value = "full";

  if (match.type === "data") {
    if (tableView.page !== match.page) {
      tableView.page = match.page;
      await loadTablePage({ resetFocus: false, clearHitCache: false });
    }
    tableFindFocus.type = "data";
    tableFindFocus.page = match.page;
    tableFindFocus.localIndex = match.localIndex;
    tableFindFocus.columnName = match.columnName;
    await nextTick();
    const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(match.columnName)
      : String(match.columnName);
    const selector = `[data-find-page="${match.page}"][data-find-row="${match.localIndex}"][data-find-col="${escaped}"]`;
    const target = document.querySelector(selector);
    target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    return;
  }

  tableFindFocus.type = "schema";
  tableFindFocus.schemaKey = String(match.schemaKey || "");
  await nextTick();
  const target = document.querySelector(`[data-schema-key="${tableFindFocus.schemaKey}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function runTableFind() {
  if (!tableFindOpen.value) return;
  const query = tableFindKeyword.value.trim().toLowerCase();
  if (!query) {
    tableFindMatches.value = [];
    tableFindCursor.value = -1;
    clearTableFindFocus();
    return;
  }

  await ensureTableFindIndex();
  const matches = tableFindIndex.value.filter((item) => String(item.text || "").toLowerCase().includes(query));
  tableFindMatches.value = matches;
  if (matches.length === 0) {
    tableFindCursor.value = -1;
    clearTableFindFocus();
    return;
  }
  tableFindCursor.value = 0;
  await focusTableFindMatch(matches[0]);
}

async function jumpTableFind(step) {
  if (tableFindMatches.value.length === 0) return;
  const total = tableFindMatches.value.length;
  tableFindCursor.value = (tableFindCursor.value + step + total) % total;
  await focusTableFindMatch(tableFindMatches.value[tableFindCursor.value]);
}

function onTableFindInputKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    jumpTableFind(event.shiftKey ? -1 : 1);
  }
}

function chooseHistory(item) {
  closeSlashMode();
  keyword.value = item;
  historyOpen.value = false;
  runMetaSearch();
}

function removeHistory(item) {
  history.value = history.value.filter((value) => value !== item);
  localStorage.setItem("db_scout_history_v1", JSON.stringify(history.value));
}

function addHistory(item) {
  const value = item.trim();
  if (!value) return;
  history.value = [value, ...history.value.filter((v) => v !== value)].slice(0, 20);
  localStorage.setItem("db_scout_history_v1", JSON.stringify(history.value));
}

function loadHistory() {
  try {
    const raw = localStorage.getItem("db_scout_history_v1");
    const parsed = JSON.parse(raw || "[]");
    history.value = Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    history.value = [];
  }
}

async function runMetaSearch() {
  activeResultTab.value = '全部';
  const value = keyword.value.trim();
  if (!value) {
    results.table = [];
    results.column = [];
    results.comment = [];
    results.data = [];
    summaryText.value = "输入关键词开始搜索";
    return;
  }

  if (!ensureDbConnectedForSearch()) {
    results.table = [];
    results.column = [];
    results.comment = [];
    results.data = [];
    return;
  }

  addHistory(value);

  try {
    const response = await invoke("search", {
      params: {
        keyword: value,
        scope: "MetaOnly",
        targetTable: null,
        targetTables: currentSearchTargets(),
      },
    });

    const meta = response.meta_results || [];
    results.table = options.table ? meta.filter((item) => item.match_type === "TableName") : [];
    results.column = options.column ? meta.filter((item) => item.match_type === "ColumnName") : [];
    results.comment = options.comment
      ? meta.filter((item) => item.match_type === "TableComment" || item.match_type === "ColumnComment")
      : [];

    summaryText.value = `元信息结果：${totalMetaCount.value} 条`;

    if (totalMetaCount.value > 0 && isTauriWindow) {
      emit("search-found").catch(() => {});
    }
  } catch (error) {
    summaryText.value = `搜索失败：${String(error)}`;
  }
}

async function runDataSearch() {
  activeResultTab.value = '数据值';
  if (!canSearchData.value) return;
  if (!ensureDbConnectedForSearch()) {
    results.data = [];
    progress.show = false;
    progress.percent = 0;
    return;
  }

  const value = keyword.value.trim();
  const token = ++currentSearchToken;

  progress.show = true;
  progress.text = "正在准备数据搜索...";
  progress.percent = 0;

  try {
    const response = await invoke("search", {
      params: {
        keyword: value,
        scope: "DataOnly",
        targetTable: null,
        targetTables: currentSearchTargets(),
      },
    });

    if (token !== currentSearchToken) return;

    results.data = response.data_results || [];
    summaryText.value = `数据值命中：${results.data.length} 张表`;
  } catch (error) {
    summaryText.value = `数据值搜索失败：${String(error)}`;
  } finally {
    if (token === currentSearchToken) {
      setTimeout(() => {
        progress.show = false;
        progress.percent = 0;
      }, 700);
    }
  }
}

function cancelDataSearch() {
  currentSearchToken += 1;
  invoke("cancel_search").catch(() => {});
  progress.text = "搜索已取消";
  setTimeout(() => {
    progress.show = false;
    progress.percent = 0;
  }, 500);
}

function renderHighlighted(text) {
  return renderHighlightedWithTerms(text, splitKeywordTerms(keyword.value));
}

function renderDetailHighlighted(text) {
  return renderHighlightedWithTerms(text, getDetailTerms());
}

function renderTableColumnHeader(columnName) {
  return renderDetailHighlighted(columnName);
}

function renderDataCell(row, columnName) {
  return renderDetailHighlighted(row?.[columnName] || "");
}

function getColumnStyle(columnName) {
  const width = Number(columnWidthMap[columnName] || 0);
  if (width <= 0) return null;
  return {
    width: `${width}px`,
    minWidth: `${width}px`,
    maxWidth: `${width}px`,
  };
}

function seedColumnWidth(columnName, width) {
  if (!columnName || Number(columnWidthMap[columnName]) > 0) return;
  const numeric = Math.max(80, Math.round(Number(width) || 0));
  if (numeric > 0) {
    columnWidthMap[columnName] = numeric;
  }
}

function clearColumnWidths() {
  Object.keys(columnWidthMap).forEach((key) => { delete columnWidthMap[key]; });
}

function onColumnResizeMove(event) {
  if (!columnResizeState) return;
  const delta = event.clientX - columnResizeState.startX;
  const width = Math.max(80, Math.round(columnResizeState.startWidth + delta));
  columnWidthMap[columnResizeState.columnName] = width;
}

function stopColumnResize() {
  window.removeEventListener("pointermove", onColumnResizeMove);
  window.removeEventListener("pointerup", stopColumnResize);
  columnResizeState = null;
}

function startColumnResize(event, columnName) {
  event.preventDefault();
  event.stopPropagation();
  const th = event.currentTarget?.closest?.("th");
  const rect = th?.getBoundingClientRect?.();
  const startWidth = Number(columnWidthMap[columnName] || rect?.width || 120);
  columnResizeState = {
    columnName,
    startX: event.clientX,
    startWidth,
  };
  window.addEventListener("pointermove", onColumnResizeMove);
  window.addEventListener("pointerup", stopColumnResize);
}

function splitKeywordTerms(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function sanitizeTerms(terms) {
  return [...new Set((Array.isArray(terms) ? terms : []).map((term) => String(term).trim()).filter(Boolean))];
}

function renderHighlightedWithTerms(text, termsInput) {
  const content = String(text || "");
  const terms = sanitizeTerms(termsInput).sort((a, b) => b.length - a.length);
  if (terms.length === 0) return escapeHtml(content);

  const regex = new RegExp(`(${terms.map((term) => escapeRegExp(term)).join("|")})`, "ig");
  const parts = content.split(regex);
  return parts
    .map((part, index) => (index % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join("");
}

function containsAllTerms(text, terms) {
  const normalizedTerms = sanitizeTerms(terms).map((item) => item.toLowerCase());
  if (normalizedTerms.length === 0) return false;
  const value = String(text || "").toLowerCase();
  return normalizedTerms.every((term) => value.includes(term));
}

function containsAnyTerms(text, terms) {
  const normalizedTerms = sanitizeTerms(terms).map((item) => item.toLowerCase());
  if (normalizedTerms.length === 0) return false;
  const value = String(text || "").toLowerCase();
  return normalizedTerms.some((term) => value.includes(term));
}

function isDataColumnHit(columnName) {
  return detailHitContext.columns.includes(columnName);
}

function isSchemaColumnHit(column) {
  if (!column) return false;
  if (detailHitContext.columns.includes(column.column_name)) return true;
  const terms = getDetailTerms();
  if (terms.length === 0) return false;
  return containsAnyTerms(column.column_name, terms) || containsAnyTerms(column.column_comment, terms);
}

function isDataRowHit(row, idx) {
  const indexHit =
    tableView.hitRowIndex !== null &&
    tableView.hitRowIndex >= (tableView.page - 1) * tableView.pageSize &&
    tableView.hitRowIndex < tableView.page * tableView.pageSize &&
    idx === tableView.hitRowIndex - (tableView.page - 1) * tableView.pageSize;

  return indexHit || rowMatchesContext(row);
}

function isDataCellHit(row, columnName) {
  const terms = getDetailTerms();
  if (terms.length === 0) return false;
  const inScope = getTargetColumns().includes(columnName);
  return inScope && containsAnyTerms(row?.[columnName], terms);
}

async function openFromMeta(item) {
  let externalHitCount = 0;
  if (item.match_type === "TableName") externalHitCount = results.table.length;
  else if (item.match_type === "ColumnName") externalHitCount = results.column.length;
  else externalHitCount = results.comment.length;

  await openOrActivateTableTab(item.table_name, null, item.column_name || null, {
    source: "meta",
    columns: item.column_name ? [item.column_name] : [],
    terms: splitKeywordTerms(keyword.value),
    externalHitCount,
  });
}

async function openFromData(item) {
  const rowIndex = item.first_row_index ?? null;
  const columns = Array.isArray(item.matched_columns) ? item.matched_columns.filter(Boolean) : [];
  const col = columns[0] || null;
  await openOrActivateTableTab(item.table_name, rowIndex, col, {
    source: "data",
    columns,
    terms: splitKeywordTerms(keyword.value),
    externalHitCount: results.data.length,
  });
}

function toggleSchemaCollapsed() {
  schemaCollapsed.value = !schemaCollapsed.value;
}

function toggleDataCollapsed() {
  dataCollapsed.value = !dataCollapsed.value;
}

async function openTable(tableName, rowIndex = null, columnName = null, hitContext = {}) {
  await openOrActivateTableTab(tableName, rowIndex, columnName, hitContext);
}

async function loadTablePage(options = {}) {
  const { resetFocus = true, clearHitCache = true } = options;
  if (!tableView.tableName) return;
  try {
    const payload = await invoke("get_table_data", {
      tableName: tableView.tableName,
      page: tableView.page,
      pageSize: tableView.pageSize,
    });

    tableView.columns = payload.columns || [];
    tableView.rows = payload.rows || [];
    tableView.totalRows = payload.totalRows || 0;
    tableView.tableComment = payload.tableComment || "";
    if (resetFocus) {
      tableView.focusedHitLocalIndex = null;
    }
    if (clearHitCache) {
      hitCollectToken += 1;
      allHitRows.value = [];
      allHitRowsLoading.value = false;
      tableView.hitNavCursor = -1;
    }
  } catch (error) {
    summaryText.value = `读取表数据失败：${String(error)}`;
  }
}

async function prevPage() {
  if (tableView.page <= 1) return;
  tableView.page -= 1;
  await loadTablePage({ resetFocus: true, clearHitCache: true });
}

async function nextPage() {
  if (tableView.page >= totalPages.value) return;
  tableView.page += 1;
  await loadTablePage({ resetFocus: true, clearHitCache: true });
}

function closeTableDialog() {
  resetTableFindState();
  clearColumnWidths();
  stopTableLayoutObserver();
  exitTableFullscreen().catch(() => {});
  closeTableCommandPalette();
  clearTableTabs();
  tableOpen.value = false;
  tableDetailView.value = normalizeTableDefaultView(config.personal.table_default_view);
  hitCollectToken += 1;
  allHitRows.value = [];
  allHitRowsLoading.value = false;
  tableView.hitNavCursor = -1;
  tableView.focusedHitLocalIndex = null;
  setDetailHitContext();
}

async function loadConfig() {
  try {
    const loaded = await invoke("get_config");
    if (loaded?.shared?.db) Object.assign(config.shared.db, loaded.shared.db);
    if (loaded?.shared?.search) Object.assign(config.shared.search, loaded.shared.search);
    if (loaded?.personal) Object.assign(config.personal, loaded.personal);
  } catch {
    // keep default
  }
  config.personal.idle_states = sanitizeIdleStates(config.personal.idle_states);
  config.personal.ui_scale = normalizeUiScale(config.personal.ui_scale);
  config.personal.table_default_view = normalizeTableDefaultView(config.personal.table_default_view);
  config.personal.quick_date_hotkey = normalizeQuickDateHotkey(config.personal.quick_date_hotkey);
}

async function persistConfig() {
  await invoke("save_config", { config });
}

async function refreshConnectionStatus() {
  try {
    const status = await invoke("get_connection_status");
    dbConnected.value = !!status.connected;
    dbName.value = status.database || "未连接";
  } catch {
    dbConnected.value = false;
    dbName.value = "未连接";
  }
}

async function openContextMenu(event) {
  event.preventDefault();
  if (!isTauriWindow) return;
  await invoke("show_pet_menu", {
    x: event.screenX,
    y: event.screenY,
  }).catch(() => {});
}

async function contextAction(action) {
  try {
    if (action === "open") {
      await invoke("show_panel_window", { openSettings: false });
    } else if (action === "settings") {
      await invoke("show_panel_window", { openSettings: true });
    } else if (action === "exit") {
      await invoke("quit_app");
      return;
    }
  } catch {
    // ignore runtime errors to keep menu responsive
  } finally {
    if (isTauriWindow) {
      await invoke("hide_pet_menu").catch(() => {});
    }
  }
}

function petPointerDown(event) {
  if (event.button !== 0 || !isTauriWindow) return;
  event.preventDefault();
  getCurrentWindow().startDragging().catch(() => {});
}

function triggerImport() {
  const file = document.getElementById("importFile");
  file?.click();
}

function applyDbJsonToSettingsDraft(parsed) {
  const dbConfig = parsed?.db && typeof parsed.db === "object" ? parsed.db : parsed;
  if (!dbConfig || typeof dbConfig !== "object") return false;

  const host = String(dbConfig.host || "").trim();
  const database = String(dbConfig.database || "").trim();
  if (!host || !database) return false;

  settingsDraft.host = host;
  settingsDraft.database = database;

  if (dbConfig.port !== undefined && dbConfig.port !== null && dbConfig.port !== "") {
    const port = Number(dbConfig.port);
    settingsDraft.port = Number.isFinite(port) && port > 0 ? port : 3306;
  }
  if (dbConfig.username !== undefined && dbConfig.username !== null) {
    settingsDraft.username = String(dbConfig.username);
  } else if (dbConfig.user !== undefined && dbConfig.user !== null) {
    settingsDraft.username = String(dbConfig.user);
  }
  if (dbConfig.password !== undefined && dbConfig.password !== null) {
    settingsDraft.password = String(dbConfig.password);
  }
  return true;
}

async function importDbConfigFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const applied = applyDbJsonToSettingsDraft(parsed);
    settingsMsg.value = applied ? "✓ 配置已填入，请测试连接" : "✗ JSON 解析失败或缺少数据库字段";
  } catch {
    settingsMsg.value = "✗ JSON 解析失败或缺少数据库字段";
  }
}

async function onImportConfig(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    await importDbConfigFile(file);
  } finally {
    event.target.value = "";
  }
}

async function onDropConfig(event) {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await importDbConfigFile(file);
}

function showCopyToast(text, tone = "success") {
  copyToast.text = text;
  copyToast.tone = tone;
  copyToast.version += 1;
  copyToast.visible = true;
  if (copyToastTimer) clearTimeout(copyToastTimer);
  copyToastTimer = setTimeout(() => {
    copyToast.visible = false;
    copyToastTimer = null;
  }, 1400);
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showCopyToast("已复制", "success");
  } catch {
    showCopyToast("复制失败", "error");
  }
}

function getResultKey(item) {
  if (item._type === 'table') return `t-${item.table_name}-${item.match_type}`;
  if (item._type === 'column') return `c-${item.table_name}-${item.column_name}`;
  if (item._type === 'comment') return `cm-${item.table_name}-${item.column_name}-${item.matched_text}`;
  return `d-${item.table_name}-${item.column}-${item.preview}`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
</script>

<template>
  <main v-if="isPanelWindow" class="app-shell open panel-shell" id="appShell" @contextmenu.prevent>
    <section class="widget" id="widget">
      <header class="widget-header" @pointerdown="panelHeaderPointerDown">
        <div class="traffic-lights">
          <button class="traffic-btn traffic-red" title="隐藏窗口" @click="panelClose"></button>
          <button class="traffic-btn traffic-yellow" title="最小化" @click="panelMinimize"></button>
          <button class="traffic-btn traffic-green" title="最大化/还原" @click="panelToggleMaximize"></button>
        </div>
        <div class="title-drag" data-tauri-drag-region></div>
        <span class="window-title">鹰捷V2.0</span>
        <div class="header-actions">
          <span :class="['db-status', { connected: dbConnected }]" id="dbStatusDot"></span>
          <span class="db-name" id="dbName">{{ dbName }}</span>
          <button class="icon-btn" title="设置" @click="openSettings">⚙</button>
        </div>
      </header>

      <div class="panel-content-viewport">
      <div class="panel-content-scale" :style="contentScaleStyle">
      <section class="search-panel">
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <div v-if="selectedTables.length > 0" class="selected-table-chips">
            <span v-for="tableName in selectedTables" :key="tableName" class="selected-table-chip">
              <code>{{ tableName }}</code>
              <button title="移除表范围" @click.stop="removeSelectedTable(tableName)">✕</button>
            </span>
          </div>
          <input id="keywordInput" v-model="keyword" type="text" placeholder="输入关键词搜索表名、字段名、备注..." autocomplete="off" @keydown="onKeywordInputKeydown" />
          <button id="historyBtn" class="ghost-btn" @click="toggleHistory">历史</button>
        </div>

        <div v-if="slashModeOpen" id="slashDropdown" class="slash-dropdown">
          <div class="slash-query">选择表范围 / {{ slashQuery || "..." }}</div>
          <button
            v-for="(item, idx) in slashCandidates"
            :key="item.table_name"
            :id="`slash-item-${idx}`"
            :class="['slash-item', { active: idx === slashActiveIndex }]"
            @click="selectSlashCandidate(item)"
          >
            <div class="main">{{ item.table_name }}</div>
            <div class="sub">{{ item.table_comment || "-" }}</div>
          </button>
          <div v-if="slashCandidates.length === 0" class="muted p-12">暂无可选表</div>
        </div>

        <div v-if="historyOpen && !slashModeOpen" id="historyDropdown" class="history-dropdown">
          <div v-for="item in history" :key="item" class="history-row">
            <button class="history-item" @click="chooseHistory(item)">{{ item }}</button>
            <button class="history-delete" title="删除该记录" @click.stop="removeHistory(item)">✕</button>
          </div>
          <div v-if="history.length === 0" class="muted p-12">暂无历史</div>
        </div>

        <div class="actions-row">
          <span class="muted">{{ summaryText }}</span>
        </div>

        <div v-if="progress.show" class="progress" id="progressWrap">
          <div class="progress-info">
            <span>{{ progress.text }}</span>
            <button class="ghost-btn" @click="cancelDataSearch">取消</button>
          </div>
          <div class="bar"><div class="bar-inner" :style="{ width: `${progress.percent}%` }"></div></div>
        </div>
      </section>

      <div class="results-layout" id="resultsWrap">
        <aside class="result-sidebar">
          <button
            v-for="tab in resultTabs" :key="tab.key"
            :class="['sidebar-item', { active: activeResultTab === tab.key }]"
            @click="activeResultTab = tab.key"
          >
            <span>{{ tab.label }}</span>
            <span class="sidebar-count" v-if="tab.count > 0">{{ tab.count }}</span>
          </button>
        </aside>

        <section class="results-main">
          <div class="list list-main">
            <template v-for="item in filteredResults" :key="getResultKey(item)">
              <button v-if="item._type === 'table'" class="list-item" @click="openFromMeta(item)">
                <div class="main" v-html="renderHighlighted(item.table_name)"></div>
                <span class="badge">TABLE</span>
                <span class="copy-icon-btn" @click.stop="copyText(item.table_name)" title="复制">⎘</span>
              </button>
              <button v-else-if="item._type === 'column'" class="list-item" @click="openFromMeta(item)">
                <div class="main" v-html="`${item.table_name}.` + renderHighlighted(item.column_name || '')"></div>
                <span class="badge">FIELD</span>
                <span class="copy-icon-btn" @click.stop="copyText(item.column_name || item.table_name)" title="复制">⎘</span>
              </button>
              <button v-else-if="item._type === 'comment'" class="list-item" @click="openFromMeta(item)">
                <div class="main">{{ item.table_name }}<span v-if="item.column_name">.{{ item.column_name }}</span></div>
                <div class="sub" v-html="renderHighlighted(item.matched_text)"></div>
                <span class="badge">{{ item.match_type === 'TableComment' ? '表备注' : '列备注' }}</span>
                <span class="copy-icon-btn" @click.stop="copyText(item.column_name || item.table_name)" title="复制">⎘</span>
              </button>
              <button v-else-if="item._type === 'data'" class="list-item" @click="openFromData(item._item)">
                <div class="main">{{ item.table_name }}</div>
                <div class="sub">{{ item.preview }}</div>
              </button>
            </template>
            <div v-if="filteredResults.length === 0 && keyword.trim()" class="muted p-10">
              {{ activeResultTab === '数据值' ? '按回车搜索数据值' : '暂无结果' }}
            </div>
          </div>
        </section>
      </div>
      </div>
      </div>
      <div class="panel-footer">
        <div class="theme-switcher">
          <button
            v-for="t in THEMES" :key="t.id"
            class="theme-dot"
            :class="{ active: themeId === t.id }"
            :style="{ '--c': t.color, background: t.color }"
            :title="t.name"
            @click="applyTheme(t.id)"
          ></button>
        </div>
      </div>
    </section>
  </main>

  <div v-else-if="isPetWindow" class="pet-root">
    <div
      id="pet"
      class="pet pet-anchored"
      role="button"
      aria-label="鹰捷"
      data-tauri-drag-region
      @click="togglePanel"
      @contextmenu="openContextMenu"
      @pointerdown="petPointerDown"
    >
      <div class="eagle-container">
        <div id="eagleSprite" class="eagle-sprite" :class="petSpriteClasses">
          <div class="blink-overlay"></div>
          <template v-if="petIdleActive && currentIdleState === 'sleep_zzz'">
            <div class="pixel-zzz">z</div>
            <div class="pixel-zzz">z</div>
          </template>
        </div>
        <div class="eagle-shadow"></div>
      </div>
    </div>
  </div>

  <div v-else class="pet-menu-root">
    <section class="pet-menu-window">
      <button @click="contextAction('open')">🔍 打开搜索</button>
      <button @click="contextAction('settings')">⚙ 设置</button>
      <hr />
      <button class="danger" @click="contextAction('exit')">⏻ 退出程序</button>
    </section>
  </div>

  <div v-if="resultZoomOpen" class="dialog-mask" @click.self="closeResultZoom">
    <section class="modal-card wide result-zoom-modal">
      <header class="modal-header">
        <h3>{{ resultZoomTitle }}（{{ resultZoomItems.length }}）</h3>
        <button class="icon-btn" @click="closeResultZoom">✕</button>
      </header>
      <section class="result-zoom-body">
        <div class="list list-zoom">
          <template v-if="resultZoomType === 'table'">
            <button v-for="item in resultZoomItems" :key="`${item.table_name}-${item.match_type}-${item.matched_text}`" class="list-item" @click="openFromMeta(item)">
              <div class="main" v-html="renderHighlighted(item.table_name)"></div>
              <span class="badge">TABLE</span>
              <span class="copy-icon-btn" role="button" tabindex="0" @click.stop="copyText(item.table_name)" title="复制">⎘</span>
            </button>
          </template>
          <template v-else-if="resultZoomType === 'column'">
            <button v-for="item in resultZoomItems" :key="`${item.table_name}-${item.column_name}-${item.match_type}`" class="list-item" @click="openFromMeta(item)">
              <div class="main" v-html="`${item.table_name}.` + renderHighlighted(item.column_name || '')"></div>
              <span class="badge">FIELD</span>
              <span class="copy-icon-btn" role="button" tabindex="0" @click.stop="copyText(item.column_name || item.table_name)" title="复制">⎘</span>
            </button>
          </template>
          <template v-else-if="resultZoomType === 'comment'">
            <button v-for="item in resultZoomItems" :key="`${item.table_name}-${item.column_name || ''}-${item.match_type}-${item.matched_text}`" class="list-item" @click="openFromMeta(item)">
              <div class="main">{{ item.table_name }}<span v-if="item.column_name">.{{ item.column_name }}</span></div>
              <div class="sub" v-html="renderHighlighted(item.matched_text)"></div>
              <span class="badge">{{ item.match_type === 'TableComment' ? '表备注' : '列备注' }}</span>
              <span class="copy-icon-btn" role="button" tabindex="0" @click.stop="copyText(item.column_name || item.table_name)" title="复制">⎘</span>
            </button>
          </template>
          <template v-else>
            <button v-for="item in resultZoomItems" :key="`${item.table_name}-${item.total_matches}`" class="list-item" @click="openFromData(item)">
              <div class="main">{{ item.table_name }} · {{ item.total_matches }} 条命中</div>
              <div class="sub">{{ (item.matched_columns || []).join(' · ') }}</div>
            </button>
          </template>
          <div v-if="resultZoomItems.length === 0" class="muted p-12">暂无结果</div>
        </div>
      </section>
    </section>
  </div>

  <div v-if="tableOpen" class="dialog-mask" @mousedown.self="closeTableDialog">
    <section ref="tableModalRef" :class="['modal-card', 'wide', 'table-modal', { fullscreen: tableFullscreen }]">
      <header class="modal-header" @pointerdown="panelHeaderPointerDown">
        <div class="modal-title-row" @pointerdown.stop>
          <h3
            class="modal-table-title"
            data-schema-key="table_name"
            :class="{ 'find-active-schema': tableFindFocus.type === 'schema' && tableFindFocus.schemaKey === 'table_name' }"
            v-html="renderDetailHighlighted(tableView.tableName)"
          ></h3>
          <button class="copy-icon-btn modal-copy-btn"
            @click.stop="copyText(tableView.tableName)" title="复制表名">⎘</button>
        </div>
        <div class="table-header-actions">
          <button class="small-btn" @click="toggleTableDetailView">{{ tableDetailView === 'full' ? '只看命中(Tab)' : '返回原页(Tab)' }}</button>
          <button class="small-btn" @click="toggleTableFullscreen">{{ tableFullscreen ? '退出全屏(W)' : '全屏查看(W)' }}</button>
          <button class="icon-btn" @click="closeTableDialog">✕</button>
        </div>
      </header>
      <section class="table-tabs">
        <button
          v-for="tab in tableTabs"
          :key="tab.id"
          :class="['table-tab', { active: tab.id === activeTableTabId }]"
          :title="tab.tableName"
          @click="activateTableTab(tab.id)"
        >
          <span class="table-tab-label">{{ tab.tableName }}</span>
          <span class="table-tab-close" title="关闭标签" @click.stop="closeTableTab(tab.id)">✕</span>
        </button>
        <button class="table-tab-add" title="打开表 (Ctrl+P)" @click="openTableCommandPalette({ slash: true })">+</button>
      </section>
      <section v-if="tableFindOpen" class="table-find-bar">
        <input id="tableFindInput" v-model="tableFindKeyword" type="text" placeholder="检索当前表的全部分页文本..." @keydown="onTableFindInputKeydown" />
        <span class="find-counter">{{ tableFindCounterText }}</span>
        <button class="small-btn" :disabled="tableFindMatches.length === 0" @click="jumpTableFind(-1)">上一条</button>
        <button class="small-btn" :disabled="tableFindMatches.length === 0" @click="jumpTableFind(1)">下一条</button>
        <button class="small-btn" @click="closeTableFind">关闭</button>
      </section>

      <div class="table-content">
      <div class="table-content-viewport">
      <div class="table-content-scale" :style="tableContentScaleStyle">
      <template v-if="tableDetailView === 'full'">
        <section class="schema-box">
          <div class="section-head">
            <h4>Schema 信息</h4>
            <button class="section-toggle-btn" @click="toggleSchemaCollapsed">
              {{ schemaCollapsed ? "展开" : "收起" }}
            </button>
          </div>
          <div v-show="!schemaCollapsed" class="section-body">
            <div
              v-if="tableView.tableComment"
              class="table-comment"
              data-schema-key="table_comment"
              :class="{ 'find-active-schema': tableFindFocus.type === 'schema' && tableFindFocus.schemaKey === 'table_comment' }"
              v-html="renderDetailHighlighted(tableView.tableComment)"
            ></div>
            <table class="schema-table">
              <thead>
                <tr><th>字段名</th><th>类型</th><th>备注</th></tr>
              </thead>
              <tbody>
                <tr
                  v-for="col in tableView.columns"
                  :key="col.column_name"
                  :data-schema-key="`col-${col.column_name}`"
                  :class="{
                    hit: isSchemaColumnHit(col),
                    'find-active-schema': tableFindFocus.type === 'schema' && tableFindFocus.schemaKey === `col-${col.column_name}`,
                  }"
                >
                  <td v-html="renderDetailHighlighted(col.column_name)"></td>
                  <td>{{ col.column_type }}</td>
                  <td v-html="renderDetailHighlighted(col.column_comment || '-')"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="data-box">
          <div class="section-head">
            <h4>表数据（共 {{ tableView.totalRows }} 行）</h4>
            <button class="section-toggle-btn" @click="toggleDataCollapsed">
              {{ dataCollapsed ? "展开" : "收起" }}
            </button>
          </div>
          <div v-show="!dataCollapsed" class="section-body">
            <div class="data-head actions-only">
              <div class="data-actions">
                <button class="small-btn" @click="jumpToNextHitRow">一键跳转命中(Q/E)</button>
                <div class="pager">
                  <button :disabled="tableView.page <= 1" @click="prevPage">上一页</button>
                  <span>{{ tableView.page }} / {{ totalPages }}</span>
                  <button :disabled="tableView.page >= totalPages" @click="nextPage">下一页</button>
                </div>
              </div>
            </div>

            <div ref="tableGridWrapRef" class="grid-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th
                      v-for="col in tableView.columns"
                      :key="col.column_name"
                      :class="{ 'hit-col': isDataColumnHit(col.column_name) }"
                      :style="getColumnStyle(col.column_name)"
                    >
                      <div class="th-content" v-html="renderTableColumnHeader(col.column_name)"></div>
                      <span class="col-resize-handle" @pointerdown="startColumnResize($event, col.column_name)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, idx) in tableView.rows"
                    :key="idx"
                    :data-hit-row-index="idx"
                    :class="{
                      hit: isDataRowHit(row, idx),
                      'hit-active': tableView.focusedHitLocalIndex === idx,
                      'find-active-row': tableFindFocus.type === 'data' && tableFindFocus.page === tableView.page && tableFindFocus.localIndex === idx,
                    }"
                  >
                    <td
                      v-for="col in tableView.columns"
                      :key="col.column_name"
                      :data-find-page="tableView.page"
                      :data-find-row="idx"
                      :data-find-col="col.column_name"
                      :style="getColumnStyle(col.column_name)"
                      :class="{
                        'hit-cell': isDataCellHit(row, col.column_name),
                        'find-active-cell':
                          tableFindFocus.type === 'data' &&
                          tableFindFocus.page === tableView.page &&
                          tableFindFocus.localIndex === idx &&
                          tableFindFocus.columnName === col.column_name,
                      }"
                    >
                      <div class="td-clip" v-html="renderDataCell(row, col.column_name)"></div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="schema-box hit-only-section">
          <div class="section-head">
            <h4>命中 Schema（{{ hitOnlySchemaColumns.length }}）</h4>
            <button class="section-toggle-btn" @click="toggleSchemaCollapsed">
              {{ schemaCollapsed ? "展开" : "收起" }}
            </button>
          </div>
          <div v-show="!schemaCollapsed" class="section-body">
            <table v-if="hitOnlySchemaColumns.length > 0" class="schema-table">
              <thead>
                <tr><th>字段名</th><th>类型</th><th>备注</th></tr>
              </thead>
              <tbody>
                <tr v-for="col in hitOnlySchemaColumns" :key="col.column_name" class="hit">
                  <td v-html="renderDetailHighlighted(col.column_name)"></td>
                  <td>{{ col.column_type }}</td>
                  <td v-html="renderDetailHighlighted(col.column_comment || '-')"></td>
                </tr>
              </tbody>
            </table>
            <div v-else class="muted p-10">暂无命中 Schema 信息</div>
          </div>
        </section>

        <section class="data-box hit-only-section">
          <div class="section-head">
            <h4>全部命中数据（{{ hitOnlyRows.length }} 行）</h4>
            <button class="section-toggle-btn" @click="toggleDataCollapsed">
              {{ dataCollapsed ? "展开" : "收起" }}
            </button>
          </div>
          <div v-show="!dataCollapsed" class="section-body">
            <div class="data-head actions-only">
              <button class="small-btn" @click="jumpToNextHitRow">一键跳转命中(Q/E)</button>
            </div>
            <div v-if="allHitRowsLoading" class="muted p-12">正在汇总全部命中数据...</div>
            <div v-else-if="hitOnlyRows.length === 0" class="muted p-12">暂无命中数据</div>
            <div v-else class="grid-wrap">
              <table class="data-table hit-only-table">
                <thead>
                  <tr>
                    <th>{{ hitOnlyPrimaryHeader }}</th>
                    <th
                      v-for="columnName in hitOnlyDisplayColumns"
                      :key="columnName"
                      :style="getColumnStyle(columnName)"
                    >
                      <div class="th-content" v-html="renderDetailHighlighted(columnName)"></div>
                      <span class="col-resize-handle" @pointerdown="startColumnResize($event, columnName)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in hitOnlyRows"
                    :key="item.localIndex"
                    :data-hit-row-index="item.localIndex"
                    :class="{ hit: true, 'hit-active': tableView.focusedHitLocalIndex === item.localIndex }"
                  >
                    <td>{{ renderHitPrimaryKey(item.row, item.globalIndex) }}</td>
                    <td
                      v-for="columnName in hitOnlyDisplayColumns"
                      :key="columnName"
                      :style="getColumnStyle(columnName)"
                      :class="{ 'hit-cell': isDataCellHit(item.row, columnName) }"
                    >
                      <div class="td-clip" v-html="renderDataCell(item.row, columnName)"></div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </template>
      </div>
      </div>
      </div>
    </section>
  </div>

  <div v-if="tableCommandOpen && isPanelWindow" class="table-command-mask" @mousedown.self="closeTableCommandPalette">
    <section id="tableCommandPalette" class="table-command-palette">
      <header class="table-command-header">
        <span>{{ tableCommandHint }}</span>
        <button class="icon-btn" @click="closeTableCommandPalette">✕</button>
      </header>
      <div class="table-command-input-wrap">
        <span class="table-command-prefix">Ctrl+P</span>
        <input
          id="tableCommandInput"
          v-model="tableCommandQuery"
          type="text"
          :placeholder="tableCommandSlashMode ? 'Slash: 输入表名或备注筛选' : '输入表名，按 Enter 打开'"
          autocomplete="off"
          @keydown="onTableCommandInputKeydown"
        />
      </div>
      <div class="table-command-list">
        <button
          v-for="(item, idx) in tableCommandCandidates"
          :id="`table-command-item-${idx}`"
          :key="item.table_name"
          :class="['table-command-item', { active: idx === tableCommandActiveIndex }]"
          @mouseenter="tableCommandActiveIndex = idx"
          @click="chooseTableCommandCandidate(item)"
        >
          <div class="table-command-main">{{ item.table_name }}</div>
          <div class="table-command-sub">{{ item.table_comment || "-" }}</div>
          <span class="badge" v-if="isTableOpenedInTabs(item.table_name)">已打开</span>
        </button>
        <div v-if="tableCommandCandidates.length === 0" class="muted p-12">暂无可选表</div>
      </div>
    </section>
  </div>

  <div v-if="settingsOpen" class="dialog-mask" @click.self="closeSettings" @dragover.prevent @drop.prevent="onDropConfig">
    <section class="modal-card settings-modal">
      <header class="modal-header">
        <h3>设置</h3>
        <button class="icon-btn" @click="closeSettings">✕</button>
      </header>

        <section class="form-group">
          <h4>数据库连接 <span class="drop-hint">（可拖入 JSON 配置文件）</span></h4>
          <div class="form-grid">
            <label>主机<input v-model="settingsDraft.host" type="text" /></label>
            <label>端口<input v-model.number="settingsDraft.port" type="number" /></label>
            <label>用户名<input v-model="settingsDraft.username" type="text" /></label>
            <label>密码<input v-model="settingsDraft.password" type="password" /></label>
            <label class="full">数据库<input v-model="settingsDraft.database" type="text" /></label>
          </div>
        </section>

        <section class="form-group">
          <h4>系统设置</h4>
          <div class="form-grid">
            <label>快捷键<input v-model="settingsDraft.hotkey" type="text" readonly :placeholder="hotkeyPlaceholder" @keydown="onHotkeyInputKeydown" /></label>
            <label>日期快捷键<input v-model="settingsDraft.quickDateHotkey" type="text" readonly :placeholder="quickDateHotkeyPlaceholder" @keydown="onQuickDateHotkeyInputKeydown" /></label>
            <label>小窗口默认视图
              <select v-model="settingsDraft.tableDefaultView">
                <option value="hits">Tab 页面（只看命中）</option>
                <option value="full">正常页面</option>
              </select>
            </label>
            <label><input v-model="settingsDraft.autoStart" type="checkbox" />开机自启</label>
          </div>
        </section>

        <section class="form-group">
          <h4>挂件待机状态</h4>
          <div class="idle-state-grid">
            <label><input v-model="settingsDraft.idleStates" type="checkbox" value="float_breathe" @change="previewIdleState('float_breathe')" />漂浮呼吸</label>
            <label><input v-model="settingsDraft.idleStates" type="checkbox" value="sleep_zzz" @change="previewIdleState('sleep_zzz')" />打盹(zzz)</label>
            <label><input v-model="settingsDraft.idleStates" type="checkbox" value="look_around" @change="previewIdleState('look_around')" />左右张望</label>
            <label><input v-model="settingsDraft.idleStates" type="checkbox" value="ghost_fade" @change="previewIdleState('ghost_fade')" />半透明潜行</label>
          </div>
        </section>

        <section class="form-group">
          <h4>搜索设置</h4>
          <div class="form-grid">
            <label class="full">排除表（正则，逗号分隔）<input v-model="settingsDraft.excludeTables" type="text" /></label>
            <label>单表超时(秒)<input v-model.number="settingsDraft.perTableTimeoutSec" type="number" /></label>
            <label>每表最大行数<input v-model.number="settingsDraft.perTableMaxRows" type="number" /></label>
          </div>
        </section>

        <footer class="modal-footer">
          <span v-if="settingsMsg" class="settings-msg" :class="{ ok: settingsMsg.startsWith('✓'), err: settingsMsg.startsWith('✗') }">{{ settingsMsg }}</span>
          <button class="small-btn" @click="triggerImport">导入共享配置</button>
          <button class="small-btn" @click="testConnect">测试连接</button>
          <button class="primary-btn" @click="saveSettings">保存设置</button>
        </footer>
      <input id="importFile" class="hidden" type="file" accept="application/json" @change="onImportConfig" />
    </section>
  </div>

  <div
    v-if="copyToast.visible"
    :key="copyToast.version"
    :class="['copy-toast', `is-${copyToast.tone}`]"
    role="status"
    aria-live="polite"
  >
    {{ copyToast.text }}
  </div>
</template>
