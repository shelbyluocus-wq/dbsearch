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
const tableDetailView = ref("full");
const tableFullscreen = ref(false);
const historyOpen = ref(false);
const resultZoomOpen = ref(false);
const resultZoomType = ref("table");
const settingsMsg = ref("");

const keyword = ref("");
const dbConnected = ref(false);
const dbName = ref("未连接");
const summaryText = ref("输入关键词开始搜索");

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
    always_on_top: true,
    auto_start: false,
    pet_locked: false,
    pet_position: null,
    idle_states: ["float_breathe", "sleep_zzz", "look_around", "ghost_fade"],
  },
});

const history = ref([]);
const allHitRows = ref([]);
const allHitRowsLoading = ref(false);
let debounceTimer = null;
let currentSearchToken = 0;
let hitCollectToken = 0;
let unlistenProgress = null;
let unlistenPanelOpenSettings = null;
let unlistenPetLockChanged = null;
let unlistenMenuOpened = null;
let unlistenPetMoved = null;
let unlistenSearchFound = null;
let unlistenPetIdleStatesChanged = null;
let unlistenPetIdlePreview = null;

const petIdleActive = ref(false);
const currentIdleState = ref("float_breathe");
const petIdlePreviewing = ref(false);
const petFound = ref(false);
let idleTimer = null;
let idleStateTimer = null;
let resetIdleHandler = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_STATE_CHANGE_MS = 7 * 1000;
const ALLOWED_IDLE_STATES = ["float_breathe", "sleep_zzz", "look_around", "ghost_fade"];

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

const detailHitContext = reactive({
  source: "none",
  terms: [],
  columns: [],
});

const settingsDraft = reactive({
  host: "",
  port: 3306,
  username: "",
  password: "",
  database: "",
  hotkey: "Ctrl+Shift+F",
  autoStart: false,
  idleStates: ["float_breathe", "sleep_zzz", "look_around", "ghost_fade"],
  excludeTables: "^t_log_.*,^tmp_.*",
  perTableTimeoutSec: 10,
  perTableMaxRows: 50,
});

const totalMetaCount = computed(() => results.table.length + results.column.length + results.comment.length);
const canSearchData = computed(() => keyword.value.trim().length > 0);
const totalPages = computed(() => Math.max(1, Math.ceil(tableView.totalRows / tableView.pageSize)));
const lockActionText = computed(() => (config.personal.pet_locked ? "📌 解锁位置" : "📌 锁定位置"));
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
const hitOnlySchemaColumns = computed(() => tableView.columns.filter((col) => isSchemaColumnHit(col)));
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

function setDetailHitContext({ source = "none", columns = [], terms = [] } = {}) {
  detailHitContext.source = source;
  detailHitContext.columns = [...new Set((Array.isArray(columns) ? columns : []).filter(Boolean))];
  detailHitContext.terms = sanitizeTerms(terms);
}

