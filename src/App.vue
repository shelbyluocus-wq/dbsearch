<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";

const isTauriWindow = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const windowLabel = ref("browser");

const isPetWindow = computed(() => isTauriWindow && windowLabel.value === "main");
const isMenuWindow = computed(() => isTauriWindow && windowLabel.value === "pet_menu");
const isPanelWindow = computed(() => !isPetWindow.value && !isMenuWindow.value);

const settingsOpen = ref(false);
const tableOpen = ref(false);
const historyOpen = ref(false);

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
  },
});

const history = ref([]);
let debounceTimer = null;
let currentSearchToken = 0;
let unlistenProgress = null;
let unlistenPanelOpenSettings = null;
let unlistenPetLockChanged = null;
let unlistenMenuOpened = null;
let unlistenPetMoved = null;

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
});

const settingsDraft = reactive({
  host: "",
  port: 3306,
  username: "",
  password: "",
  database: "",
  widgetMode: "tray",
  hotkey: "Ctrl+Shift+F",
  alwaysOnTop: true,
  excludeTables: "^t_log_.*,^tmp_.*",
  perTableTimeoutSec: 10,
  perTableMaxRows: 50,
});

const totalMetaCount = computed(() => results.table.length + results.column.length + results.comment.length);
const canSearchData = computed(() => options.data && keyword.value.trim().length > 0);
const totalPages = computed(() => Math.max(1, Math.ceil(tableView.totalRows / tableView.pageSize)));
const lockActionText = computed(() => (config.personal.pet_locked ? "📌 解锁位置" : "📌 锁定位置"));
const hotkeyPlaceholder = "点击后按下快捷键";

onMounted(async () => {
  if (isTauriWindow) {
    windowLabel.value = getCurrentWindow().label;
  }

  await loadConfig();

  if (isPanelWindow.value) {
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
});

watch(keyword, () => {
  if (!isPanelWindow.value) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runMetaSearch(), 300);
});

watch(
  () => [options.table, options.column, options.comment, options.data],
  () => {
    if (!isPanelWindow.value) return;
    runMetaSearch();
  },
);

function bindPanelListeners() {
  window.addEventListener("click", onWindowClick);
  window.addEventListener("keydown", onWindowKeydown);
}

function detachPanelListeners() {
  window.removeEventListener("click", onWindowClick);
  window.removeEventListener("keydown", onWindowKeydown);
}

function onWindowClick(event) {
  const historyPanel = document.getElementById("historyDropdown");
  if (historyPanel && !historyPanel.contains(event.target) && event.target.id !== "historyBtn") {
    historyOpen.value = false;
  }
}

function onWindowKeydown(event) {
  if (event.key !== "Escape") return;

  if (tableOpen.value) {
    tableOpen.value = false;
    return;
  }

  if (settingsOpen.value) {
    settingsOpen.value = false;
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

async function quickToggleAlwaysOnTop() {
  config.personal.always_on_top = !config.personal.always_on_top;
  await persistConfig();
  if (isTauriWindow) {
    await invoke("set_panel_always_on_top", { alwaysOnTop: config.personal.always_on_top }).catch(() => {});
  }
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
  settingsDraft.widgetMode = config.personal.widget_mode;
  settingsDraft.hotkey = normalizeHotkeyDisplay(config.personal.hotkey);
  settingsDraft.alwaysOnTop = config.personal.always_on_top;
  settingsDraft.excludeTables = (config.shared.search.exclude_tables || []).join(",");
  settingsDraft.perTableTimeoutSec = config.shared.search.per_table_timeout_sec;
  settingsDraft.perTableMaxRows = config.shared.search.per_table_max_rows;
  settingsOpen.value = true;
}

function closeSettings() {
  settingsOpen.value = false;
}

async function testConnect() {
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
    summaryText.value = msg;
    await refreshConnectionStatus();
  } catch (error) {
    summaryText.value = `连接失败：${String(error)}`;
  }
}

async function saveSettings() {
  const previousHotkey = config.personal.hotkey;
  config.shared.db.host = settingsDraft.host.trim();
  config.shared.db.port = Number(settingsDraft.port) || 3306;
  config.shared.db.username = settingsDraft.username.trim();
  config.shared.db.password = settingsDraft.password;
  config.shared.db.database = settingsDraft.database.trim();

  config.personal.widget_mode = settingsDraft.widgetMode;
  config.personal.hotkey = normalizeHotkeyDisplay(settingsDraft.hotkey.trim() || "Ctrl+Shift+F");
  if (isModifierOnlyHotkey(config.personal.hotkey)) {
    summaryText.value = "快捷键必须包含至少一个非修饰键，例如 Ctrl+Shift+F";
    return;
  }
  config.personal.always_on_top = !!settingsDraft.alwaysOnTop;

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
      summaryText.value = `快捷键注册失败：${String(error)}`;
      return;
    }
  }

  await persistConfig();

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

  if (isTauriWindow) {
    await invoke("set_panel_always_on_top", { alwaysOnTop: config.personal.always_on_top }).catch(() => {});
  }

  await refreshConnectionStatus();
  settingsOpen.value = false;
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value;
}