onMounted(async () => {
  if (isTauriWindow) {
    windowLabel.value = getCurrentWindow().label;
  }

  await loadConfig();

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
    await attachProgressListener();
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
  if (!tableOpen.value) return;
  if (view === "hits") {
    collectAllHitRows().catch(() => {});
  }
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
  document.addEventListener("dragover", onDocDragover);
  document.addEventListener("drop", onDocDrop);
}

function detachPanelListeners() {
  window.removeEventListener("click", onWindowClick);
  window.removeEventListener("keydown", onWindowKeydown);
  document.removeEventListener("dragover", onDocDragover);
  document.removeEventListener("drop", onDocDrop);
}

function onWindowClick(event) {
  const historyPanel = document.getElementById("historyDropdown");
  if (historyPanel && !historyPanel.contains(event.target) && event.target.id !== "historyBtn") {
    historyOpen.value = false;
  }
}

function onWindowKeydown(event) {
  if (tableOpen.value && event.key === "Tab") {
    event.preventDefault();
    toggleTableDetailView();
    return;
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

function onHotkeyInputKeydown(event) {
  if (event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Backspace" || event.key === "Delete") {
    settingsDraft.hotkey = "";
    return;
  }

  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");

  const key = mapEventKeyToHotkey(event);
  if (key) parts.push(key);

  settingsDraft.hotkey = parts.join("+");
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
  settingsDraft.autoStart = config.personal.auto_start;
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
  config.personal.idle_states = sanitizeIdleStates(settingsDraft.idleStates);
  if (isModifierOnlyHotkey(config.personal.hotkey)) {
    settingsMsg.value = "✗ 快捷键必须包含至少一个非修饰键，例如 Ctrl+Shift+F";
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
}

function toggleTableFullscreen() {
  tableFullscreen.value = !tableFullscreen.value;
  if (isTauriWindow && isPanelWindow.value) {
    getCurrentWindow().setFullscreen(tableFullscreen.value).catch(() => {});
  }
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

async function jumpToNextHitRow() {
  if (allHitRows.value.length === 0) {
    await collectAllHitRows();
  }
  if (allHitRows.value.length === 0) {
    summaryText.value = "未找到命中数据行";
    return;
  }

  tableView.hitNavCursor = (tableView.hitNavCursor + 1) % allHitRows.value.length;
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

function chooseHistory(item) {
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
  await openTable(item.table_name, null, item.column_name || null, {
    source: "meta",
    columns: item.column_name ? [item.column_name] : [],
    terms: splitKeywordTerms(keyword.value),
  });
}

async function openFromData(item) {
  const rowIndex = item.first_row_index ?? null;
  const columns = Array.isArray(item.matched_columns) ? item.matched_columns.filter(Boolean) : [];
  const col = columns[0] || null;
  await openTable(item.table_name, rowIndex, col, {
    source: "data",
    columns,
    terms: splitKeywordTerms(keyword.value),
  });
}

async function openTable(tableName, rowIndex = null, columnName = null, hitContext = {}) {
  resultZoomOpen.value = false;
  tableDetailView.value = "full";
  hitCollectToken += 1;
  allHitRows.value = [];
  allHitRowsLoading.value = false;
  tableView.hitNavCursor = -1;
  tableView.focusedHitLocalIndex = null;
  if (tableFullscreen.value && isTauriWindow && isPanelWindow.value) {
    getCurrentWindow().setFullscreen(false).catch(() => {});
  }
  tableFullscreen.value = false;
  tableView.tableName = tableName;
  tableView.hitRowIndex = rowIndex;
  tableView.hitColumn = columnName;
  setDetailHitContext(hitContext);
  tableView.page = rowIndex !== null && rowIndex >= 0 ? Math.floor(rowIndex / tableView.pageSize) + 1 : 1;
  await loadTablePage({ resetFocus: true, clearHitCache: true });
  tableOpen.value = true;
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
  if (tableFullscreen.value && isTauriWindow && isPanelWindow.value) {
    getCurrentWindow().setFullscreen(false).catch(() => {});
  }
  tableOpen.value = false;
  tableDetailView.value = "full";
  tableFullscreen.value = false;
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
    } else if (action === "refresh") {
      await invoke("refresh_schema");
    } else if (action === "lock") {
      const locked = await invoke("toggle_pet_lock");
      config.personal.pet_locked = !!locked;
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    summaryText.value = `已复制: ${text}`;
    setTimeout(() => {
      summaryText.value = totalMetaCount.value > 0
        ? `元信息结果：${totalMetaCount.value} 条`
        : "输入关键词开始搜索";
    }, 1200);
  } catch {
    // ignore
  }
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
        <span class="window-title">鹰捷</span>
        <div class="header-actions">
          <span :class="['db-status', { connected: dbConnected }]" id="dbStatusDot"></span>
          <span class="db-name" id="dbName">{{ dbName }}</span>
          <button class="icon-btn" title="设置" @click="openSettings">⚙</button>
        </div>
      </header>

      <section class="search-panel">
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input id="keywordInput" v-model="keyword" type="text" placeholder="输入关键词搜索表名、字段名、备注..." autocomplete="off" @keydown.enter.exact="runDataSearch" />
          <button id="historyBtn" class="ghost-btn" @click="toggleHistory">历史</button>
        </div>

        <div v-if="historyOpen" id="historyDropdown" class="history-dropdown">
          <div v-for="item in history" :key="item" class="history-row">
            <button class="history-item" @click="chooseHistory(item)">{{ item }}</button>
            <button class="history-delete" title="删除该记录" @click.stop="removeHistory(item)">✕</button>
          </div>
          <div v-if="history.length === 0" class="muted p-12">暂无历史</div>
        </div>

        <div class="search-options">
          <label><input v-model="options.table" type="checkbox" />表名</label>
          <label><input v-model="options.column" type="checkbox" />字段名</label>
          <label><input v-model="options.comment" type="checkbox" />备注</label>
          <label><input v-model="options.data" type="checkbox" />数据值</label>
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

      <section class="results" id="resultsWrap">
        <article class="result-group">
          <header @click="openResultZoom('table')">
            <div class="group-title-row">
              <h3>表名匹配</h3>
              <button class="group-expand-btn" title="放大查看" @click.stop="openResultZoom('table')">⤢</button>
            </div>
            <span>{{ results.table.length }}</span>
          </header>
          <div class="list list-scrollable">
            <button v-for="item in results.table" :key="`${item.table_name}-${item.match_type}-${item.matched_text}`" class="list-item" @click="openFromMeta(item)">
              <div class="main" v-html="renderHighlighted(item.table_name)"></div>
              <span class="badge">TABLE</span>
              <span class="copy-icon-btn" role="button" tabindex="0" @click.stop="copyText(item.table_name)" title="复制">⎘</span>
            </button>
            <div v-if="results.table.length === 0" class="muted p-10">暂无结果</div>
          </div>
        </article>

        <article class="result-group">
          <header @click="openResultZoom('column')">
            <div class="group-title-row">
              <h3>字段名匹配</h3>
              <button class="group-expand-btn" title="放大查看" @click.stop="openResultZoom('column')">⤢</button>
            </div>
            <span>{{ results.column.length }}</span>
          </header>
          <div class="list list-scrollable">
            <button v-for="item in results.column" :key="`${item.table_name}-${item.column_name}-${item.match_type}`" class="list-item" @click="openFromMeta(item)">
              <div class="main" v-html="`${item.table_name}.` + renderHighlighted(item.column_name || '')"></div>
              <span class="badge">FIELD</span>
              <span class="copy-icon-btn" role="button" tabindex="0" @click.stop="copyText(item.column_name || item.table_name)" title="复制">⎘</span>
            </button>
            <div v-if="results.column.length === 0" class="muted p-10">暂无结果</div>
          </div>
        </article>

        <article class="result-group">
          <header @click="openResultZoom('comment')">
            <div class="group-title-row">
              <h3>备注匹配</h3>
              <button class="group-expand-btn" title="放大查看" @click.stop="openResultZoom('comment')">⤢</button>
            </div>
            <span>{{ results.comment.length }}</span>
          </header>
          <div class="list list-scrollable">
            <button v-for="item in results.comment" :key="`${item.table_name}-${item.column_name || ''}-${item.match_type}-${item.matched_text}`" class="list-item" @click="openFromMeta(item)">
              <div class="main">{{ item.table_name }}<span v-if="item.column_name">.{{ item.column_name }}</span></div>
              <div class="sub" v-html="renderHighlighted(item.matched_text)"></div>
              <span class="badge">{{ item.match_type === 'TableComment' ? '表备注' : '列备注' }}</span>
              <span class="copy-icon-btn" role="button" tabindex="0" @click.stop="copyText(item.column_name || item.table_name)" title="复制">⎘</span>
            </button>
            <div v-if="results.comment.length === 0" class="muted p-10">暂无结果</div>
          </div>
        </article>

        <article class="result-group">
          <header @click="openResultZoom('data')">
            <div class="group-title-row">
              <h3>数据值匹配</h3>
              <button class="group-expand-btn" title="放大查看" @click.stop="openResultZoom('data')">⤢</button>
            </div>
            <span>{{ results.data.length }}</span>
          </header>
          <div class="list list-scrollable">
            <button v-for="item in results.data" :key="`${item.table_name}-${item.total_matches}`" class="list-item" @click="openFromData(item)">
              <div class="main">{{ item.table_name }} · {{ item.total_matches }} 条命中</div>
              <div class="sub">{{ (item.matched_columns || []).join(' · ') }}</div>
              <span class="badge">DATA</span>
            </button>
            <div v-if="results.data.length === 0" class="muted p-10">暂无结果</div>
          </div>
        </article>
      </section>
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
      <button @click="contextAction('refresh')">🔄 刷新缓存</button>
      <button @click="contextAction('lock')">{{ lockActionText }}</button>
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
              <span class="badge">DATA</span>
            </button>
          </template>
          <div v-if="resultZoomItems.length === 0" class="muted p-12">暂无结果</div>
        </div>
      </section>
    </section>
  </div>

  <div v-if="tableOpen" class="dialog-mask" @click.self="closeTableDialog">
    <section :class="['modal-card', 'wide', 'table-modal', { fullscreen: tableFullscreen }]">
      <header class="modal-header">
        <h3>{{ tableView.tableName }}</h3>
        <div class="table-header-actions">
          <button class="small-btn" @click="toggleTableDetailView">{{ tableDetailView === 'full' ? '只看命中(Tab)' : '返回原页(Tab)' }}</button>
          <button class="small-btn" @click="jumpToNextHitRow">一键跳转命中</button>
          <button class="small-btn" @click="toggleTableFullscreen">{{ tableFullscreen ? '退出全屏' : '全屏查看' }}</button>
          <button class="icon-btn" @click="closeTableDialog">✕</button>
        </div>
      </header>

      <div class="table-content">
      <template v-if="tableDetailView === 'full'">
        <section class="schema-box">
          <h4>Schema 信息（命中 {{ hitOnlySchemaColumns.length }}）</h4>
          <div v-if="tableView.tableComment" class="table-comment" v-html="renderDetailHighlighted(tableView.tableComment)"></div>
          <table class="schema-table">
            <thead>
              <tr><th>字段名</th><th>类型</th><th>备注</th></tr>
            </thead>
            <tbody>
              <tr v-for="col in tableView.columns" :key="col.column_name" :class="{ hit: isSchemaColumnHit(col) }">
                <td v-html="renderDetailHighlighted(col.column_name)"></td>
                <td>{{ col.column_type }}</td>
                <td v-html="renderDetailHighlighted(col.column_comment || '-')"></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="data-box">
          <div class="data-head">
            <h4>表数据（共 {{ tableView.totalRows }} 行）</h4>
            <div class="data-actions">
              <button class="small-btn" @click="jumpToNextHitRow">一键跳转命中</button>
              <div class="pager">
                <button :disabled="tableView.page <= 1" @click="prevPage">上一页</button>
                <span>{{ tableView.page }} / {{ totalPages }}</span>
                <button :disabled="tableView.page >= totalPages" @click="nextPage">下一页</button>
              </div>
            </div>
          </div>

          <div class="grid-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th
                    v-for="col in tableView.columns"
                    :key="col.column_name"
                    :class="{ 'hit-col': isDataColumnHit(col.column_name) }"
                    v-html="renderTableColumnHeader(col.column_name)"
                  ></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, idx) in tableView.rows"
                  :key="idx"
                  :data-hit-row-index="idx"
                  :class="{ hit: isDataRowHit(row, idx), 'hit-active': tableView.focusedHitLocalIndex === idx }"
                >
                  <td
                    v-for="col in tableView.columns"
                    :key="col.column_name"
                    :class="{ 'hit-cell': isDataCellHit(row, col.column_name) }"
                    v-html="renderDataCell(row, col.column_name)"
                  ></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="schema-box hit-only-section">
          <h4>命中 Schema（{{ hitOnlySchemaColumns.length }}）</h4>
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
        </section>

        <section class="data-box hit-only-section">
          <div class="data-head">
            <h4>全部命中数据（{{ hitOnlyRows.length }} 行）</h4>
            <button class="small-btn" @click="jumpToNextHitRow">一键跳转命中</button>
          </div>
          <div v-if="allHitRowsLoading" class="muted p-12">正在汇总全部命中数据...</div>
          <div v-else-if="hitOnlyRows.length === 0" class="muted p-12">暂无命中数据</div>
          <div v-else class="grid-wrap">
            <table class="data-table hit-only-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th v-for="columnName in hitOnlyDisplayColumns" :key="columnName" v-html="renderDetailHighlighted(columnName)"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in hitOnlyRows"
                  :key="item.localIndex"
                  :data-hit-row-index="item.localIndex"
                  :class="{ hit: true, 'hit-active': tableView.focusedHitLocalIndex === item.localIndex }"
                >
                  <td>{{ item.globalIndex }}</td>
                  <td
                    v-for="columnName in hitOnlyDisplayColumns"
                    :key="columnName"
                    :class="{ 'hit-cell': isDataCellHit(item.row, columnName) }"
                    v-html="renderDataCell(item.row, columnName)"
                  ></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
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
</template>