function chooseHistory(item) {
  keyword.value = item;
  historyOpen.value = false;
  runMetaSearch();
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

  addHistory(value);
  const scope = options.data ? "All" : "MetaOnly";

  try {
    const response = await invoke("search", {
      params: {
        keyword: value,
        scope,
        targetTable: null,
      },
    });

    const meta = response.meta_results || [];
    results.table = options.table ? meta.filter((item) => item.match_type === "TableName") : [];
    results.column = options.column ? meta.filter((item) => item.match_type === "ColumnName") : [];
    results.comment = options.comment
      ? meta.filter((item) => item.match_type === "TableComment" || item.match_type === "ColumnComment")
      : [];

    if (!options.data) {
      results.data = [];
    }

    summaryText.value = `元信息结果：${totalMetaCount.value} 条`;
  } catch (error) {
    summaryText.value = `搜索失败：${String(error)}`;
  }
}

async function runDataSearch() {
  if (!canSearchData.value) return;

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

async function refreshSchema() {
  try {
    const info = await invoke("refresh_schema");
    summaryText.value = `Schema 已刷新：${info.table_count} 张表`;
  } catch (error) {
    summaryText.value = `刷新失败：${String(error)}`;
  }
}

function renderHighlighted(text) {
  const term = escapeHtml(keyword.value.trim());
  if (!term) return escapeHtml(text || "");

  const raw = escapeHtml(String(text || ""));
  const regex = new RegExp(`(${escapeRegExp(term)})`, "ig");
  return raw.replace(regex, "<mark>$1</mark>");
}

async function openFromMeta(item) {
  await openTable(item.table_name, null, item.column_name || null);
}

async function openFromData(item) {
  const rowIndex = item.first_row_index ?? null;
  const col = (item.matched_columns && item.matched_columns[0]) || null;
  await openTable(item.table_name, rowIndex, col);
}

async function openTable(tableName, rowIndex = null, columnName = null) {
  tableView.tableName = tableName;
  tableView.hitRowIndex = rowIndex;
  tableView.hitColumn = columnName;
  tableView.page = rowIndex !== null && rowIndex >= 0 ? Math.floor(rowIndex / tableView.pageSize) + 1 : 1;
  await loadTablePage();
  tableOpen.value = true;
}

async function loadTablePage() {
  if (!tableView.tableName) return;
  try {
    const payload = await invoke("get_table_data", {
      tableName: tableView.tableName,
      page: tableView.page,
      pageSize: tableView.pageSize,
    });

    tableView.columns = payload.columns || [];
    tableView.rows = payload.rows || [];
    tableView.totalRows = payload.total_rows || 0;
    tableView.tableComment = payload.table_comment || "";
  } catch (error) {
    summaryText.value = `读取表数据失败：${String(error)}`;
  }
}

async function prevPage() {
  if (tableView.page <= 1) return;
  tableView.page -= 1;
  await loadTablePage();
}

async function nextPage() {
  if (tableView.page >= totalPages.value) return;
  tableView.page += 1;
  await loadTablePage();
}

function closeTableDialog() {
  tableOpen.value = false;
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

function exportConfig() {
  const payload = {
    db: config.shared.db,
    search: config.shared.search,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "db_config.json";
  a.click();
  URL.revokeObjectURL(url);
}

function triggerImport() {
  const file = document.getElementById("importFile");
  file?.click();
}

async function onImportConfig(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (parsed.db) Object.assign(config.shared.db, parsed.db);
    if (parsed.search) Object.assign(config.shared.search, parsed.search);
    await persistConfig();
    summaryText.value = "共享配置导入成功";
  } catch {
    summaryText.value = "共享配置导入失败";
  } finally {
    event.target.value = "";
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
  <main v-if="isPanelWindow" class="app-shell open panel-shell" id="appShell">
    <section class="widget" id="widget">
      <header class="widget-header" @pointerdown="panelHeaderPointerDown">
        <div class="traffic-lights">
          <button class="traffic-btn traffic-red" title="隐藏窗口" @click="panelClose"></button>
          <button class="traffic-btn traffic-yellow" title="最小化" @click="panelMinimize"></button>
          <button class="traffic-btn traffic-green" title="最大化/还原" @click="panelToggleMaximize"></button>
        </div>
        <div class="title-drag" data-tauri-drag-region></div>
        <span class="window-title">鹰劫</span>
        <div class="header-actions">
          <span :class="['db-status', { connected: dbConnected }]" id="dbStatusDot"></span>
          <span class="db-name" id="dbName">{{ dbName }}</span>
          <button class="icon-btn" :title="config.personal.always_on_top ? '取消置顶' : '窗口置顶'" @click="quickToggleAlwaysOnTop">📌</button>
          <button class="icon-btn" title="设置" @click="openSettings">⚙</button>
        </div>
      </header>

      <section class="search-panel">
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input id="keywordInput" v-model="keyword" type="text" placeholder="输入关键词搜索表名、字段名、备注..." autocomplete="off" />
          <button id="historyBtn" class="ghost-btn" @click="toggleHistory">历史</button>
        </div>

        <div v-if="historyOpen" id="historyDropdown" class="history-dropdown">
          <button v-for="item in history" :key="item" class="history-item" @click="chooseHistory(item)">{{ item }}</button>
          <div v-if="history.length === 0" class="muted p-12">暂无历史</div>
        </div>

        <div class="search-options">
          <label><input v-model="options.table" type="checkbox" />表名</label>
          <label><input v-model="options.column" type="checkbox" />字段名</label>
          <label><input v-model="options.comment" type="checkbox" />备注</label>
          <label><input v-model="options.data" type="checkbox" />数据值</label>
          <button class="small-btn" @click="refreshSchema">刷新 Schema</button>
        </div>

        <div class="actions-row">
          <button class="primary-btn" :disabled="!canSearchData" @click="runDataSearch">在数据值中搜索</button>
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
          <header><h3>表名匹配</h3><span>{{ results.table.length }}</span></header>
          <div class="list">
            <button v-for="item in results.table" :key="`${item.table_name}-${item.match_type}-${item.matched_text}`" class="list-item" @click="openFromMeta(item)">
              <div class="main" v-html="renderHighlighted(item.table_name)"></div>
              <div class="sub" v-html="renderHighlighted(item.matched_text)"></div>
              <span class="badge">TABLE</span>
            </button>
            <div v-if="results.table.length === 0" class="muted p-10">暂无结果</div>
          </div>
        </article>

        <article class="result-group">
          <header><h3>字段名匹配</h3><span>{{ results.column.length }}</span></header>
          <div class="list">
            <button v-for="item in results.column" :key="`${item.table_name}-${item.column_name}-${item.match_type}`" class="list-item" @click="openFromMeta(item)">
              <div class="main" v-html="`${item.table_name}.` + renderHighlighted(item.column_name || '')"></div>
              <div class="sub" v-html="renderHighlighted(item.matched_text)"></div>
              <span class="badge">FIELD</span>
            </button>
            <div v-if="results.column.length === 0" class="muted p-10">暂无结果</div>
          </div>
        </article>

        <article class="result-group">
          <header><h3>备注匹配</h3><span>{{ results.comment.length }}</span></header>
          <div class="list">
            <button v-for="item in results.comment" :key="`${item.table_name}-${item.column_name || ''}-${item.match_type}-${item.matched_text}`" class="list-item" @click="openFromMeta(item)">
              <div class="main">{{ item.table_name }}<span v-if="item.column_name">.{{ item.column_name }}</span></div>
              <div class="sub" v-html="renderHighlighted(item.matched_text)"></div>
              <span class="badge">COMMENT</span>
            </button>
            <div v-if="results.comment.length === 0" class="muted p-10">暂无结果</div>
          </div>
        </article>

        <article class="result-group">
          <header><h3>数据值匹配</h3><span>{{ results.data.length }}</span></header>
          <div class="list">
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
      aria-label="鹰劫"
      data-tauri-drag-region
      @click="togglePanel"
      @contextmenu="openContextMenu"
      @pointerdown="petPointerDown"
    >
      <div class="eagle-container">
        <div id="eagleSprite" class="eagle-sprite" :class="{ searching: progress.show }">
          <div class="blink-overlay"></div>
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

  <div v-if="tableOpen" class="dialog-mask" @click.self="closeTableDialog">
    <section class="modal-card wide">
      <header class="modal-header">
        <h3>{{ tableView.tableName }}（{{ tableView.tableComment || '无备注' }}）</h3>
        <button class="icon-btn" @click="closeTableDialog">✕</button>
      </header>

      <section class="schema-box">
        <h4>Schema 信息</h4>
        <table class="schema-table">
          <thead>
            <tr><th>字段名</th><th>类型</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="col in tableView.columns" :key="col.column_name">
              <td>{{ col.column_name }}</td>
              <td>{{ col.column_type }}</td>
              <td>{{ col.column_comment || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="data-box">
        <div class="data-head">
          <h4>表数据（共 {{ tableView.totalRows }} 行）</h4>
          <div class="pager">
            <button :disabled="tableView.page <= 1" @click="prevPage">上一页</button>
            <span>{{ tableView.page }} / {{ totalPages }}</span>
            <button :disabled="tableView.page >= totalPages" @click="nextPage">下一页</button>
          </div>
        </div>

        <div class="grid-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th v-for="col in tableView.columns" :key="col.column_name">{{ col.column_name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, idx) in tableView.rows"
                :key="idx"
                :class="{
                  hit:
                    tableView.hitRowIndex !== null &&
                    tableView.hitRowIndex >= (tableView.page - 1) * tableView.pageSize &&
                    tableView.hitRowIndex < tableView.page * tableView.pageSize &&
                    idx === tableView.hitRowIndex - (tableView.page - 1) * tableView.pageSize,
                }"
              >
                <td v-for="col in tableView.columns" :key="col.column_name">{{ row[col.column_name] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  </div>

  <div v-if="settingsOpen" class="dialog-mask" @click.self="closeSettings">
    <section class="modal-card settings-modal">
      <header class="modal-header">
        <h3>设置</h3>
        <button class="icon-btn" @click="closeSettings">✕</button>
      </header>

      <section class="form-group">
        <h4>数据库连接</h4>
        <div class="form-grid">
          <label>主机<input v-model="settingsDraft.host" type="text" /></label>
          <label>端口<input v-model.number="settingsDraft.port" type="number" /></label>
          <label>用户名<input v-model="settingsDraft.username" type="text" /></label>
          <label>密码<input v-model="settingsDraft.password" type="password" /></label>
          <label class="full">数据库<input v-model="settingsDraft.database" type="text" /></label>
        </div>
      </section>

      <section class="form-group">
        <h4>挂件模式</h4>
        <div class="mode-row">
          <label><input v-model="settingsDraft.widgetMode" type="radio" value="tray" />托盘常驻 + 快捷键</label>
          <label><input v-model="settingsDraft.widgetMode" type="radio" value="floating" />桌面悬浮小窗</label>
        </div>
        <div class="form-grid">
          <label>快捷键<input v-model="settingsDraft.hotkey" type="text" readonly :placeholder="hotkeyPlaceholder" @keydown="onHotkeyInputKeydown" /></label>
          <label><input v-model="settingsDraft.alwaysOnTop" type="checkbox" />面板窗口置顶显示</label>
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
        <button class="small-btn" @click="triggerImport">导入共享配置</button>
        <button class="small-btn" @click="exportConfig">导出共享配置</button>
        <button class="small-btn" @click="testConnect">测试连接</button>
        <button class="primary-btn" @click="saveSettings">保存设置</button>
      </footer>
      <input id="importFile" class="hidden" type="file" accept="application/json" @change="onImportConfig" />
    </section>
  </div>
</template>
