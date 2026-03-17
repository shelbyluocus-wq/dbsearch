<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { save, open } from "@tauri-apps/plugin-dialog";
import "./styles.css";
import { WeatherEngine } from "./weatherEngine.js";
import {
  buildPanelTabs,
  describeTableFolderChip,
  findHighlightRanges,
  normalizeBackgroundOpacity,
  panelChromeConstants,
  rankTableSearchCandidates,
  resolveTableDialogKeyAction,
  shouldUseReducedTransparencyMode,
} from "./panelChrome.js";
import {
  getWeatherPresentation,
  normalizeWeatherCategory,
  resolveWeatherSkinState,
} from "./weatherSkin.js";
import {
  appendTimelineByProfile,
  buildHotkeyFromEvent,
  describeSyncProfileCard,
  getTimelineForProfile,
  isEventMatchingHotkey,
  normalizeHotkeyDisplay,
  normalizeSyncWindowHotkey,
  normalizeSyncWorkspaceSettings,
  resolveSyncTargetDirectoryOpenRequest,
  resolveSyncProfileSelection,
} from "./syncWorkspace.js";
import { runPetMenuAction } from "./petMenu.js";

const isTauriWindow = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const windowLabel = ref("browser");

const isPetWindow = computed(() => isTauriWindow && windowLabel.value === "main");
const isMenuWindow = computed(() => isTauriWindow && windowLabel.value === "pet_menu");
const isSyncWorkspaceWindow = computed(() => isTauriWindow && windowLabel.value === "sync_workspace");
const isPanelWindow = computed(() => !isTauriWindow || windowLabel.value === "browser" || windowLabel.value === "panel");
const FIXED_WEATHER_CITY = "厦门市";

const settingsOpen = ref(false);
const settingsTab = ref(-1);
const SETTINGS_TABS = [
  { id: 'connection', label: '连接', icon: '\u{1F5C4}' },
  { id: 'shortcuts',  label: '快捷键', icon: '\u2328' },
  { id: 'appearance', label: '外观', icon: '\u{1F3A8}' },
];
const tableOpen = ref(false);
const tableDetailView = ref("hits");
const tableFullscreen = ref(false);
const schemaCollapsed = ref(true);
const dataCollapsed = ref(false);

// ── 编辑模式 ──
const editMode = ref(false)
const editGlowPhase = ref('none')
const editDirty = ref(false)
const editDateDialogOpen = ref(false)
const editDateInput = ref('')
const editDateError = ref(false)
const editChanges = reactive({
  updates: new Map(),
  inserts: [],
  deletes: new Set(),
})
const editSelectedRows = reactive(new Set())
const editingCell = reactive({ active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
const editNoPkWarningShown = ref(false)
const editSaveDialogOpen = ref(false)
const editUnsavedDialogOpen = ref(false)
const editUnsavedCallback = ref(null)
let editGlowTimer = null

// ── 导出 ──
const exportDialogOpen = ref(false)
const exportSelectedTables = reactive(new Set())
const exportFilter = ref("")
const exportLoading = ref(false)

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
const preferredThemeId = ref(localStorage.getItem('dbsearch-theme') || 'azure')

const THEMES = [
  { id: 'azure',    name: 'Azure',    color: '#0284c7' },
  { id: 'midnight', name: 'Midnight', color: '#334155' },
  { id: 'emerald',  name: 'Emerald',  color: '#059669' },
  { id: 'violet',   name: 'Violet',   color: '#7c3aed' },
  { id: 'typewrite_dark', name: 'Typewrite Dark', color: '#d8a657' },
  { id: 'typewrite_light', name: 'Typewrite Light', color: '#c08457' },
]

const WEATHER_PREVIEW_OPTIONS = [
  { id: "sunny", icon: "☀️", label: "晴天" },
  { id: "cloudy", icon: "⛅", label: "多云" },
  { id: "lightRain", icon: "🌧️", label: "小雨" },
  { id: "heavyRain", icon: "⛈️", label: "大雨" },
  { id: "snow", icon: "❄️", label: "雪天" },
]

function applyTheme(id) {
  preferredThemeId.value = id
  themeId.value = id
  document.documentElement.dataset.theme = id
  localStorage.setItem('dbsearch-theme', id)
  // Auto-disable weather when user picks a theme
  if (weatherEnabled.value) {
    settingsDraft.weatherEnabled = false
    weatherEnabled.value = false
    destroyWeatherEngine()
  }
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
    db_templates: [],
  },
  personal: {
    widget_mode: "tray",
    hotkey: "Ctrl+Shift+F",
    quick_date_hotkey: "F9",
    sync_window_hotkey: "Shift+S",
    always_on_top: true,
    auto_start: false,
    ui_scale: 1.0,
    table_default_view: "hits",
    pet_locked: false,
    pet_position: null,
    idle_states: [
      "float_breathe",
      "sleep_zzz",
      "look_around",
      "ghost_fade",
      "wave_hello",
      "charge_spell",
      "jump_play",
      "spin_show",
    ],
    export_hotkey: "Ctrl+E",
    batch_export_hotkey: "Ctrl+Shift+E",
    template_prev_hotkey: "Ctrl+Alt+Left",
    template_next_hotkey: "Ctrl+Alt+Right",
    reset_on_open_to_all_tables: true,
    always_on_top_hotkey: "P",
    pet_skin: "eagle",
    pet_scale: {},
    custom_font: null,
    weather_enabled: true,
    background_opacity: 1.0,
    reduce_transparency_mode: false,
    sync_profiles: [],
    default_sync_profile_id: null,
    last_used_sync_profile_id: null,
  },
});

const syncWorkspaceHotkey = ref("Shift+S");
const syncWorkspaceProfiles = ref([]);
const syncWorkspaceDefaultProfileId = ref("");
const syncWorkspaceLastUsedProfileId = ref("");
const syncWorkspaceActiveProfileId = ref("");
const syncWorkspaceRunning = ref(false);
const syncWorkspaceMessage = ref("");
const syncWorkspaceMessageTone = ref("neutral");
const syncWorkspaceTimelineByProfile = ref({});
const syncWorkspaceRunProfileId = ref("");
const syncWorkspaceDirty = ref(false);
const syncSettingsOpen = ref(false);
const syncSettingsEditingProfileId = ref("");
const syncContentEditing = ref(false);
const syncWorkspaceHotkeyPlaceholder = "点击后按下快捷键";
let unlistenSyncWorkspaceProgress = null;

// ── Weather state ──
const weatherCanvasRef = ref(null);
const weatherEnabled = ref(true);
const weatherCategory = ref('');
const weatherText = ref('');
const weatherTemp = ref(0);
const weatherCity = ref(FIXED_WEATHER_CITY);
const weatherIcon = ref('');
const weatherPreviewCategory = ref("");
let weatherEngine = null;
let weatherRefreshTimer = null;
const WEATHER_REFRESH_MS = 30 * 60 * 1000;

// Sky background time-of-day system
const skyTime = ref(new Date().getHours() + new Date().getMinutes() / 60)
let skyTimeTimer = null
const skyTimeOverride = ref(null)

const skyEffectiveTime = computed(() => skyTimeOverride.value !== null ? skyTimeOverride.value : skyTime.value)
const weatherSkinState = computed(() => resolveWeatherSkinState({
  weatherEnabled: weatherEnabled.value,
  realWeatherCategory: weatherCategory.value,
  previewWeatherCategory: weatherPreviewCategory.value,
  clockTime: skyTime.value,
  previewTime: skyTimeOverride.value,
}))
const skyDarkness = computed(() => {
  const o = skyOpacities.value
  const cat = weatherSkinState.value.category
  const weatherDark = (cat === 'heavyRain') ? 0.3 : (cat === 'lightRain' || cat === 'cloudy') ? 0.15 : 0
  return Math.min(1, o.night + o.dusk * 0.4 + weatherDark)
})
const weatherPresentation = computed(() => getWeatherPresentation(themeId.value, weatherSkinState.value, skyDarkness.value))
const weatherHeaderLabel = computed(() => weatherText.value || "实时天气")
const weatherHeaderIcon = computed(() => {
  const category = weatherSkinState.value.category
  return WEATHER_PREVIEW_OPTIONS.find((item) => item.id === category)?.icon || weatherIcon.value || "🌤️"
})
const weatherPreviewActive = computed(() => weatherSkinState.value.source === "preview")
const preferredThemeName = computed(() => {
  const t = THEMES.find(t => t.id === preferredThemeId.value)
  return t ? t.name : 'Azure'
})

const skyOpacities = computed(() => {
  const t = skyEffectiveTime.value
  let dawn = 0, day = 0, dusk = 0, night = 0
  if (t >= 4 && t < 8) dawn = 1 - Math.abs(t - 6) / 2
  if (t >= 6 && t < 18) day = 1 - Math.abs(t - 12) / 6
  if (t >= 16 && t < 20) dusk = 1 - Math.abs(t - 18) / 2
  if (t >= 18 || t < 6) night = t >= 18 ? (t - 18) / 6 : 1 - t / 6
  return {
    dawn: Math.max(0, dawn),
    day: Math.max(0, day),
    dusk: Math.max(0, dusk),
    night: Math.max(0, night),
  }
})

const skyBackgroundFilter = computed(() => {
  const cat = weatherSkinState.value.category
  const dark = cat === 'cloudy' || cat === 'lightRain' || cat === 'heavyRain'
  return dark ? 'brightness(0.62) saturate(0.85)' : 'brightness(1) saturate(1)'
})

const weatherQuality = ref('high') // 'high' = CSS effects, 'low' = canvas engine

const WEATHER_ICON_MAP = {
  sunny: '☀️',
  cloudy: '⛅',
  rain: '🌧️',
  lightRain: '🌧️',
  heavyRain: '⛈️',
  snow: '❄️',
};

const UNCATEGORIZED_TABLE_FOLDER_CHIP = Object.freeze({
  label: "",
  extraCount: 0,
  title: "",
  visible: false,
  uncategorized: true,
  folders: [],
});

// ── CSS weather effect elements (computed arrays for v-for) ──
const effectiveWeatherType = computed(() => weatherSkinState.value.category)
const isNightTime = computed(() => weatherSkinState.value.isNight)

const rainDropElements = computed(() => {
  const cat = effectiveWeatherType.value
  if (cat !== 'rain' && cat !== 'lightRain' && cat !== 'heavyRain') return []
  const isHeavy = cat === 'heavyRain'
  const count = weatherQuality.value === 'high' ? (isHeavy ? 100 : 40) : (isHeavy ? 40 : 15)
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${Math.random() * 110}%`,
    duration: isHeavy ? `${0.3 + Math.random() * 0.2}s` : `${0.5 + Math.random() * 0.3}s`,
    delay: `${Math.random() * 2}s`,
    heavy: isHeavy,
  }))
})

const cloudElements = computed(() => {
  const cat = effectiveWeatherType.value
  if (cat === 'sunny') return []
  const isHeavy = cat === 'heavyRain'
  const count = weatherQuality.value === 'high' ? (isHeavy ? 6 : 4) : 2
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    top: `${5 + Math.random() * 20}%`,
    duration: `${40 + Math.random() * 40}s`,
    delay: `-${Math.random() * 40}s`,
    opacity: isHeavy ? 0.9 : 0.7,
    scale: 0.8 + Math.random() * 0.7,
  }))
})

const starElements = computed(() => {
  const cat = effectiveWeatherType.value
  if (cat !== 'sunny' || !isNightTime.value) return []
  return Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    size: `${1 + Math.random() * 2}px`,
    animDuration: `${2 + Math.random() * 3}s`,
  }))
})

const snowElements = computed(() => {
  const cat = effectiveWeatherType.value
  if (cat !== 'snow') return []
  const count = weatherQuality.value === 'high' ? 50 : 25
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    duration: `${4 + Math.random() * 4}s`,
    delay: `${Math.random() * 5}s`,
    size: `${3 + Math.random() * 5}px`,
    drift: `${-20 + Math.random() * 40}px`,
  }))
})

const showSun = computed(() => {
  const cat = effectiveWeatherType.value
  return (cat === 'sunny' || cat === 'cloudy') && !isNightTime.value
})

const sunPosition = computed(() => {
  const t = skyEffectiveTime.value
  return {
    left: `${((t - 6) / 12) * 80 + 10}%`,
    top: `${Math.abs(t - 12) * 4 + 10}%`,
    opacity: effectiveWeatherType.value === 'cloudy' ? 0.3 : 1,
  }
})

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

// ── 表整理：排序 / 文件夹 / 星标 ──
const sortMode = ref("name_asc"); // name_asc | name_desc | comment_asc | comment_desc
const activeFolder = ref("all"); // "all" | "starred" | folder id
const starredTables = reactive(new Set());
const tableFolders = ref([]); // [{ id, name, tables: [] }]
const sortMenuOpen = ref(false);
const folderCtxTarget = ref(null); // folder id being right-clicked
const folderCtxPos = reactive({ x: 0, y: 0 });
const folderRenameId = ref(null);
const folderRenameValue = ref("");
const itemCtxOpen = ref(false);
const itemCtxPos = reactive({ x: 0, y: 0 });
const itemCtxTableName = ref("");
const itemCtxSubMenuOpen = ref(false);
const newFolderDialogOpen = ref(false);
const newFolderName = ref("");
const slashModeOpen = ref(false);
const slashQuery = ref("");
const slashActiveIndex = ref(0);
const tableTabs = ref([]);
const activeTableTabId = ref("");
const tableTabsCompressed = ref(false);
const recentTables = ref([]);
const recentTabsDropdownOpen = ref(false);
const RECENT_TABLES_MAX = 10;
const tableCommandOpen = ref(false);
const tableCommandQuery = ref("");
const tableCommandActiveIndex = ref(0);
const tableCommandSlashMode = ref(false);
const navZone = ref("sidebar");
const navResultIndex = ref(-1);
const templateSwitching = ref(false);
const templateSwitchingIndex = ref(-1);
const templateCursorIndex = ref(-1);
let panelWasHidden = false;
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
const tableTabsRef = ref(null);
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
let tableTabsMeasureRaf = 0;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_STATE_CHANGE_MS = 6 * 1000;
const UI_SCALE_MIN = 0.8;
const UI_SCALE_MAX = 1.4;
const UI_SCALE_STEP = 0.1;
const PET_SCALE_MIN = 0.5;
const PET_SCALE_MAX = 3.0;
const PET_SCALE_STEP = 0.1;
const TABLE_PAGE_SIZE_MIN = 1;
const TABLE_PAGE_SIZE_MAX = 200;
const TABLE_ROW_HEIGHT_FALLBACK = 28;
const TABLE_HEADER_HEIGHT_FALLBACK = 32;
const ALLOWED_IDLE_STATES = [
  "float_breathe",
  "sleep_zzz",
  "look_around",
  "ghost_fade",
  "wave_hello",
  "charge_spell",
  "jump_play",
  "spin_show",
];
const DEFAULT_IDLE_LABELS = {
  float_breathe: "漂浮呼吸",
  sleep_zzz: "打盹(zzz)",
  look_around: "左右张望",
  ghost_fade: "半透明潜行",
  wave_hello: "挥手问好",
  charge_spell: "蓄力施法",
  jump_play: "蹦跳庆祝",
  spin_show: "旋转登场",
};
const SPRITE_SHEET_IDLE_STATES = {
  knight: {
    states: ["knight_idle", "knight_walk", "knight_run", "knight_attack", "knight_hurt"],
    labels: {
      knight_idle: "待命",
      knight_walk: "巡逻",
      knight_run: "冲刺",
      knight_attack: "挥剑",
      knight_hurt: "受击",
    },
    animMap: {
      knight_idle: "idle",
      knight_walk: "walk",
      knight_run: "run",
      knight_attack: "attack",
      knight_hurt: "hurt",
    },
  },
};
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
  idleStates: [
    "float_breathe",
    "sleep_zzz",
    "look_around",
    "ghost_fade",
    "wave_hello",
    "charge_spell",
    "jump_play",
    "spin_show",
  ],
  excludeTables: "^t_log_.*,^tmp_.*",
  perTableTimeoutSec: 10,
  perTableMaxRows: 50,
  exportHotkey: "Ctrl+E",
  batchExportHotkey: "Ctrl+Shift+E",
  alwaysOnTop: true,
  alwaysOnTopHotkey: "P",
  templatePrevHotkey: "Ctrl+Alt+Left",
  templateNextHotkey: "Ctrl+Alt+Right",
  resetOnOpenToAllTables: true,
  templateName: "",
  petSkin: "eagle",
  petScale: 1.0,
  customFont: null,
  weatherEnabled: true,
  backgroundOpacity: 1.0,
  reduceTransparencyMode: false,
});
const backgroundOpacityPercent = computed(() =>
  `${Math.round(normalizeBackgroundOpacity(settingsDraft.backgroundOpacity) * 100)}%`,
);
const SYNC_STEP_LABELS = {
  validate: "环境校验",
  launch_tool: "执行转表工具",
  nvm_recovery: "Node 版本修复",
  locate_artifact: "定位最新产物",
  svn_update: "SVN 更新",
  copy: "文件同步",
  finish: "完成",
};
const SYNC_STATUS_TEXT = {
  idle: "未执行",
  running: "进行中",
  success: "上次成功",
  error: "上次失败",
};
const SYNC_STATUS_TONE = {
  idle: "idle",
  running: "running",
  success: "success",
  error: "error",
};
const activeSyncProfile = computed(() =>
  syncWorkspaceProfiles.value.find((profile) => profile.id === syncWorkspaceActiveProfileId.value) || null,
);
const currentProfileStatusText = computed(() => {
  if (syncWorkspaceRunning.value && activeSyncProfile.value?.id === syncWorkspaceRunProfileId.value) {
    return "\u540C\u6B65\u8FDB\u884C\u4E2D";
  }
  const status = activeSyncProfile.value?.last_run_status || "idle";
  return SYNC_STATUS_TEXT[status] || "\u672A\u6267\u884C";
});
const currentProfileStatusTone = computed(() => {
  if (syncWorkspaceRunning.value && activeSyncProfile.value?.id === syncWorkspaceRunProfileId.value) {
    return "running";
  }
  const status = activeSyncProfile.value?.last_run_status || "idle";
  return SYNC_STATUS_TONE[status] || "idle";
});
const PIPELINE_STEPS = ["validate", "launch_tool", "locate_artifact", "svn_update", "copy", "finish"];
const activeSyncWorkspaceTimeline = computed(() =>
  getTimelineForProfile(syncWorkspaceTimelineByProfile.value, syncWorkspaceActiveProfileId.value),
);
const pipelineStepsView = computed(() => {
  const timeline = activeSyncWorkspaceTimeline.value;
  return PIPELINE_STEPS.map((stepKey) => {
    const entry = timeline.find((e) => e.step === stepKey);
    const status = entry ? entry.status : "pending";
    const icon = status === "success" ? "\u2713" : status === "error" ? "\u2717" : status === "running" ? "\u23F3" : "\u25CB";
    return {
      key: stepKey,
      label: SYNC_STEP_LABELS[stepKey] || stepKey,
      status,
      icon,
      message: entry?.message || "",
      timeLabel: entry ? formatSyncWorkspaceTimestamp(entry.timestamp) : "",
    };
  });
});
const syncWorkspaceProfilesView = computed(() => {
  return [...syncWorkspaceProfiles.value].sort((left, right) => {
    const leftPriority =
      (left.id === syncWorkspaceActiveProfileId.value ? 0 : 1) +
      (left.id === syncWorkspaceDefaultProfileId.value ? 0 : 2) +
      syncWorkspaceProfiles.value.findIndex((profile) => profile.id === left.id) * 10;
    const rightPriority =
      (right.id === syncWorkspaceActiveProfileId.value ? 0 : 1) +
      (right.id === syncWorkspaceDefaultProfileId.value ? 0 : 2) +
      syncWorkspaceProfiles.value.findIndex((profile) => profile.id === right.id) * 10;
    return leftPriority - rightPriority;
  });
});
const syncWorkspaceTimelineView = computed(() =>
  activeSyncWorkspaceTimeline.value.map((entry, index) => ({
    ...entry,
    key: `${entry.timestamp}-${entry.step}-${index}`,
    stepLabel: SYNC_STEP_LABELS[entry.step] || entry.step,
    statusText: SYNC_STATUS_TEXT[entry.status] || entry.status,
    statusTone: SYNC_STATUS_TONE[entry.status] || "idle",
    timeLabel: formatSyncWorkspaceTimestamp(entry.timestamp),
  })),
);

function formatSyncWorkspaceTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour12: false });
}

function markSyncWorkspaceDirty(message = "") {
  syncWorkspaceDirty.value = true;
  if (message) {
    syncWorkspaceMessage.value = message;
    syncWorkspaceMessageTone.value = "neutral";
  }
}

function buildSyncWorkspaceSnapshot() {
  const normalized = normalizeSyncWorkspaceSettings({
    sync_window_hotkey: syncWorkspaceHotkey.value,
    sync_profiles: syncWorkspaceProfiles.value,
    default_sync_profile_id: syncWorkspaceDefaultProfileId.value,
    last_used_sync_profile_id: syncWorkspaceLastUsedProfileId.value,
  });
  const defaultProfileId =
    normalized.defaultProfileId || normalized.profiles[0]?.id || "";
  const lastUsedProfileId =
    normalized.lastUsedProfileId ||
    resolveSyncProfileSelection(normalized.profiles, {
      defaultProfileId,
    });

  return {
    syncWindowHotkey: normalized.syncWindowHotkey,
    profiles: normalized.profiles.map((profile) => ({ ...profile })),
    defaultProfileId,
    lastUsedProfileId,
  };
}

function openSyncSettings() {
  syncSettingsOpen.value = true;
  syncSettingsEditingProfileId.value = "";
}

function closeSyncSettings() {
  syncSettingsOpen.value = false;
  syncSettingsEditingProfileId.value = "";
}

function toggleSettingsProfileEdit(profileId) {
  syncSettingsEditingProfileId.value = syncSettingsEditingProfileId.value === profileId ? "" : profileId;
}

function loadSyncWorkspaceSettingsFromConfig() {
  const snapshot = normalizeSyncWorkspaceSettings(config.personal);
  syncWorkspaceHotkey.value = snapshot.syncWindowHotkey;
  syncWorkspaceProfiles.value = snapshot.profiles.map((profile) => ({ ...profile }));
  syncWorkspaceDefaultProfileId.value = snapshot.defaultProfileId || snapshot.profiles[0]?.id || "";
  syncWorkspaceLastUsedProfileId.value = snapshot.lastUsedProfileId || "";
  syncWorkspaceActiveProfileId.value = resolveSyncProfileSelection(syncWorkspaceProfiles.value, {
    lastUsedProfileId: syncWorkspaceLastUsedProfileId.value,
    defaultProfileId: syncWorkspaceDefaultProfileId.value,
  });
  syncWorkspaceTimelineByProfile.value = Object.fromEntries(
    Object.entries(syncWorkspaceTimelineByProfile.value).filter(([profileId]) =>
      syncWorkspaceProfiles.value.some((profile) => profile.id === profileId),
    ),
  );
  syncWorkspaceDirty.value = false;
}

async function saveSyncWorkspaceSettings({ silent = false } = {}) {
  const snapshot = buildSyncWorkspaceSnapshot();
  let registeredHotkey = snapshot.syncWindowHotkey;

  if (isTauriWindow) {
    try {
      registeredHotkey = await invoke("register_sync_window_hotkey", {
        hotkey: snapshot.syncWindowHotkey,
      });
    } catch (error) {
      syncWorkspaceMessage.value = `✗ 同步窗口快捷键注册失败：${String(error)}`;
      syncWorkspaceMessageTone.value = "error";
      return false;
    }
  }

  config.personal.sync_window_hotkey = normalizeSyncWindowHotkey(registeredHotkey);
  config.personal.sync_profiles = snapshot.profiles.map((profile) => ({ ...profile }));
  config.personal.default_sync_profile_id = snapshot.defaultProfileId || null;
  config.personal.last_used_sync_profile_id = snapshot.lastUsedProfileId || null;

  try {
    await persistConfig();
  } catch (error) {
    syncWorkspaceMessage.value = `✗ 保存同步配置失败：${String(error)}`;
    syncWorkspaceMessageTone.value = "error";
    return false;
  }

  syncWorkspaceHotkey.value = config.personal.sync_window_hotkey;
  syncWorkspaceProfiles.value = config.personal.sync_profiles.map((profile) => ({ ...profile }));
  syncWorkspaceDefaultProfileId.value = config.personal.default_sync_profile_id || "";
  syncWorkspaceLastUsedProfileId.value = config.personal.last_used_sync_profile_id || "";
  syncWorkspaceActiveProfileId.value = resolveSyncProfileSelection(syncWorkspaceProfiles.value, {
    lastUsedProfileId: syncWorkspaceLastUsedProfileId.value,
    defaultProfileId: syncWorkspaceDefaultProfileId.value,
  });
  syncWorkspaceDirty.value = false;
  if (!silent) {
    syncWorkspaceMessage.value = "✓ 同步工作台配置已保存";
    syncWorkspaceMessageTone.value = "success";
  }
  return true;
}

function ensureSyncWorkspaceActiveProfile() {
  syncWorkspaceActiveProfileId.value = resolveSyncProfileSelection(syncWorkspaceProfiles.value, {
    lastUsedProfileId: syncWorkspaceLastUsedProfileId.value,
    defaultProfileId: syncWorkspaceDefaultProfileId.value,
  });
}

function createSyncProfileDraft() {
  const nextIndex = syncWorkspaceProfiles.value.length + 1;
  return {
    id: crypto.randomUUID(),
    name: `同步配置 ${nextIndex}`,
    script_executable_path: "",
    output_root: "",
    target_path: "",
    last_run_status: "idle",
    last_run_at: "",
    last_run_summary: "",
  };
}

function addSyncProfile() {
  const profile = createSyncProfileDraft();
  syncWorkspaceProfiles.value = [...syncWorkspaceProfiles.value, profile];
  syncWorkspaceActiveProfileId.value = profile.id;
  if (!syncWorkspaceDefaultProfileId.value) {
    syncWorkspaceDefaultProfileId.value = profile.id;
  }
  syncContentEditing.value = true;
  markSyncWorkspaceDirty("已新增同步配置，填写下方路径后点击保存。");
}

function removeSyncProfile(profileId) {
  syncWorkspaceProfiles.value = syncWorkspaceProfiles.value.filter((profile) => profile.id !== profileId);
  const nextTimelineByProfile = { ...syncWorkspaceTimelineByProfile.value };
  delete nextTimelineByProfile[profileId];
  syncWorkspaceTimelineByProfile.value = nextTimelineByProfile;
  if (syncWorkspaceDefaultProfileId.value === profileId) {
    syncWorkspaceDefaultProfileId.value = syncWorkspaceProfiles.value[0]?.id || "";
  }
  if (syncWorkspaceLastUsedProfileId.value === profileId) {
    syncWorkspaceLastUsedProfileId.value = "";
  }
  if (syncWorkspaceActiveProfileId.value === profileId) {
    ensureSyncWorkspaceActiveProfile();
  }
  markSyncWorkspaceDirty("已移除同步配置，记得保存。");
}

function focusSyncProfile(profileId) {
  syncWorkspaceActiveProfileId.value = profileId;
  syncContentEditing.value = false;
}

function setDefaultSyncProfile(profileId) {
  syncWorkspaceDefaultProfileId.value = profileId;
  focusSyncProfile(profileId);
  markSyncWorkspaceDirty("默认同步配置已更新。");
}

function updateSyncProfileField(profileId, key, value) {
  const target = syncWorkspaceProfiles.value.find((profile) => profile.id === profileId);
  if (!target) return;
  target[key] = value;
  focusSyncProfile(profileId);
  markSyncWorkspaceDirty();
}

async function chooseSyncExecutable(profileId) {
  const result = await open({
    title: "选择脚本软件",
    multiple: false,
  });
  if (!result || Array.isArray(result)) return;
  updateSyncProfileField(profileId, "script_executable_path", result);
}

async function chooseSyncDirectory(profileId, field, title) {
  const result = await open({
    title,
    directory: true,
    multiple: false,
  });
  if (!result || Array.isArray(result)) return;
  updateSyncProfileField(profileId, field, result);
}

function onSyncWorkspaceHotkeyInputKeydown(event) {
  if (event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Backspace" || event.key === "Delete") {
    syncWorkspaceHotkey.value = "";
    markSyncWorkspaceDirty("同步窗口快捷键已清空，保存时会回退到默认值。");
    return;
  }
  syncWorkspaceHotkey.value = buildHotkeyFromEvent(event);
  markSyncWorkspaceDirty();
}

function canRunSyncProfile(profile) {
  if (!profile) return false;
  return [
    profile.script_executable_path,
    profile.output_root,
    profile.target_path,
  ].every((value) => String(value || "").trim().length > 0);
}

function handleSyncWorkspaceProgress(payload) {
  if (!payload || typeof payload !== "object") return;
  const normalizedPayload = {
    ...payload,
    profileId:
      String(payload.profileId || payload.profile_id || "").trim() ||
      syncWorkspaceRunProfileId.value ||
      syncWorkspaceActiveProfileId.value,
  };
  if (!syncWorkspaceRunProfileId.value && normalizedPayload.profileId) {
    syncWorkspaceRunProfileId.value = normalizedPayload.profileId;
  }
  syncWorkspaceTimelineByProfile.value = appendTimelineByProfile(
    syncWorkspaceTimelineByProfile.value,
    normalizedPayload,
  );
}

async function refreshSyncWorkspaceConfigState() {
  await loadConfig();
  loadSyncWorkspaceSettingsFromConfig();
}

async function runSyncProfileFromWorkspace(profileId) {
  const profile = syncWorkspaceProfiles.value.find((item) => item.id === profileId);
  if (!profile || syncWorkspaceRunning.value) return;
  if (!canRunSyncProfile(profile)) {
    syncWorkspaceMessage.value = "✗ 请先配置脚本软件路径、脚本输出目录和项目目标路径";
    syncWorkspaceMessageTone.value = "error";
    focusSyncProfile(profileId);
    return;
  }

  focusSyncProfile(profileId);
  syncWorkspaceLastUsedProfileId.value = profileId;
  const saved = await saveSyncWorkspaceSettings({ silent: true });
  if (!saved) return;

  syncWorkspaceRunning.value = true;
  syncWorkspaceRunProfileId.value = profileId;
  syncWorkspaceTimelineByProfile.value = {
    ...syncWorkspaceTimelineByProfile.value,
    [profileId]: [],
  };
  syncWorkspaceMessage.value = `正在执行 ${profile.name}...`;
  syncWorkspaceMessageTone.value = "running";

  try {
    const result = await invoke("run_sync_profile", { profileId });
    await refreshSyncWorkspaceConfigState();
    syncWorkspaceMessage.value = `✓ ${result.summary}`;
    syncWorkspaceMessageTone.value = "success";
  } catch (error) {
    await refreshSyncWorkspaceConfigState();
    syncWorkspaceMessage.value = `✗ ${String(error)}`;
    syncWorkspaceMessageTone.value = "error";
  } finally {
    syncWorkspaceRunning.value = false;
    syncWorkspaceRunProfileId.value = "";
  }
}

function runActiveSyncProfile() {
  if (!activeSyncProfile.value) return;
  runSyncProfileFromWorkspace(activeSyncProfile.value.id);
}

async function closeSyncWorkspaceWindow() {
  if (!isTauriWindow || !isSyncWorkspaceWindow.value) return;
  await invoke("hide_sync_workspace_window").catch(() => {});
}

async function syncWorkspaceMinimize() {
  if (!isTauriWindow || !isSyncWorkspaceWindow.value) return;
  await getCurrentWindow().minimize().catch(() => {});
}

async function syncWorkspaceToggleMaximize() {
  if (!isTauriWindow || !isSyncWorkspaceWindow.value) return;
  const appWindow = getCurrentWindow();
  const maximized = await appWindow.isMaximized().catch(() => false);
  if (maximized) {
    await appWindow.unmaximize().catch(() => {});
  } else {
    await appWindow.maximize().catch(() => {});
  }
}

function syncWorkspaceHeaderPointerDown(event) {
  if (event.button !== 0 || !isTauriWindow || !isSyncWorkspaceWindow.value) return;
  const target = event.target;
  if (target instanceof Element && target.closest("button, input, textarea, select, label, a")) {
    return;
  }
  getCurrentWindow().startDragging().catch(() => {});
}

async function openSyncTargetDir() {
  const request = resolveSyncTargetDirectoryOpenRequest(activeSyncProfile.value?.target_path);
  if (!request) return;
  try {
    await invoke(request.command, { path: request.path });
  } catch (e) {
    syncWorkspaceMessage.value = `✗ 打开目标目录失败：${String(e)}`;
    syncWorkspaceMessageTone.value = "error";
    console.warn("Failed to open path:", e);
  }
}

// Custom skin editor state
const skinEditorOpen = ref(false);
const skinEditorStep = ref("import"); // "import" | "configure" | "preview"
const skinEditorName = ref("");
const skinEditorAnims = ref([]);
// Each entry: { name, file, origPath, src, width, height, frameWidth, frameHeight, frameCount, fps }
const skinEditorSearchAnim = ref("");
const skinEditorFoundAnim = ref("");
const skinEditorDefaultAnim = ref("");
const skinEditorMsg = ref("");
const skinEditorLoading = ref(false);
const skinEditorEditingId = ref(null);
const customSkins = ref([]);
const skinEditorCanvasRefs = ref([]);

const totalMetaCount = computed(() =>
  sortedSearchTableResults.value.length + results.column.length + results.comment.length,
);
const canSearchData = computed(() => dbConnected.value && keyword.value.trim().length > 0);
const isKeywordEmpty = computed(() => keyword.value.trim().length === 0);
// ── 表整理：持久化 ──
function orgStorageKey() {
  const db = config.shared.db;
  return `db_scout_org_v1_${db.host}_${db.port}_${db.database}`;
}
function loadOrgData() {
  try {
    const raw = localStorage.getItem(orgStorageKey());
    if (!raw) return;
    const data = JSON.parse(raw);
    starredTables.clear();
    (Array.isArray(data.starred) ? data.starred : []).forEach((t) => starredTables.add(t));
    tableFolders.value = Array.isArray(data.folders)
      ? data.folders.map((f) => ({ id: f.id || crypto.randomUUID(), name: f.name || "", tables: Array.isArray(f.tables) ? f.tables : [] }))
      : [];
    if (data.sortMode) sortMode.value = data.sortMode;
  } catch { /* ignore */ }
}
function saveOrgData() {
  try {
    localStorage.setItem(orgStorageKey(), JSON.stringify({
      starred: [...starredTables],
      folders: tableFolders.value,
      sortMode: sortMode.value,
    }));
  } catch { /* ignore */ }
}
function recentStorageKey() {
  const db = config.shared.db;
  return `db_scout_recent_v1_${db.host}_${db.port}_${db.database}`;
}
function loadRecentTables() {
  try {
    const raw = localStorage.getItem(recentStorageKey());
    if (!raw) return;
    recentTables.value = JSON.parse(raw).slice(0, RECENT_TABLES_MAX);
  } catch { /* ignore */ }
}
function saveRecentTables() {
  try {
    localStorage.setItem(recentStorageKey(), JSON.stringify(recentTables.value));
  } catch { /* ignore */ }
}
function addToRecentTables(tableName, tableComment) {
  recentTables.value = [
    { tableName, tableComment: tableComment || "", openedAt: Date.now() },
    ...recentTables.value.filter((r) => r.tableName !== tableName),
  ].slice(0, RECENT_TABLES_MAX);
  saveRecentTables();
}
function toggleRecentTabsDropdown() {
  recentTabsDropdownOpen.value = !recentTabsDropdownOpen.value;
}

const recentTablesGrouped = computed(() => {
  const folders = tableFolders.value;
  const groups = [];
  const inFolder = new Set();

  for (const folder of folders) {
    const folderSet = new Set(folder.tables.map((t) => t.toLowerCase()));
    const matches = recentTables.value.filter((r) => folderSet.has(r.tableName.toLowerCase()));
    if (matches.length > 0) {
      groups.push({ folderName: folder.name, tables: matches });
      matches.forEach((m) => inFolder.add(m.tableName.toLowerCase()));
    }
  }

  const uncategorized = recentTables.value.filter((r) => !inFolder.has(r.tableName.toLowerCase()));
  if (uncategorized.length > 0) {
    groups.push({ folderName: groups.length > 0 ? "未分类" : "", tables: uncategorized });
  }

  return groups;
});

function toggleStar(tableName) {
  if (starredTables.has(tableName)) starredTables.delete(tableName);
  else starredTables.add(tableName);
  saveOrgData();
}
function addTableToFolder(tableName, folderId) {
  const folder = tableFolders.value.find((f) => f.id === folderId);
  if (folder && !folder.tables.includes(tableName)) {
    folder.tables.push(tableName);
    saveOrgData();
  }
}
function removeTableFromFolder(tableName, folderId) {
  const folder = tableFolders.value.find((f) => f.id === folderId);
  if (folder) {
    folder.tables = folder.tables.filter((t) => t !== tableName);
    saveOrgData();
  }
}
function createFolder(name) {
  const id = crypto.randomUUID();
  tableFolders.value.push({ id, name, tables: [] });
  saveOrgData();
  return id;
}
function deleteFolder(id) {
  tableFolders.value = tableFolders.value.filter((f) => f.id !== id);
  if (activeFolder.value === id) activeFolder.value = "all";
  saveOrgData();
}
function renameFolder(id, newName) {
  const folder = tableFolders.value.find((f) => f.id === id);
  if (folder) { folder.name = newName; saveOrgData(); }
}
function isTableInFolder(tableName, folderId) {
  const folder = tableFolders.value.find((f) => f.id === folderId);
  return folder ? folder.tables.includes(tableName) : false;
}

// ── 排序函数 ──
function getCommentForSort(item) {
  if (item.table_comment != null) return String(item.table_comment);
  return getTableComment(item.table_name);
}
function sortTableItems(items, mode) {
  const sorted = [...items];
  const cmpName = (a, b) => String(a.table_name || "").localeCompare(String(b.table_name || ""), "zh-CN");
  const cmpComment = (a, b) => getCommentForSort(a).localeCompare(getCommentForSort(b), "zh-CN");
  switch (mode) {
    case "name_asc":    sorted.sort(cmpName); break;
    case "name_desc":   sorted.sort((a, b) => cmpName(b, a)); break;
    case "comment_asc": sorted.sort((a, b) => cmpComment(a, b) || cmpName(a, b)); break;
    case "comment_desc":sorted.sort((a, b) => cmpComment(b, a) || cmpName(a, b)); break;
  }
  return sorted;
}
function applyStarPinning(items) {
  const starred = [];
  const rest = [];
  for (const item of items) {
    if (starredTables.has(item.table_name)) starred.push(item);
    else rest.push(item);
  }
  return [...starred, ...rest];
}
function applyFolderFilter(items) {
  if (activeFolder.value === "all") return items;
  if (activeFolder.value === "starred") return items.filter((i) => starredTables.has(i.table_name));
  const folder = tableFolders.value.find((f) => f.id === activeFolder.value);
  if (!folder) return items;
  const set = new Set(folder.tables);
  return items.filter((i) => set.has(i.table_name));
}

// ── 排序后的表结果（含文件夹筛选 + 星标置顶）──
const defaultTableResults = computed(() => {
  const base = (Array.isArray(tableOptions.value) ? tableOptions.value : []).map((item) => ({
    ...item,
    match_type: "TableName",
    matched_text: item.table_name,
    score: 0,
    _type: "table",
  }));
  return applyStarPinning(applyFolderFilter(sortTableItems(base, sortMode.value)));
});

const flatDataResults = computed(() => {
  const flat = [];
  const terms = splitKeywordTerms(keyword.value);
  for (const item of results.data) {
    const rows = item.matched_rows || [];
    const scopedColumns = Array.isArray(item.matched_columns) ? item.matched_columns.filter(Boolean) : [];
    rows.forEach((row, rowLocalIndex) => {
      const candidateColumns = scopedColumns.length > 0 ? scopedColumns : Object.keys(row || {});
      let rowHitColumns = candidateColumns.filter((col) => containsAllTerms(row?.[col], terms));
      if (rowHitColumns.length === 0) {
        rowHitColumns = Object.keys(row || {}).filter((col) => containsAllTerms(row?.[col], terms));
      }
      rowHitColumns.forEach((col) => {
        const first = Number(item.first_row_index);
        const rowIndex = Number.isFinite(first) ? first + rowLocalIndex : null;
        flat.push({
          table_name: item.table_name,
          column: col,
          hit_columns: rowHitColumns,
          row_index: rowIndex,
          preview: `${col}: ${row?.[col] ?? ''}`,
          _item: item,
        });
      });
    });
    if (!rows.length && item.total_matches > 0) {
      flat.push({ table_name: item.table_name, column: '', preview: `${item.total_matches} 条命中`, _item: item });
    }
  }
  return flat;
});

const activeResultTab = ref('全部');
const tableTabCount = computed(() => (isKeywordEmpty.value ? defaultTableResults.value.length : sortedSearchTableResults.value.length));

const sortedSearchTableResults = computed(() => {
  if (isKeywordEmpty.value) return defaultTableResults.value;
  const base = applyFolderFilter(
    (Array.isArray(tableOptions.value) ? tableOptions.value : []).map((item) => ({
      ...item,
      match_type: "TableName",
      matched_text: item.table_name,
      score: 0,
      _type: "table",
    })),
  );
  return applyStarPinning(rankTableSearchCandidates(keyword.value, base));
});
const sortedSearchColumnResults = computed(() => {
  const base = results.column.map((i) => ({ ...i, _type: "column" }));
  return applyFolderFilter(base);
});
const sortedSearchCommentResults = computed(() => {
  const base = results.comment.map((i) => ({ ...i, _type: "comment" }));
  return applyFolderFilter(base);
});
const sortedSearchDataResults = computed(() => {
  const base = flatDataResults.value.map((i) => ({ ...i, _type: "data" }));
  return applyFolderFilter(base);
});

const totalResultCount = computed(() =>
  tableTabCount.value +
  sortedSearchColumnResults.value.length +
  sortedSearchCommentResults.value.length +
  (isKeywordEmpty.value ? 0 : sortedSearchDataResults.value.length)
);

const resultTabs = computed(() => [
  { key: '全部',  label: '全部',  count: totalResultCount.value },
  { key: '表名',  label: '表名',  count: tableTabCount.value },
  { key: '字段名', label: '字段名', count: sortedSearchColumnResults.value.length },
  { key: '备注',  label: '备注',  count: sortedSearchCommentResults.value.length },
  { key: '数据值', label: '数据值', count: isKeywordEmpty.value ? 0 : sortedSearchDataResults.value.length },
]);
const panelTabs = computed(() =>
  buildPanelTabs({
    starredTables: [...starredTables],
    tableTabs: tableTabs.value,
    activeTableTabId: activeTableTabId.value,
  }),
);

const filteredResults = computed(() => {
  if (isKeywordEmpty.value) {
    if (activeResultTab.value === "全部" || activeResultTab.value === "表名") {
      return defaultTableResults.value;
    }
    return [];
  }

  switch (activeResultTab.value) {
    case '表名':  return sortedSearchTableResults.value;
    case '字段名': return sortedSearchColumnResults.value;
    case '备注':  return sortedSearchCommentResults.value;
    case '数据值': return sortedSearchDataResults.value;
    default: return [
      ...sortedSearchTableResults.value,
      ...sortedSearchColumnResults.value,
      ...sortedSearchCommentResults.value,
      ...sortedSearchDataResults.value,
    ];
  }
});
const tableOptionCommentMap = computed(() => {
  const out = new Map();
  (Array.isArray(tableOptions.value) ? tableOptions.value : []).forEach((item) => {
    out.set(String(item.table_name || "").toLowerCase(), String(item.table_comment || ""));
  });
  return out;
});
const tableFolderChipMap = computed(() => {
  const out = new Map();
  for (const folder of tableFolders.value) {
    const tables = Array.isArray(folder?.tables) ? folder.tables : [];
    for (const tableName of tables) {
      const key = String(tableName || "").trim().toLowerCase();
      if (!key || out.has(key)) continue;
      out.set(key, describeTableFolderChip(tableName, tableFolders.value));
    }
  }
  return out;
});

function normalizeDbTemplateIdentity(db = {}) {
  return {
    host: String(db?.host || "").trim().toLowerCase(),
    port: Number(db?.port) || 3306,
    username: String(db?.username || "").trim(),
    database: String(db?.database || "").trim(),
  };
}

function findTemplateIndexByDb(db = config.shared.db) {
  const list = Array.isArray(config.shared.db_templates) ? config.shared.db_templates : [];
  if (list.length === 0) return -1;
  const current = normalizeDbTemplateIdentity(db);
  return list.findIndex((tpl) => {
    const target = normalizeDbTemplateIdentity(tpl?.db || {});
    return target.host === current.host
      && target.port === current.port
      && target.username === current.username
      && target.database === current.database;
  });
}

const activeTemplateIndex = computed(() => {
  return findTemplateIndexByDb();
});
const activeTemplateName = computed(() => {
  const list = Array.isArray(config.shared.db_templates) ? config.shared.db_templates : [];
  const cursor = Number(templateCursorIndex.value);
  if (cursor >= 0 && cursor < list.length) {
    return String(list[cursor]?.name || "当前连接");
  }
  const index = activeTemplateIndex.value;
  if (index < 0) return "当前连接";
  return String(list[index]?.name || "当前连接");
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
  const query = tableCommandQuery.value.trim();
  const base = Array.isArray(tableOptions.value) ? tableOptions.value : [];
  if (!query) return base.slice(0, TABLE_COMMAND_LIMIT);
  return rankTableSearchCandidates(query, base).slice(0, TABLE_COMMAND_LIMIT);
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
const resultZoomItems = computed(() => {
  if (resultZoomType.value === "table") return sortedSearchTableResults.value;
  if (resultZoomType.value === "column") return sortedSearchColumnResults.value;
  if (resultZoomType.value === "comment") return sortedSearchCommentResults.value;
  if (resultZoomType.value === "data") return sortedSearchDataResults.value;
  return [];
});
const petDragging = ref(false);
const petHiddenForSession = ref(false);
const petSpriteClasses = computed(() => ({
  searching: progress.show,
  found: petFound.value,
  dragging: petDragging.value,
  sleeping: petIdleActive.value && currentIdleState.value === "sleep_zzz",
  "idle-float": petIdleActive.value && currentIdleState.value === "float_breathe",
  "idle-look": petIdleActive.value && currentIdleState.value === "look_around",
  "idle-ghost": petIdleActive.value && currentIdleState.value === "ghost_fade",
  "idle-wave": petIdleActive.value && currentIdleState.value === "wave_hello",
  "idle-charge": petIdleActive.value && currentIdleState.value === "charge_spell",
  "idle-jump": petIdleActive.value && currentIdleState.value === "jump_play",
  "idle-spin": petIdleActive.value && currentIdleState.value === "spin_show",
}));
const isHdPetSkin = computed(() => false);
const SPRITE_SHEET_SKINS = {
  knight: {
    animations: {
      idle:      { src: null, frameWidth: 96, frameHeight: 84, frameCount: 7, fps: 8 },
      run:       { src: null, frameWidth: 96, frameHeight: 84, frameCount: 8, fps: 10 },
      walk:      { src: null, frameWidth: 96, frameHeight: 84, frameCount: 8, fps: 8 },
      attack:    { src: null, frameWidth: 96, frameHeight: 84, frameCount: 6, fps: 10 },
      hurt:      { src: null, frameWidth: 96, frameHeight: 84, frameCount: 4, fps: 8 },
    },
    defaultAnim: "idle",
    searchAnim: "run",
    foundAnim: "attack",
    hurtAnim: "hurt",
    idleMap: {
      // Default idle states mapping (fallback for old configs)
      sleep_zzz: "idle",
      float_breathe: "idle",
      look_around: "walk",
      wave_hello: "idle",
      jump_play: "run",
      spin_show: "attack",
      ghost_fade: "idle",
      charge_spell: "attack",
      // Knight-specific idle states
      knight_idle: "idle",
      knight_walk: "walk",
      knight_run: "run",
      knight_attack: "attack",
      knight_hurt: "hurt",
    },
  },
};
// Lazy-load sprite sheet images
function loadSpriteSheetImages() {
  const skin = config.personal.pet_skin;
  if (skin.startsWith("custom:")) return; // Custom skins already loaded via convertFileSrc
  const knightModules = {
    idle: new URL("./assets/sprites/knight/idle.png", import.meta.url).href,
    run: new URL("./assets/sprites/knight/run.png", import.meta.url).href,
    walk: new URL("./assets/sprites/knight/walk.png", import.meta.url).href,
    attack: new URL("./assets/sprites/knight/attack.png", import.meta.url).href,
    hurt: new URL("./assets/sprites/knight/hurt.png", import.meta.url).href,
  };
  for (const [anim, url] of Object.entries(knightModules)) {
    SPRITE_SHEET_SKINS.knight.animations[anim].src = url;
  }
}
// Register custom skins into SPRITE_SHEET_SKINS
async function registerCustomSkins() {
  // Clean old custom entries
  for (const key of Object.keys(SPRITE_SHEET_SKINS)) {
    if (key.startsWith("custom:")) delete SPRITE_SHEET_SKINS[key];
  }
  for (const key of Object.keys(SPRITE_SHEET_IDLE_STATES)) {
    if (key.startsWith("custom:")) delete SPRITE_SHEET_IDLE_STATES[key];
  }
  for (const { id, manifest } of customSkins.value) {
    const skinKey = `custom:${id}`;
    try {
      const basePath = await invoke("get_skin_base_path", { skinName: id });
      const animations = {};
      const idleStates = [];
      const idleLabels = {};
      const idleAnimMap = {};
      const idleMapForSkin = {};
      for (const [animName, animDef] of Object.entries(manifest.animations)) {
        const filePath = basePath + "/" + animDef.file;
        animations[animName] = {
          src: convertFileSrc(filePath),
          frameWidth: animDef.frameWidth,
          frameHeight: animDef.frameHeight,
          frameCount: animDef.frameCount,
          fps: animDef.fps,
        };
        const idleKey = `${id}_${animName}`;
        idleStates.push(idleKey);
        idleLabels[idleKey] = animName;
        idleAnimMap[idleKey] = animName;
        idleMapForSkin[idleKey] = animName;
      }
      // Also map default generic idle states to defaultAnim
      for (const genericState of ["float_breathe", "sleep_zzz", "look_around", "wave_hello", "jump_play", "spin_show", "ghost_fade", "charge_spell"]) {
        idleMapForSkin[genericState] = manifest.defaultAnim;
      }
      SPRITE_SHEET_SKINS[skinKey] = {
        animations,
        defaultAnim: manifest.defaultAnim,
        searchAnim: manifest.searchAnim,
        foundAnim: manifest.foundAnim,
        idleMap: idleMapForSkin,
      };
      SPRITE_SHEET_IDLE_STATES[skinKey] = {
        states: idleStates,
        labels: idleLabels,
        animMap: idleAnimMap,
      };
    } catch (e) {
      console.error(`Failed to register custom skin ${id}:`, e);
    }
  }
}
const isSpriteSheetSkin = computed(() => config.personal.pet_skin in SPRITE_SHEET_SKINS);
const spriteSheetFrame = ref(0);
let spriteSheetAnimId = null;
const spriteSheetAnim = computed(() => {
  if (!isSpriteSheetSkin.value) return null;
  const skinDef = SPRITE_SHEET_SKINS[config.personal.pet_skin];
  if (!skinDef) return null;
  if (petFound.value) return skinDef.foundAnim || skinDef.defaultAnim;
  if (progress.show) return skinDef.searchAnim || skinDef.defaultAnim;
  if (petIdleActive.value && currentIdleState.value) {
    return skinDef.idleMap?.[currentIdleState.value] || skinDef.defaultAnim;
  }
  return skinDef.defaultAnim;
});
const spriteSheetStyle = computed(() => {
  if (!isSpriteSheetSkin.value) return {};
  const skinDef = SPRITE_SHEET_SKINS[config.personal.pet_skin];
  const animName = spriteSheetAnim.value || skinDef.defaultAnim;
  const anim = skinDef.animations[animName];
  if (!anim?.src) return {};
  return {
    width: anim.frameWidth + "px",
    height: anim.frameHeight + "px",
    backgroundImage: `url(${anim.src})`,
    backgroundPosition: `-${spriteSheetFrame.value * anim.frameWidth}px 0`,
    backgroundSize: `${anim.frameWidth * anim.frameCount}px ${anim.frameHeight}px`,
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  };
});
const hotkeyPlaceholder = "点击后按下快捷键";
const quickDateHotkeyPlaceholder = "点击后按下快捷键";
const reducedTransparencyEnabled = computed(() =>
  shouldUseReducedTransparencyMode({
    reduceTransparency: config.personal.reduce_transparency_mode,
    windowLabel: windowLabel.value,
  }),
);
const contentScaleStyle = computed(() => ({
  "--content-scale": String(normalizeUiScale(config.personal.ui_scale)),
}));
const panelChromeStyle = computed(() => ({
  "--panel-opacity": String(normalizeBackgroundOpacity(config.personal.background_opacity)),
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

function normalizePetScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1.0;
  const rounded = Math.round(numeric / PET_SCALE_STEP) * PET_SCALE_STEP;
  return Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, Number(rounded.toFixed(1))));
}
function getPetScale(skin) {
  const map = config.personal.pet_scale;
  if (typeof map === "object" && map !== null && typeof map[skin] === "number") {
    return normalizePetScale(map[skin]);
  }
  // Legacy: single number
  if (typeof map === "number") return normalizePetScale(map);
  return 1.0;
}
function setPetScale(skin, value) {
  if (typeof config.personal.pet_scale !== "object" || config.personal.pet_scale === null) {
    config.personal.pet_scale = {};
  }
  config.personal.pet_scale[skin] = normalizePetScale(value);
}
const petScaleStyle = computed(() => {
  const s = getPetScale(config.personal.pet_skin);
  return s === 1.0 ? {} : { transform: `scale(${s})`, transformOrigin: "center center" };
});

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

const ALL_VALID_IDLE_STATES = (() => {
  const set = new Set(ALLOWED_IDLE_STATES);
  for (const def of Object.values(SPRITE_SHEET_IDLE_STATES)) {
    for (const s of def.states) set.add(s);
  }
  return set;
})();
function sanitizeIdleStates(states) {
  const values = Array.isArray(states) ? states : [];
  const normalized = [...new Set(values.filter((item) => ALL_VALID_IDLE_STATES.has(item)))];
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

function startSpriteSheetAnimation() {
  stopSpriteSheetAnimation();
  if (!isSpriteSheetSkin.value) return;
  let lastAnimName = "";
  let lastTime = 0;
  const tick = (timestamp) => {
    const skinDef = SPRITE_SHEET_SKINS[config.personal.pet_skin];
    if (!skinDef) return;
    const animName = spriteSheetAnim.value || skinDef.defaultAnim;
    const anim = skinDef.animations[animName];
    if (!anim) return;
    if (animName !== lastAnimName) {
      spriteSheetFrame.value = 0;
      lastAnimName = animName;
      lastTime = timestamp;
    }
    const interval = 1000 / anim.fps;
    if (timestamp - lastTime >= interval) {
      spriteSheetFrame.value = (spriteSheetFrame.value + 1) % anim.frameCount;
      lastTime = timestamp;
    }
    spriteSheetAnimId = requestAnimationFrame(tick);
  };
  spriteSheetAnimId = requestAnimationFrame(tick);
}
function stopSpriteSheetAnimation() {
  if (spriteSheetAnimId !== null) {
    cancelAnimationFrame(spriteSheetAnimId);
    spriteSheetAnimId = null;
  }
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

// ── 表整理：UI 交互 ──
function openItemCtxMenu(event, tableName) {
  event.preventDefault();
  event.stopPropagation();
  itemCtxTableName.value = tableName;
  itemCtxPos.x = event.clientX;
  itemCtxPos.y = event.clientY;
  itemCtxOpen.value = true;
  itemCtxSubMenuOpen.value = false;
  sortMenuOpen.value = false;
  folderCtxTarget.value = null;
}
function closeItemCtxMenu() {
  itemCtxOpen.value = false;
  itemCtxSubMenuOpen.value = false;
}
function toggleSortMenu() {
  sortMenuOpen.value = !sortMenuOpen.value;
}
function selectSortMode(mode) {
  sortMode.value = mode;
  sortMenuOpen.value = false;
  saveOrgData();
  syncSummaryForDefaultTableBrowse();
}
function openFolderCtxMenu(event, folderId) {
  event.preventDefault();
  event.stopPropagation();
  folderCtxTarget.value = folderId;
  folderCtxPos.x = event.clientX;
  folderCtxPos.y = event.clientY;
  sortMenuOpen.value = false;
  itemCtxOpen.value = false;
}
function closeFolderCtxMenu() {
  folderCtxTarget.value = null;
}
function startFolderRename(folderId) {
  const folder = tableFolders.value.find((f) => f.id === folderId);
  if (!folder) return;
  folderRenameId.value = folderId;
  folderRenameValue.value = folder.name;
  closeFolderCtxMenu();
}
function commitFolderRename() {
  if (folderRenameId.value && folderRenameValue.value.trim()) {
    renameFolder(folderRenameId.value, folderRenameValue.value.trim());
  }
  folderRenameId.value = null;
}
function handleNewFolderConfirm() {
  const name = newFolderName.value.trim();
  if (name) createFolder(name);
  newFolderDialogOpen.value = false;
  newFolderName.value = "";
}
function handleItemCtxAddToFolder(folderId) {
  addTableToFolder(itemCtxTableName.value, folderId);
  closeItemCtxMenu();
}
function handleItemCtxRemoveFromFolder() {
  if (activeFolder.value !== "all" && activeFolder.value !== "starred") {
    removeTableFromFolder(itemCtxTableName.value, activeFolder.value);
  }
  closeItemCtxMenu();
  syncSummaryForDefaultTableBrowse();
}
function handleNewFolderFromCtx() {
  closeItemCtxMenu();
  newFolderDialogOpen.value = true;
  newFolderName.value = "";
}
function handleDeleteFolder(folderId) {
  deleteFolder(folderId);
  closeFolderCtxMenu();
}
function closeAllOrgMenus() {
  sortMenuOpen.value = false;
  recentTabsDropdownOpen.value = false;
  closeItemCtxMenu();
  closeFolderCtxMenu();
}
const SORT_OPTIONS = [
  { key: "name_asc",    label: "表名 A → Z" },
  { key: "name_desc",   label: "表名 Z → A" },
  { key: "comment_asc", label: "备注 A → Z" },
  { key: "comment_desc",label: "备注 Z → A" },
];
const sortLabel = computed(() => SORT_OPTIONS.find((o) => o.key === sortMode.value)?.label || "排序");
const availableIdleOptions = computed(() => {
  const skin = settingsDraft.petSkin;
  const ssDef = SPRITE_SHEET_IDLE_STATES[skin];
  if (ssDef) {
    return ssDef.states.map((s) => ({ value: s, label: ssDef.labels[s] || s }));
  }
  return ALLOWED_IDLE_STATES.map((s) => ({ value: s, label: DEFAULT_IDLE_LABELS[s] || s }));
});
const activeFolderName = computed(() => {
  if (activeFolder.value === "all") return "全部";
  if (activeFolder.value === "starred") return "星标";
  return tableFolders.value.find((f) => f.id === activeFolder.value)?.name || "全部";
});

function ensureDbConnectedForSearch() {
  if (dbConnected.value) return true;
  summaryText.value = "当前数据库未连接";
  return false;
}

function syncSummaryForDefaultTableBrowse() {
  if (!isPanelWindow.value || !isKeywordEmpty.value) return;
  if (!dbConnected.value) {
    summaryText.value = "当前数据库未连接";
    return;
  }
  const total = (Array.isArray(tableOptions.value) ? tableOptions.value : []).length;
  const shown = defaultTableResults.value.length;
  if (activeFolder.value === "all") {
    summaryText.value = `共 ${total} 张表`;
  } else {
    const folderName = activeFolder.value === "starred" ? "星标" : (tableFolders.value.find((f) => f.id === activeFolder.value)?.name || "文件夹");
    summaryText.value = `${folderName}：${shown} 张表（共 ${total}）`;
  }
}

function syncSummaryAfterConnectionCheck() {
  if (summaryText.value !== "正在连接数据库...") return;
  syncSummaryForDefaultTableBrowse();
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
  syncSummaryForDefaultTableBrowse();
}

function syncSettingsDraftDbFields(db = config.shared.db) {
  settingsDraft.host = String(db?.host || "");
  settingsDraft.port = Number(db?.port) || 3306;
  settingsDraft.username = String(db?.username || "");
  settingsDraft.password = String(db?.password || "");
  settingsDraft.database = String(db?.database || "");
}

function applyDbConfigToShared(db = {}) {
  config.shared.db.host = String(db?.host || "");
  config.shared.db.port = Number(db?.port) || 3306;
  config.shared.db.username = String(db?.username || "");
  config.shared.db.password = String(db?.password || "");
  config.shared.db.database = String(db?.database || "");
}

function resetContextAfterDbSwitch() {
  selectedTables.value = [];
  navZone.value = "sidebar";
  navResultIndex.value = -1;
  activeFolder.value = "all";
  closeSlashMode();
  closeTableCommandPalette();
  forceExitEditMode();
  doCloseTableDialog();
  clearTableTabs();
  results.table = [];
  results.column = [];
  results.comment = [];
  results.data = [];
}

function resetPanelStateForDefaultBrowse() {
  keyword.value = "";
  activeResultTab.value = "全部";
  navZone.value = "sidebar";
  navResultIndex.value = -1;
  historyOpen.value = false;
  resultZoomOpen.value = false;
  resetContextAfterDbSwitch();
  syncSummaryForDefaultTableBrowse();
}

function handlePanelActivated({ reset = false } = {}) {
  if (!isPanelWindow.value) return;
  focusKeyword();
  if (reset) {
    resetPanelStateForDefaultBrowse();
  } else {
    syncSummaryForDefaultTableBrowse();
  }
}

async function onDbConnectionChanged({ resetContext = false } = {}) {
  await refreshConnectionStatus();
  await loadTableOptions();
  loadOrgData();
  loadRecentTables();
  if (resetContext) {
    resetContextAfterDbSwitch();
    syncSummaryForDefaultTableBrowse();
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

function isKeywordInputTarget(target) {
  return target instanceof HTMLElement && target.id === "keywordInput";
}

function getTableComment(tableName) {
  const key = String(tableName || "").toLowerCase();
  if (!key) return "";
  return tableOptionCommentMap.value.get(key) || "";
}

function getTableFolderChip(tableName) {
  const key = String(tableName || "").trim().toLowerCase();
  if (!key) return UNCATEGORIZED_TABLE_FOLDER_CHIP;
  return tableFolderChipMap.value.get(key) || UNCATEGORIZED_TABLE_FOLDER_CHIP;
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
    if (navZone.value === "results" && navResultIndex.value >= 0) {
      openKeyboardFocusedResult().catch(() => {});
      return;
    }
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

function scrollTableTabIntoView(tabId, behavior = "smooth") {
  if (!tabId) return;
  nextTick(() => {
    const wrap = tableTabsRef.value;
    if (!(wrap instanceof HTMLElement)) return;
    const tabEl = document.getElementById(`table-tab-${tabId}`);
    if (!(tabEl instanceof HTMLElement)) return;
    const wrapRect = wrap.getBoundingClientRect();
    const tabRect = tabEl.getBoundingClientRect();
    if (tabRect.left < wrapRect.left) {
      wrap.scrollBy({ left: tabRect.left - wrapRect.left - 8, behavior });
    } else if (tabRect.right > wrapRect.right) {
      wrap.scrollBy({ left: tabRect.right - wrapRect.right + 8, behavior });
    }
  });
}

function stopTableTabsCompressionMeasure() {
  if (tableTabsMeasureRaf) {
    cancelAnimationFrame(tableTabsMeasureRaf);
    tableTabsMeasureRaf = 0;
  }
  if (!tableOpen.value) {
    tableTabsCompressed.value = false;
  }
}

function scheduleTableTabsCompressionMeasure() {
  stopTableTabsCompressionMeasure();
  if (!tableOpen.value) {
    tableTabsCompressed.value = false;
    return;
  }
  tableTabsMeasureRaf = requestAnimationFrame(() => {
    tableTabsMeasureRaf = 0;
    const wrap = tableTabsRef.value;
    if (!(wrap instanceof HTMLElement)) {
      tableTabsCompressed.value = false;
      return;
    }
    const tabEls = [...wrap.querySelectorAll(".table-tab")].filter((item) => item instanceof HTMLElement);
    if (tabEls.length === 0) {
      tableTabsCompressed.value = false;
      return;
    }
    const addButton = wrap.querySelector(".table-tab-add");
    const gapWidth = 8;
    let desiredWidth = addButton instanceof HTMLElement ? addButton.offsetWidth : 0;

    tabEls.forEach((tabEl) => {
      const labelEl = tabEl.querySelector(".table-tab-label");
      const closeEl = tabEl.querySelector(".table-tab-close");
      const labelWidth = labelEl instanceof HTMLElement ? labelEl.scrollWidth : 0;
      const closeWidth = closeEl instanceof HTMLElement ? closeEl.offsetWidth + 8 : 0;
      const naturalWidth = Math.min(220, Math.max(132, labelWidth + closeWidth + 36));
      desiredWidth += naturalWidth;
    });

    desiredWidth += Math.max(0, tabEls.length) * gapWidth;
    tableTabsCompressed.value = desiredWidth > wrap.clientWidth;
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
  if (activeTableTabId.value === tabId && tableOpen.value) return;
  if (!skipSnapshot) {
    snapshotActiveTableTab();
  }
  hitCollectToken += 1;
  activeTableTabId.value = next.id;
  restoreLiveStateFromTableSnapshot(next);
  tableOpen.value = true;
  if (tableDetailView.value === "hits" && allHitRows.value.length === 0 && tableView.totalRows > 0) {
    collectAllHitRows().catch(() => {});
  }
  if (tableDetailView.value === "full" && !dataCollapsed.value) {
    startTableLayoutObserver().catch(() => {});
  } else {
    stopTableLayoutObserver();
  }
  scheduleAdaptiveTablePageSize();
  scrollTableTabIntoView(next.id);
}

async function openOrActivateTableTab(tableName, rowIndex = null, columnName = null, hitContext = {}) {
  const normalizedName = String(tableName || "").trim();
  if (!normalizedName) return;

  const exists = tableTabs.value.find(
    (item) => item.tableName.toLowerCase() === normalizedName.toLowerCase(),
  );
  if (exists) {
    await activateTableTab(exists.id);
    const comment = tableOptionCommentMap.value.get(normalizedName.toLowerCase()) || "";
    addToRecentTables(normalizedName, comment);
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
  await loadTablePage({ resetFocus: true, clearHitCache: true });
  if (tableDetailView.value === "hits") {
    collectAllHitRows().catch(() => {});
  }
  await startTableLayoutObserver();
  scheduleAdaptiveTablePageSize();
  snapshotActiveTableTab();
  scrollTableTabIntoView(nextTab.id);
  const comment = tableOptionCommentMap.value.get(normalizedName.toLowerCase()) || "";
  addToRecentTables(normalizedName, comment);
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
    activeTableTabId.value = "";
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

async function activatePanelChromeTab(tab) {
  if (!tab?.tableName) return;
  if (tab.opened && tab.tabId) {
    await activateTableTab(tab.tabId);
    return;
  }
  await openOrActivateTableTab(tab.tableName);
}

async function closePanelChromeTab(tab) {
  if (!tab?.opened || !tab.tabId) return;
  const wasTableOpen = tableOpen.value;
  await closeTableTab(tab.tabId);
  if (!wasTableOpen && tableOpen.value) {
    tableOpen.value = false;
  }
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

async function fetchWeather() {
  if (!isTauriWindow || !weatherEnabled.value) return;
  try {
    const info = await invoke('get_weather');
    const normalizedCategory = normalizeWeatherCategory(info.category);
    weatherCategory.value = normalizedCategory;
    weatherText.value = info.text;
    weatherTemp.value = info.temp;
    weatherCity.value = FIXED_WEATHER_CITY;
    weatherIcon.value = WEATHER_ICON_MAP[normalizedCategory] || '🌤️';
    if (weatherEngine) {
      weatherEngine.setSkin(normalizedCategory);
      if (normalizedCategory === 'lightRain') {
        weatherEngine.setWeather('rain', info.wind_speed || 10, info.rain_intensity || 0.3);
      } else if (normalizedCategory === 'heavyRain') {
        weatherEngine.setWeather('rain', info.wind_speed || 25, info.rain_intensity || 0.9);
      } else {
        weatherEngine.setWeather(normalizedCategory, info.wind_speed || 15, info.rain_intensity || 0.5);
      }
    }
  } catch (e) {
    console.warn('[Weather] fetch failed:', e);
  }
}

function applyPreviewWeather(cat) {
  weatherPreviewCategory.value = cat
  if (weatherEngine) {
    if (cat === 'lightRain') {
      weatherEngine.setSkin(cat)
      weatherEngine.setWeather('rain', 10, 0.3)
    } else if (cat === 'heavyRain') {
      weatherEngine.setSkin(cat)
      weatherEngine.setWeather('rain', 25, 0.9)
    } else {
      weatherEngine.setSkin(cat)
      weatherEngine.setWeather(cat, 15, 0.5)
    }
  }
}

function onSkyTimeSlider(event) {
  skyTimeOverride.value = parseFloat(event.target.value)
}

function switchToLowQuality() {
  weatherQuality.value = 'low'
  nextTick(() => {
    initWeatherEngine()
    if (weatherPreviewCategory.value) {
      applyPreviewWeather(weatherPreviewCategory.value)
    } else {
      fetchWeather()
    }
  })
}

function resetToRealWeather() {
  weatherPreviewCategory.value = ''
  skyTimeOverride.value = null
  fetchWeather()
}

function initWeatherEngine() {
  if (!weatherCanvasRef.value || weatherEngine) return;
  const widget = document.getElementById('widget');
  if (!widget) return;
  weatherEngine = new WeatherEngine(weatherCanvasRef.value, { skin: weatherSkinState.value.category });
  weatherEngine.resize(widget.clientWidth, widget.clientHeight);
  weatherEngine.setSkin(weatherSkinState.value.category);
  weatherEngine.start();

  // Collision rects from UI elements
  updateWeatherCollisionRects();

  // ResizeObserver
  let resizeDebounce = null;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      if (weatherEngine && widget) {
        weatherEngine.resize(widget.clientWidth, widget.clientHeight);
        updateWeatherCollisionRects();
      }
    }, 200);
  });
  ro.observe(widget);
  weatherEngine._resizeObserver = ro;
}

function updateWeatherCollisionRects() {
  if (!weatherEngine) return;
  const widget = document.getElementById('widget');
  if (!widget) return;
  const wRect = widget.getBoundingClientRect();
  const selectors = ['.widget-header', '.panel-footer', '.org-toolbar'];
  const rects = [];
  for (const sel of selectors) {
    const el = widget.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    rects.push({
      x: r.left - wRect.left,
      y: r.top - wRect.top,
      w: r.width,
      h: r.height,
    });
  }
  weatherEngine.setCollisionRects(rects);
}

function destroyWeatherEngine() {
  if (weatherEngine) {
    if (weatherEngine._resizeObserver) {
      weatherEngine._resizeObserver.disconnect();
      weatherEngine._resizeObserver = null;
    }
    weatherEngine.destroy();
    weatherEngine = null;
  }
  clearInterval(weatherRefreshTimer);
  weatherRefreshTimer = null;
}

onMounted(async () => {
  if (isTauriWindow) {
    windowLabel.value = getCurrentWindow().label;
  }

  applyTheme(themeId.value)
  await loadConfig();
  applyCustomFont();
  // Load custom skins
  if (isTauriWindow) {
    try {
      customSkins.value = await invoke("list_custom_skins");
      await registerCustomSkins();
    } catch (e) { console.error("Failed to load custom skins:", e); }
  }
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
    loadOrgData();
    loadRecentTables();
    loadHistory();
    bindPanelListeners();
    handlePanelActivated({
      reset: config.personal.reset_on_open_to_all_tables,
    });
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

    // ── Weather engine init ──
    weatherEnabled.value = config.personal.weather_enabled !== false;
    if (weatherEnabled.value) {
      themeId.value = 'azure'
      document.documentElement.dataset.theme = 'azure'
      await nextTick();
      initWeatherEngine();
      fetchWeather();
      weatherRefreshTimer = setInterval(fetchWeather, WEATHER_REFRESH_MS);
    }
    // Sky time auto-update every 5 minutes
    skyTimeTimer = setInterval(() => {
      skyTime.value = new Date().getHours() + new Date().getMinutes() / 60
    }, 5 * 60 * 1000)

    return;
  }

  if (isSyncWorkspaceWindow.value) {
    await loadConfig();
    loadSyncWorkspaceSettingsFromConfig();
    if (isTauriWindow) {
      unlistenSyncWorkspaceProgress = await listen("sync-workspace-progress", (event) => {
        handleSyncWorkspaceProgress(event.payload);
      });
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

      // Part A: Resize pet window to fit sprite + padding
      // Part B: Report hitbox to Rust for mouse polling
      await nextTick();
      syncPetWindowSize();
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
      if (typeof state === "string" && ALL_VALID_IDLE_STATES.has(state)) {
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

    await listen("pet-skin-changed", (event) => {
      const skin = event.payload?.skin;
      if (typeof skin === "string") {
        config.personal.pet_skin = skin;
        if (skin in SPRITE_SHEET_SKINS) {
          loadSpriteSheetImages();
          nextTick(() => { startSpriteSheetAnimation(); setTimeout(syncPetWindowSize, 150); });
        } else {
          stopSpriteSheetAnimation();
          nextTick(() => setTimeout(syncPetWindowSize, 150));
        }
      }
    });

    await listen("pet-scale-changed", (event) => {
      const { skin, scale } = event.payload || {};
      if (typeof scale === "number" && typeof skin === "string") {
        setPetScale(skin, scale);
        nextTick(() => setTimeout(syncPetWindowSize, 150));
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

    // Initialize sprite sheet animation if skin is sprite-sheet type
    if (isSpriteSheetSkin.value) {
      loadSpriteSheetImages();
      nextTick(() => startSpriteSheetAnimation());
    }
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
  stopSpriteSheetAnimation();
  destroyWeatherEngine();
  if (skyTimeTimer) { clearInterval(skyTimeTimer); skyTimeTimer = null; }
  if (isPanelWindow.value) {
    detachPanelListeners();
    clearIdlePreview();
  }

  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
  }
  if (unlistenSyncWorkspaceProgress) {
    unlistenSyncWorkspaceProgress();
    unlistenSyncWorkspaceProgress = null;
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
  stopTableTabsCompressionMeasure();
  stopTableLayoutObserver();
  stopColumnResize();
});

watch(() => settingsDraft.petSkin, (newSkin) => {
  const ssDef = SPRITE_SHEET_IDLE_STATES[newSkin];
  if (ssDef) {
    settingsDraft.idleStates = [...ssDef.states];
  } else {
    settingsDraft.idleStates = [...ALLOWED_IDLE_STATES];
  }
  settingsDraft.petScale = getPetScale(newSkin);
});

watch(() => settingsDraft.backgroundOpacity, (val) => {
  if (settingsOpen.value) {
    config.personal.background_opacity = normalizeBackgroundOpacity(val);
  }
});

watch(() => settingsDraft.reduceTransparencyMode, (val) => {
  if (settingsOpen.value) {
    config.personal.reduce_transparency_mode = !!val;
  }
});

watch(() => settingsDraft.weatherEnabled, (val) => {
  if (!settingsOpen.value) return;
  if (val) {
    themeId.value = 'azure'
    document.documentElement.dataset.theme = 'azure'
  } else {
    themeId.value = preferredThemeId.value
    document.documentElement.dataset.theme = preferredThemeId.value
  }
});

// --- Skin Editor Functions ---
function openSkinEditor(editId = null) {
  skinEditorMsg.value = "";
  skinEditorLoading.value = false;
  skinEditorCanvasRefs.value = [];
  if (editId) {
    skinEditorEditingId.value = editId;
    const cs = customSkins.value.find((s) => s.id === editId);
    if (cs) {
      const m = cs.manifest;
      skinEditorName.value = m.name;
      skinEditorSearchAnim.value = m.searchAnim;
      skinEditorFoundAnim.value = m.foundAnim;
      skinEditorDefaultAnim.value = m.defaultAnim;
      // Reconstruct anims from manifest
      const skinKey = `custom:${editId}`;
      const skinDef = SPRITE_SHEET_SKINS[skinKey];
      skinEditorAnims.value = Object.entries(m.animations).map(([name, def]) => ({
        name,
        file: def.file,
        origPath: "",
        src: skinDef?.animations?.[name]?.src || "",
        width: def.frameWidth * def.frameCount,
        height: def.frameHeight,
        frameWidth: def.frameWidth,
        frameHeight: def.frameHeight,
        frameCount: def.frameCount,
        fps: def.fps,
      }));
    }
  } else {
    skinEditorEditingId.value = null;
    skinEditorName.value = "";
    skinEditorAnims.value = [];
    skinEditorSearchAnim.value = "";
    skinEditorFoundAnim.value = "";
    skinEditorDefaultAnim.value = "";
  }
  skinEditorStep.value = "import";
  skinEditorOpen.value = true;
}
function closeSkinEditor() {
  skinEditorOpen.value = false;
  stopSkinEditorPreviews();
}
async function onSkinEditorFileSelect() {
  try {
    const result = await open({
      multiple: true,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    await importSkinFiles(paths);
  } catch (e) {
    skinEditorMsg.value = `导入失败: ${e}`;
  }
}
async function importSkinFiles(paths) {
  skinEditorLoading.value = true;
  try {
    for (const filePath of paths) {
      const dims = await invoke("detect_sprite_dimensions", { filePath });
      const fileName = filePath.split(/[/\\]/).pop() || "sprite.png";
      const name = fileName.replace(/\.(png|PNG)$/, "");
      const fh = dims.height;
      const fw = fh; // square frames heuristic
      const fc = Math.max(1, Math.floor(dims.width / fw));
      skinEditorAnims.value.push({
        name,
        file: fileName,
        origPath: filePath,
        src: convertFileSrc(filePath),
        width: dims.width,
        height: dims.height,
        frameWidth: fw,
        frameHeight: fh,
        frameCount: fc,
        fps: 8,
      });
    }
    if (!skinEditorName.value && skinEditorAnims.value.length > 0) {
      skinEditorName.value = "自定义皮肤";
    }
    if (skinEditorAnims.value.length > 0 && !skinEditorDefaultAnim.value) {
      skinEditorDefaultAnim.value = skinEditorAnims.value[0].name;
    }
    if (skinEditorAnims.value.length > 0 && !skinEditorSearchAnim.value) {
      skinEditorSearchAnim.value = skinEditorAnims.value[0].name;
    }
    if (skinEditorAnims.value.length > 0 && !skinEditorFoundAnim.value) {
      skinEditorFoundAnim.value = skinEditorAnims.value[0].name;
    }
    skinEditorMsg.value = "";
  } catch (e) {
    skinEditorMsg.value = `导入失败: ${e}`;
  } finally {
    skinEditorLoading.value = false;
  }
}
function removeSkinEditorAnim(index) {
  skinEditorAnims.value.splice(index, 1);
}
async function saveSkinEditor() {
  if (!skinEditorName.value.trim()) {
    skinEditorMsg.value = "请输入皮肤名称";
    return;
  }
  if (skinEditorAnims.value.length === 0) {
    skinEditorMsg.value = "请至少导入一个动画";
    return;
  }
  if (!skinEditorDefaultAnim.value || !skinEditorSearchAnim.value || !skinEditorFoundAnim.value) {
    skinEditorMsg.value = "请设置所有动作绑定";
    return;
  }
  for (const anim of skinEditorAnims.value) {
    if (!anim.frameWidth || !anim.frameHeight || !anim.frameCount) {
      skinEditorMsg.value = `动画 "${anim.name}" 的帧参数无效`;
      return;
    }
  }
  skinEditorLoading.value = true;
  skinEditorMsg.value = "";
  try {
    // Determine skin directory name
    const skinName = skinEditorEditingId.value || skinEditorName.value.trim().replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, "_");
    // Import sprite files (only those with origPath, meaning newly imported)
    const newFiles = skinEditorAnims.value.filter((a) => a.origPath).map((a) => a.origPath);
    if (newFiles.length > 0) {
      await invoke("import_skin_sprites", { skinName, files: newFiles });
    }
    // Build manifest
    const animations = {};
    for (const anim of skinEditorAnims.value) {
      animations[anim.name] = {
        file: anim.file,
        frameWidth: anim.frameWidth,
        frameHeight: anim.frameHeight,
        frameCount: anim.frameCount,
        fps: anim.fps,
      };
    }
    const manifest = {
      name: skinEditorName.value.trim(),
      animations,
      searchAnim: skinEditorSearchAnim.value,
      foundAnim: skinEditorFoundAnim.value,
      defaultAnim: skinEditorDefaultAnim.value,
    };
    await invoke("save_skin_manifest", { skinName, manifest });
    // Reload custom skins
    customSkins.value = await invoke("list_custom_skins");
    await registerCustomSkins();
    // Auto-select the new skin
    settingsDraft.petSkin = `custom:${skinName}`;
    skinEditorMsg.value = "保存成功！";
    setTimeout(() => closeSkinEditor(), 500);
  } catch (e) {
    skinEditorMsg.value = `保存失败: ${e}`;
  } finally {
    skinEditorLoading.value = false;
  }
}
async function deleteSkinFromEditor(skinId) {
  if (!confirm("确定删除此皮肤？此操作不可撤销。")) return;
  try {
    await invoke("delete_custom_skin", { skinName: skinId });
    // Unregister
    delete SPRITE_SHEET_SKINS[`custom:${skinId}`];
    delete SPRITE_SHEET_IDLE_STATES[`custom:${skinId}`];
    customSkins.value = await invoke("list_custom_skins");
    if (settingsDraft.petSkin === `custom:${skinId}`) {
      settingsDraft.petSkin = "eagle";
    }
    closeSkinEditor();
  } catch (e) {
    skinEditorMsg.value = `删除失败: ${e}`;
  }
}
// Canvas-based animation preview for skin editor
const skinEditorPreviewTimers = [];
function startSkinEditorPreview(canvas, anim) {
  if (!canvas || !anim.src) return;
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.src = anim.src;
  let frame = 0;
  let lastTime = 0;
  const interval = 1000 / (anim.fps || 8);
  function tick(ts) {
    if (!skinEditorOpen.value) return;
    if (ts - lastTime >= interval) {
      lastTime = ts;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(
          img,
          frame * anim.frameWidth, 0, anim.frameWidth, anim.frameHeight,
          0, 0, anim.frameWidth, anim.frameHeight
        );
      }
      frame = (frame + 1) % (anim.frameCount || 1);
    }
    const id = requestAnimationFrame(tick);
    skinEditorPreviewTimers.push(id);
  }
  const id = requestAnimationFrame(tick);
  skinEditorPreviewTimers.push(id);
}
function stopSkinEditorPreviews() {
  for (const id of skinEditorPreviewTimers) {
    cancelAnimationFrame(id);
  }
  skinEditorPreviewTimers.length = 0;
}

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

watch(
  () => [tableOpen.value, tableTabs.value.length, activeTableTabId.value, config.personal.ui_scale],
  async ([open]) => {
    if (!open) {
      stopTableTabsCompressionMeasure();
      tableTabsCompressed.value = false;
      return;
    }
    await nextTick();
    scheduleTableTabsCompressionMeasure();
  },
);

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

watch(activeResultTab, () => {
  resetKeyboardResultNav();
  if (navZone.value === "results") {
    scrollKeyboardResultIntoView();
  }
});

watch(filteredResults, (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    navResultIndex.value = -1;
    return;
  }
  ensureKeyboardResultNav();
  if (navZone.value === "results") {
    scrollKeyboardResultIntoView();
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

function onPanelVisibilityChange() {
  const hidden = document.hidden;
  if (panelWasHidden && !hidden) {
    handlePanelActivated({
      reset: config.personal.reset_on_open_to_all_tables,
    });
  }
  panelWasHidden = hidden;
}

function onPanelFocus() {
  if (document.hidden) return;
  handlePanelActivated({ reset: false });
}

function bindPanelListeners() {
  panelWasHidden = document.hidden;
  window.addEventListener("click", onWindowClick);
  window.addEventListener("keydown", onWindowKeydown);
  window.addEventListener("wheel", onWindowWheel, { passive: false });
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("focus", onPanelFocus);
  document.addEventListener("visibilitychange", onPanelVisibilityChange);
  document.addEventListener("dragover", onDocDragover);
  document.addEventListener("drop", onDocDrop);
}

function detachPanelListeners() {
  window.removeEventListener("click", onWindowClick);
  window.removeEventListener("keydown", onWindowKeydown);
  window.removeEventListener("wheel", onWindowWheel);
  window.removeEventListener("resize", onWindowResize);
  window.removeEventListener("focus", onPanelFocus);
  document.removeEventListener("visibilitychange", onPanelVisibilityChange);
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
  scheduleTableTabsCompressionMeasure();
}

function formatTodayYmdByLocalTime() {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function resolveEditableTarget(target) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target;
  }
  if (target instanceof HTMLElement) {
    return target.closest?.("[contenteditable]:not([contenteditable='false'])") || null;
  }
  return null;
}

function insertTextIntoEditable(target, text) {
  const editableTarget = resolveEditableTarget(target);
  if (!editableTarget) return false;

  if (editableTarget instanceof HTMLInputElement || editableTarget instanceof HTMLTextAreaElement) {
    if (editableTarget.disabled || editableTarget.readOnly) return false;
    if (editableTarget instanceof HTMLInputElement) {
      const type = String(editableTarget.type || "").toLowerCase();
      const allowed = new Set(["", "text", "search", "url", "tel", "password", "email", "number"]);
      if (!allowed.has(type)) return false;
    }
    const start = Number.isInteger(editableTarget.selectionStart)
      ? editableTarget.selectionStart
      : editableTarget.value.length;
    const end = Number.isInteger(editableTarget.selectionEnd)
      ? editableTarget.selectionEnd
      : editableTarget.value.length;
    const nextValue = `${editableTarget.value.slice(0, start)}${text}${editableTarget.value.slice(end)}`;
    editableTarget.value = nextValue;
    const cursor = start + text.length;
    editableTarget.setSelectionRange(cursor, cursor);
    editableTarget.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  if (editableTarget instanceof HTMLElement && editableTarget.isContentEditable) {
    editableTarget.focus();
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
  return insertTextIntoEditable(active, token);
}

function onTableTabsWheel(event) {
  if (event.ctrlKey || event.metaKey) return;
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  const maxScroll = el.scrollWidth - el.clientWidth;
  if (maxScroll <= 0) return;

  if (event.deltaY === 0) return;
  event.preventDefault();
  el.scrollLeft += event.deltaY;
}

function scrollTableContentHorizontally(delta) {
  const wrap = document.querySelector(".table-content");
  if (!(wrap instanceof HTMLElement)) return false;
  wrap.scrollBy({ left: delta, behavior: "smooth" });
  return true;
}

function resetKeyboardResultNav() {
  navResultIndex.value = filteredResults.value.length > 0 ? 0 : -1;
}

function ensureKeyboardResultNav() {
  if (filteredResults.value.length === 0) {
    navResultIndex.value = -1;
    return;
  }
  if (navResultIndex.value < 0 || navResultIndex.value >= filteredResults.value.length) {
    navResultIndex.value = 0;
  }
}

function scrollKeyboardResultIntoView() {
  if (navResultIndex.value < 0) return;
  nextTick(() => {
    const row = document.getElementById(`result-item-${navResultIndex.value}`);
    row?.scrollIntoView?.({ block: "nearest" });
  });
}

function moveSidebarTabByStep(step = 1) {
  const keys = resultTabs.value.map((item) => item.key);
  if (keys.length === 0) return;
  const current = keys.findIndex((key) => key === activeResultTab.value);
  const base = current >= 0 ? current : 0;
  const next = ((base + (step >= 0 ? 1 : -1)) % keys.length + keys.length) % keys.length;
  activeResultTab.value = keys[next];
}

function moveResultNavByStep(step = 1) {
  if (filteredResults.value.length === 0) {
    navResultIndex.value = -1;
    return;
  }
  ensureKeyboardResultNav();
  const next = ((navResultIndex.value + (step >= 0 ? 1 : -1)) % filteredResults.value.length + filteredResults.value.length) % filteredResults.value.length;
  navResultIndex.value = next;
  scrollKeyboardResultIntoView();
}

async function openKeyboardFocusedResult() {
  ensureKeyboardResultNav();
  if (navResultIndex.value < 0) return;
  const item = filteredResults.value[navResultIndex.value];
  if (!item) return;
  if (item._type === "data") {
    await openFromData(item);
    return;
  }
  await openFromMeta(item);
}

function onWindowKeydown(event) {
  const lower = String(event.key || "").toLowerCase();
  const withPrimary = event.ctrlKey || event.metaKey;
  const allowPanelShortcut = !isEditableTarget(event.target) || isKeywordInputTarget(event.target);

  if (!isTauriWindow && !event.repeat && isEventMatchingHotkey(event, config.personal.quick_date_hotkey)) {
    if (!resolveEditableTarget(document.activeElement)) return;
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

  if (tableOpen.value && !isEditableTarget(event.target)) {
    if (isEventMatchingHotkey(event, config.personal.export_hotkey)) {
      event.preventDefault();
      exportCurrentTable();
      return;
    }
  }

  if (!isEditableTarget(event.target) && isEventMatchingHotkey(event, config.personal.batch_export_hotkey)) {
    event.preventDefault();
    openBatchExport();
    return;
  }

  if (
    isPanelWindow.value &&
    !document.hidden &&
    !settingsOpen.value &&
    allowPanelShortcut &&
    isEventMatchingHotkey(event, config.personal.template_prev_hotkey)
  ) {
    event.preventDefault();
    switchTemplateByStep(-1).catch(() => {});
    return;
  }

  if (
    isPanelWindow.value &&
    !document.hidden &&
    !settingsOpen.value &&
    allowPanelShortcut &&
    isEventMatchingHotkey(event, config.personal.template_next_hotkey)
  ) {
    event.preventDefault();
    switchTemplateByStep(1).catch(() => {});
    return;
  }

  if (
    tableOpen.value &&
    withPrimary &&
    !event.altKey &&
    !event.shiftKey &&
    !settingsOpen.value &&
    !isEditableTarget(event.target) &&
    (lower === "arrowleft" || lower === "arrowright")
  ) {
    const moved = scrollTableContentHorizontally(lower === "arrowleft" ? -240 : 240);
    if (moved) {
      event.preventDefault();
    }
    return;
  }

  if (
    !tableOpen.value &&
    withPrimary &&
    !event.altKey &&
    !event.shiftKey &&
    !settingsOpen.value &&
    allowPanelShortcut &&
    (lower === "arrowleft" || lower === "arrowright" || lower === "arrowup" || lower === "arrowdown")
  ) {
    event.preventDefault();
    if (lower === "arrowleft") {
      navZone.value = "sidebar";
      return;
    }
    if (lower === "arrowright") {
      navZone.value = "results";
      ensureKeyboardResultNav();
      scrollKeyboardResultIntoView();
      return;
    }
    if (navZone.value === "sidebar") {
      moveSidebarTabByStep(lower === "arrowdown" ? 1 : -1);
      return;
    }
    moveResultNavByStep(lower === "arrowdown" ? 1 : -1);
    return;
  }

  if (
    !tableOpen.value &&
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !settingsOpen.value &&
    !isEditableTarget(event.target) &&
    navZone.value === "results"
  ) {
    event.preventDefault();
    openKeyboardFocusedResult().catch(() => {});
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

  if (tableOpen.value && event.key === "Tab" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    const tabs = tableTabs.value;
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === activeTableTabId.value);
    const next = (idx + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
    activateTableTab(tabs[next].id).catch(() => {});
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
    if (event.key === '`') {
      event.preventDefault();
      onEditToggleClick();
      return;
    }
  }

  const tableDialogKeyAction = resolveTableDialogKeyAction({
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    tableOpen: tableOpen.value,
    settingsOpen: settingsOpen.value,
    isEditable: isEditableTarget(event.target),
  });
  if (tableDialogKeyAction === "closeTable") {
    event.preventDefault();
    closeTableDialog();
    return;
  }
  if (tableDialogKeyAction === "closeAllTables") {
    event.preventDefault();
    closeTableDialogAndClearTabs();
    return;
  }
  if (tableDialogKeyAction === "toggleFullscreen") {
    event.preventDefault();
    toggleTableFullscreen().catch(() => {});
    return;
  }

  if (!isEditableTarget(event.target) && isEventMatchingHotkey(event, config.personal.always_on_top_hotkey)) {
    event.preventDefault();
    config.personal.always_on_top = !config.personal.always_on_top;
    invoke("set_panel_always_on_top", { alwaysOnTop: config.personal.always_on_top }).catch(() => {});
    showCopyToast(config.personal.always_on_top ? "已置顶" : "已取消置顶", "success");
    return;
  }

  if (event.key !== "Escape") return;

  if (exportDialogOpen.value) {
    exportDialogOpen.value = false;
    return;
  }

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
    snapshotActiveTableTab();
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

function normalizeQuickDateHotkey(value) {
  const normalized = normalizeHotkeyDisplay(value);
  if (!normalized || isModifierOnlyHotkey(normalized)) return "F9";
  return normalized;
}

function normalizeTemplateSwitchHotkey(value, fallback) {
  const normalized = normalizeHotkeyDisplay(value);
  if (!normalized || isModifierOnlyHotkey(normalized)) return fallback;
  return normalized;
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
  snapshotActiveTableTab();
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

function modalHeaderPointerDown(event) {
  if (event.button !== 0 || !isTauriWindow) return;
  const target = event.target;
  if (target instanceof Element && target.closest("button, input, textarea, select, label, a")) return;
  getCurrentWindow().startDragging().catch(() => {});
}

function switchSettingsTab(index) {
  if (index < -1 || index >= SETTINGS_TABS.length || index === settingsTab.value) return;
  settingsTab.value = index;
}

function openSettings(target = null) {
  const targetIndex = target === null ? -1 : (typeof target === "number"
    ? target
    : Math.max(0, SETTINGS_TABS.findIndex((tab) => tab.id === target)));
  settingsTab.value = targetIndex;
  syncSettingsDraftDbFields();
  settingsDraft.hotkey = normalizeHotkeyDisplay(config.personal.hotkey);
  settingsDraft.quickDateHotkey = normalizeQuickDateHotkey(config.personal.quick_date_hotkey);
  settingsDraft.autoStart = config.personal.auto_start;
  settingsDraft.tableDefaultView = normalizeTableDefaultView(config.personal.table_default_view);
  settingsDraft.idleStates = [...sanitizeIdleStates(config.personal.idle_states)];
  settingsDraft.excludeTables = (config.shared.search.exclude_tables || []).join(",");
  settingsDraft.perTableTimeoutSec = config.shared.search.per_table_timeout_sec;
  settingsDraft.perTableMaxRows = config.shared.search.per_table_max_rows;
  settingsDraft.exportHotkey = normalizeHotkeyDisplay(config.personal.export_hotkey);
  settingsDraft.batchExportHotkey = normalizeHotkeyDisplay(config.personal.batch_export_hotkey);
  settingsDraft.alwaysOnTop = config.personal.always_on_top;
  settingsDraft.alwaysOnTopHotkey = normalizeHotkeyDisplay(config.personal.always_on_top_hotkey || "P");
  settingsDraft.templatePrevHotkey = normalizeTemplateSwitchHotkey(
    config.personal.template_prev_hotkey,
    "Ctrl+Alt+Left",
  );
  settingsDraft.templateNextHotkey = normalizeTemplateSwitchHotkey(
    config.personal.template_next_hotkey,
    "Ctrl+Alt+Right",
  );
  settingsDraft.resetOnOpenToAllTables = config.personal.reset_on_open_to_all_tables !== false;
  settingsDraft.templateName = "";
  settingsDraft.petSkin = config.personal.pet_skin || "eagle";
  settingsDraft.petScale = getPetScale(settingsDraft.petSkin);
  settingsDraft.customFont = config.personal.custom_font || null;
  settingsDraft.weatherEnabled = config.personal.weather_enabled !== false;
  settingsDraft.backgroundOpacity = normalizeBackgroundOpacity(config.personal.background_opacity);
  settingsDraft.reduceTransparencyMode = !!config.personal.reduce_transparency_mode;
  _opacityBeforeSettings = config.personal.background_opacity;
  _reduceTransparencyBeforeSettings = !!config.personal.reduce_transparency_mode;
  _weatherBeforeSettings = weatherEnabled.value;
  if (isTauriWindow) {
    invoke("list_system_fonts").then((fonts) => { systemFonts.value = fonts; }).catch(() => {});
  }
  settingsMsg.value = "";
  settingsOpen.value = true;
}

let _opacityBeforeSettings = 1;
let _reduceTransparencyBeforeSettings = false;
let _weatherBeforeSettings = true;

function closeSettings() {
  clearIdlePreview();
  config.personal.background_opacity = _opacityBeforeSettings;
  config.personal.reduce_transparency_mode = _reduceTransparencyBeforeSettings;
  // Restore weather state if toggled during settings without saving
  if (_weatherBeforeSettings !== weatherEnabled.value) {
    weatherEnabled.value = _weatherBeforeSettings;
    if (_weatherBeforeSettings) {
      themeId.value = 'azure'
      document.documentElement.dataset.theme = 'azure'
      nextTick().then(() => {
        if (!weatherEngine) {
          initWeatherEngine();
          fetchWeather();
          if (!weatherRefreshTimer) {
            weatherRefreshTimer = setInterval(fetchWeather, WEATHER_REFRESH_MS);
          }
        }
      });
    } else {
      destroyWeatherEngine();
      themeId.value = preferredThemeId.value
      document.documentElement.dataset.theme = preferredThemeId.value
    }
  }
  settingsTab.value = -1;
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
    await onDbConnectionChanged();
  } catch (error) {
    settingsMsg.value = `✗ 连接失败：${String(error)}`;
  }
}

async function saveSettings() {
  const previousHotkey = config.personal.hotkey;
  const previousQuickDateHotkey = config.personal.quick_date_hotkey;
  applyDbConfigToShared({
    host: settingsDraft.host.trim(),
    port: Number(settingsDraft.port) || 3306,
    username: settingsDraft.username.trim(),
    password: settingsDraft.password,
    database: settingsDraft.database.trim(),
  });

  config.personal.hotkey = normalizeHotkeyDisplay(settingsDraft.hotkey.trim() || "Ctrl+Shift+F");
  config.personal.quick_date_hotkey = normalizeQuickDateHotkey(settingsDraft.quickDateHotkey.trim() || "F9");
  config.personal.idle_states = sanitizeIdleStates(settingsDraft.idleStates);
  config.personal.table_default_view = normalizeTableDefaultView(settingsDraft.tableDefaultView);
  config.personal.export_hotkey = normalizeHotkeyDisplay(settingsDraft.exportHotkey.trim() || "Ctrl+E");
  config.personal.batch_export_hotkey = normalizeHotkeyDisplay(settingsDraft.batchExportHotkey.trim() || "Ctrl+Shift+E");
  config.personal.always_on_top_hotkey = normalizeHotkeyDisplay(settingsDraft.alwaysOnTopHotkey.trim() || "P");
  config.personal.template_prev_hotkey = normalizeTemplateSwitchHotkey(
    settingsDraft.templatePrevHotkey.trim() || "Ctrl+Alt+Left",
    "Ctrl+Alt+Left",
  );
  config.personal.template_next_hotkey = normalizeTemplateSwitchHotkey(
    settingsDraft.templateNextHotkey.trim() || "Ctrl+Alt+Right",
    "Ctrl+Alt+Right",
  );
  if (isModifierOnlyHotkey(config.personal.hotkey)) {
    settingsMsg.value = "✗ 快捷键必须包含至少一个非修饰键，例如 Ctrl+Shift+F";
    return;
  }
  if (isModifierOnlyHotkey(config.personal.quick_date_hotkey)) {
    settingsMsg.value = "✗ 日期快捷键必须包含至少一个非修饰键，例如 F9";
    return;
  }
  if (config.personal.quick_date_hotkey === config.personal.hotkey) {
    settingsMsg.value = "✗ 日期快捷键不能与主快捷键重复";
    return;
  }
  if (config.personal.template_prev_hotkey === config.personal.template_next_hotkey) {
    settingsMsg.value = "✗ 模板上一快捷键不能与模板下一快捷键重复";
    return;
  }

  const fixedPanelHotkeys = new Set(["Ctrl+P", "Ctrl+O", "Ctrl+[", "Ctrl+]"]);
  if (fixedPanelHotkeys.has(config.personal.template_prev_hotkey) || fixedPanelHotkeys.has(config.personal.template_next_hotkey)) {
    settingsMsg.value = "✗ 模板切换快捷键不能与面板内置快捷键冲突";
    return;
  }

  const duplicateCheck = new Map();
  const configurableHotkeys = [
    ["主快捷键", config.personal.hotkey],
    ["日期快捷键", config.personal.quick_date_hotkey],
    ["导出快捷键", config.personal.export_hotkey],
    ["批量导出快捷键", config.personal.batch_export_hotkey],
    ["置顶快捷键", config.personal.always_on_top_hotkey],
    ["模板上一快捷键", config.personal.template_prev_hotkey],
    ["模板下一快捷键", config.personal.template_next_hotkey],
  ];
  for (const [label, key] of configurableHotkeys) {
    const normalizedKey = normalizeHotkeyDisplay(key);
    if (!normalizedKey) continue;
    if (duplicateCheck.has(normalizedKey)) {
      settingsMsg.value = `✗ ${label}与${duplicateCheck.get(normalizedKey)}重复`;
      return;
    }
    duplicateCheck.set(normalizedKey, label);
  }

  config.shared.search.exclude_tables = settingsDraft.excludeTables
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  config.shared.search.per_table_timeout_sec = Number(settingsDraft.perTableTimeoutSec) || 10;
  config.shared.search.per_table_max_rows = Number(settingsDraft.perTableMaxRows) || 50;
  config.personal.reset_on_open_to_all_tables = !!settingsDraft.resetOnOpenToAllTables;
  config.personal.pet_skin = settingsDraft.petSkin || "eagle";
  setPetScale(settingsDraft.petSkin, settingsDraft.petScale);
  config.personal.custom_font = settingsDraft.customFont || null;
  config.personal.weather_enabled = !!settingsDraft.weatherEnabled;
  config.personal.background_opacity = normalizeBackgroundOpacity(settingsDraft.backgroundOpacity);
  config.personal.reduce_transparency_mode = !!settingsDraft.reduceTransparencyMode;
  weatherEnabled.value = !!settingsDraft.weatherEnabled;
  if (weatherEnabled.value) {
    themeId.value = 'azure'
    document.documentElement.dataset.theme = 'azure'
    await nextTick();
    if (!weatherEngine) {
      initWeatherEngine();
      fetchWeather();
      if (!weatherRefreshTimer) {
        weatherRefreshTimer = setInterval(fetchWeather, WEATHER_REFRESH_MS);
      }
    }
  } else {
    destroyWeatherEngine();
    themeId.value = preferredThemeId.value
    document.documentElement.dataset.theme = preferredThemeId.value
  }

  if (isTauriWindow) {
    try {
      await invoke("register_hotkey", { hotkey: config.personal.hotkey });
    } catch (error) {
      config.personal.hotkey = previousHotkey;
      settingsMsg.value = `✗ 快捷键注册失败：${String(error)}`;
      return;
    }

    try {
      await invoke("register_quick_date_hotkey", { hotkey: config.personal.quick_date_hotkey });
    } catch (error) {
      config.personal.quick_date_hotkey = previousQuickDateHotkey;
      config.personal.hotkey = previousHotkey;
      await invoke("register_hotkey", { hotkey: previousHotkey }).catch(() => {});
      settingsMsg.value = `✗ 日期快捷键注册失败：${String(error)}`;
      return;
    }
  }

  config.personal.auto_start = !!settingsDraft.autoStart;
  config.personal.always_on_top = !!settingsDraft.alwaysOnTop;
  if (isTauriWindow) {
    await invoke("set_panel_always_on_top", { alwaysOnTop: config.personal.always_on_top }).catch(() => {});
  }
  await persistConfig();
  if (isTauriWindow) {
    emit("pet-idle-states-changed", {
      idleStates: config.personal.idle_states,
    }).catch(() => {});
    emit("pet-skin-changed", {
      skin: config.personal.pet_skin,
    }).catch(() => {});
    emit("pet-scale-changed", {
      skin: config.personal.pet_skin,
      scale: getPetScale(config.personal.pet_skin),
    }).catch(() => {});
  }
  await invoke("set_autostart", { enable: config.personal.auto_start }).catch(() => {});

  let connected = false;
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
    connected = true;
  } catch {
    // keep saved config even if connect failed
  }

  if (connected) {
    await onDbConnectionChanged();
  } else {
    await refreshConnectionStatus();
  }
  _opacityBeforeSettings = config.personal.background_opacity;
  _reduceTransparencyBeforeSettings = !!config.personal.reduce_transparency_mode;
  _weatherBeforeSettings = weatherEnabled.value;
  applyCustomFont();
  clearIdlePreview();
  settingsOpen.value = false;
}

// ── 数据库模板 ──
function saveAsTemplate(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return;
  const db = {
    host: config.shared.db.host,
    port: config.shared.db.port,
    username: config.shared.db.username,
    password: config.shared.db.password,
    database: config.shared.db.database,
  };
  config.shared.db_templates.push({ name: trimmed, db });
  persistConfig();
}

function deleteTemplate(idx) {
  config.shared.db_templates.splice(idx, 1);
  persistConfig();
}

async function switchToTemplate(idx) {
  if (templateSwitching.value) return;
  const tpl = config.shared.db_templates[idx];
  if (!tpl) return;
  if (editMode.value && editDirty.value) {
    const blockedMsg = "当前有未保存编辑，请先保存或放弃后再切换模板";
    settingsMsg.value = `✗ ${blockedMsg}`;
    showCopyToast(blockedMsg, "error");
    return;
  }

  const nextDb = {
    host: String(tpl.db?.host || ""),
    port: Number(tpl.db?.port) || 3306,
    username: String(tpl.db?.username || ""),
    password: String(tpl.db?.password || ""),
    database: String(tpl.db?.database || ""),
  };
  templateSwitching.value = true;
  templateSwitchingIndex.value = idx;

  try {
    await invoke("connect_db", { config: nextDb });
    applyDbConfigToShared(nextDb);
    syncSettingsDraftDbFields(nextDb);
    await onDbConnectionChanged({ resetContext: true });
    templateCursorIndex.value = idx;
    const detail = `${nextDb.host}:${nextDb.port}/${nextDb.database}`;
    const msg = `已切换到模板 ${tpl.name}（${detail}）`;
    summaryText.value = msg;
    settingsMsg.value = `✓ ${msg}`;
    showCopyToast(msg, "success");
  } catch (e) {
    const errorMsg = `模板切换失败，已保持当前连接：${String(e)}`;
    settingsMsg.value = `✗ ${errorMsg}`;
    showCopyToast(errorMsg, "error");
  } finally {
    templateSwitching.value = false;
    templateSwitchingIndex.value = -1;
  }
}

async function switchTemplateByStep(step = 1) {
  const list = Array.isArray(config.shared.db_templates) ? config.shared.db_templates : [];
  if (list.length === 0) {
    showCopyToast("暂无可切换模板", "error");
    return;
  }
  const delta = step >= 0 ? 1 : -1;
  const matchedIndex = activeTemplateIndex.value;
  const cursor = Number(templateCursorIndex.value);
  const hasCursor = cursor >= 0 && cursor < list.length;
  const current = hasCursor ? cursor : (matchedIndex >= 0 ? matchedIndex : (delta > 0 ? -1 : 0));
  const next = ((current + delta) % list.length + list.length) % list.length;
  if (list.length === 1 && matchedIndex >= 0 && next === matchedIndex) {
    showCopyToast("仅有一个模板", "success");
    return;
  }
  await switchToTemplate(next);
}

// ── 字体 ──
const systemFonts = ref([]);

function applyCustomFont() {
  const font = config.personal.custom_font;
  if (font) {
    document.documentElement.style.setProperty("--app-font", `"${font}", "Noto Sans SC", "Microsoft YaHei", sans-serif`);
  } else {
    document.documentElement.style.removeProperty("--app-font");
  }
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
  // Clear any inline width/height left by CSS resize: both
  if (tableModalRef.value) {
    tableModalRef.value.style.width = '';
    tableModalRef.value.style.height = '';
  }
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
    if (!tableFullscreenRestoreMaximized.value) {
      await appWindow.unmaximize().catch(() => {});
    }
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
    const prevCursor = tableFindCursor.value;
    await runTableFind().catch(() => {});
    if (prevCursor >= 0 && tableFindMatches.value.length > 0) {
      tableFindCursor.value = Math.min(prevCursor, tableFindMatches.value.length - 1);
      focusTableFindMatch(tableFindMatches.value[tableFindCursor.value]).catch(() => {});
    }
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
    syncSummaryForDefaultTableBrowse();
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
  const ranges = findHighlightRanges(content, sanitizeTerms(termsInput));
  if (ranges.length === 0) return escapeHtml(content);

  let cursor = 0;
  let output = "";
  ranges.forEach((range) => {
    output += escapeHtml(content.slice(cursor, range.start));
    output += `<mark>${escapeHtml(content.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  });
  output += escapeHtml(content.slice(cursor));
  return output;
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
  if (item.match_type === "TableName") externalHitCount = tableTabCount.value;
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
  const sourceItem = item?._item || item;
  const rowIndex = item?.row_index ?? sourceItem?.first_row_index ?? null;
  const columns = Array.isArray(item?.hit_columns) && item.hit_columns.length > 0
    ? item.hit_columns.filter(Boolean)
    : Array.isArray(sourceItem?.matched_columns)
      ? sourceItem.matched_columns.filter(Boolean)
      : [];
  const col = item?.column || columns[0] || null;
  await openOrActivateTableTab(sourceItem.table_name, rowIndex, col, {
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
  if (editMode.value && editDirty.value) {
    editUnsavedDialogOpen.value = true
    editUnsavedCallback.value = async () => { resetEditChanges(); tableView.page -= 1; await loadTablePage({ resetFocus: true, clearHitCache: true }) }
    return
  }
  tableView.page -= 1;
  await loadTablePage({ resetFocus: true, clearHitCache: true });
}

async function nextPage() {
  if (tableView.page >= totalPages.value) return;
  if (editMode.value && editDirty.value) {
    editUnsavedDialogOpen.value = true
    editUnsavedCallback.value = async () => { resetEditChanges(); tableView.page += 1; await loadTablePage({ resetFocus: true, clearHitCache: true }) }
    return
  }
  tableView.page += 1;
  await loadTablePage({ resetFocus: true, clearHitCache: true });
}

function closeTableDialog() {
  if (editMode.value && editDirty.value) {
    editUnsavedDialogOpen.value = true
    editUnsavedCallback.value = () => { forceExitEditMode(); doCloseTableDialog() }
    return
  }
  forceExitEditMode()
  doCloseTableDialog()
}
function closeTableDialogAndClearTabs() {
  if (editMode.value && editDirty.value) {
    editUnsavedDialogOpen.value = true
    editUnsavedCallback.value = () => { forceExitEditMode(); doCloseTableDialog(); clearTableTabs() }
    return
  }
  forceExitEditMode()
  doCloseTableDialog()
  clearTableTabs()
}
function doCloseTableDialog() {
  snapshotActiveTableTab();
  resetTableFindState();
  clearColumnWidths();
  stopTableTabsCompressionMeasure();
  tableTabsCompressed.value = false;
  stopTableLayoutObserver();
  exitTableFullscreen().catch(() => {});
  closeTableCommandPalette();
  tableOpen.value = false;
  tableDetailView.value = normalizeTableDefaultView(config.personal.table_default_view);
  hitCollectToken += 1;
  allHitRows.value = [];
  allHitRowsLoading.value = false;
  tableView.hitNavCursor = -1;
  tableView.focusedHitLocalIndex = null;
  setDetailHitContext();
}

// ── 编辑模式：工具函数 ──
function getTablePrimaryKeys() {
  return tableView.columns.filter(c => c.is_primary_key).map(c => c.column_name)
}
function hasTablePrimaryKey() {
  return getTablePrimaryKeys().length > 0
}
function computeRowKey(row, idx) {
  const pks = getTablePrimaryKeys()
  if (pks.length > 0) return pks.map(k => String(row[k] ?? '')).join('||')
  return `__idx_${tableView.page}_${idx}`
}

const editSaveSummary = computed(() => {
  const updates = editChanges.updates.size
  const inserts = editChanges.inserts.length
  const deletes = editChanges.deletes.size
  return { updates, inserts, deletes, total: updates + inserts + deletes }
})

// ── 编辑模式：日期密码验证 ──
function onEditToggleClick() {
  if (editMode.value) {
    if (editDirty.value) {
      editUnsavedDialogOpen.value = true
      editUnsavedCallback.value = () => exitEditMode()
      return
    }
    exitEditMode()
  } else {
    editDateInput.value = ''
    editDateError.value = false
    editDateDialogOpen.value = true
    nextTick(() => document.getElementById('edit-date-input')?.focus())
  }
}
function validateEditDate() {
  const today = new Date()
  const expected = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
  if (editDateInput.value === expected) {
    editDateDialogOpen.value = false
    enterEditMode()
  } else {
    editDateError.value = true
    setTimeout(() => { editDateError.value = false }, 500)
  }
}
watch(editDateInput, (val) => {
  if (val.length === 8) validateEditDate()
})

// ── 编辑模式：进入/退出 ──
function resetEditChanges() {
  editChanges.updates.clear()
  editChanges.inserts.splice(0)
  editChanges.deletes.clear()
  editSelectedRows.clear()
  editDirty.value = false
  Object.assign(editingCell, { active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
}
function enterEditMode() {
  resetEditChanges()
  editMode.value = true
  editNoPkWarningShown.value = !hasTablePrimaryKey()
  triggerEditGlow()
}
function exitEditMode() {
  cancelCellEdit()
  triggerExitGlow(() => {
    editMode.value = false
    resetEditChanges()
    editNoPkWarningShown.value = false
  })
}
function forceExitEditMode() {
  clearEditGlowTimers()
  editGlowPhase.value = 'none'
  editMode.value = false
  resetEditChanges()
  editNoPkWarningShown.value = false
}
function clearEditGlowTimers() {
  if (editGlowTimer) { clearTimeout(editGlowTimer); editGlowTimer = null }
}
function triggerEditGlow() {
  clearEditGlowTimers()
  editGlowPhase.value = 'ignition'
  editGlowTimer = setTimeout(() => {
    editGlowPhase.value = 'aurora'
    editGlowTimer = setTimeout(() => {
      editGlowPhase.value = 'cooldown'
      editGlowTimer = setTimeout(() => {
        editGlowPhase.value = 'steady'
        editGlowTimer = null
      }, 500)
    }, 2400)
  }, 600)
}
function triggerExitGlow(callback) {
  clearEditGlowTimers()
  editGlowPhase.value = 'exit'
  editGlowTimer = setTimeout(() => {
    editGlowPhase.value = 'none'
    editGlowTimer = null
    if (callback) callback()
  }, 400)
}

// ── 编辑模式：单元格编辑 ──
function startCellEdit(rowIndex, columnName) {
  if (!editMode.value) return
  const key = computeRowKey(tableView.rows[rowIndex], rowIndex)
  if (editChanges.deletes.has(key)) return
  const original = String(tableView.rows[rowIndex]?.[columnName] ?? '')
  Object.assign(editingCell, { active: true, rowIndex, columnName, originalValue: original, currentValue: original })
  nextTick(() => {
    const el = document.getElementById('edit-cell-input')
    if (el) { el.focus(); el.select() }
  })
}
function confirmCellEdit() {
  if (!editingCell.active) return
  const { rowIndex, columnName, originalValue, currentValue } = editingCell
  if (currentValue !== originalValue) {
    const row = tableView.rows[rowIndex]
    const key = computeRowKey(row, rowIndex)
    if (!editChanges.updates.has(key)) {
      const pks = getTablePrimaryKeys()
      const whereKeys = {}
      if (pks.length > 0) {
        pks.forEach(pk => { whereKeys[pk] = String(row[pk] ?? '') })
      } else {
        tableView.columns.forEach(c => { whereKeys[c.column_name] = String(row[c.column_name] ?? '') })
      }
      editChanges.updates.set(key, { whereKeys, changes: {} })
    }
    editChanges.updates.get(key).changes[columnName] = currentValue
    tableView.rows[rowIndex][columnName] = currentValue
    editDirty.value = true
  }
  Object.assign(editingCell, { active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
}
function cancelCellEdit() {
  Object.assign(editingCell, { active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
}
function onCellEditKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); confirmCellEdit() }
  else if (e.key === 'Escape') { e.preventDefault(); cancelCellEdit() }
  else if (e.key === 'Tab') {
    e.preventDefault()
    const curRow = editingCell.rowIndex
    const curCol = editingCell.columnName
    confirmCellEdit()
    const colNames = tableView.columns.map(c => c.column_name)
    const curColIdx = colNames.indexOf(curCol)
    const nextColIdx = curColIdx + 1
    if (nextColIdx < colNames.length && curRow >= 0) {
      startCellEdit(curRow, colNames[nextColIdx])
    }
  }
}
function startNewRowCellEdit(insertIdx, columnName) {
  if (!editMode.value) return
  const original = String(editChanges.inserts[insertIdx]?.[columnName] ?? '')
  // Use a special index for new rows: offset by existing rows count
  const specialIdx = tableView.rows.length + insertIdx
  Object.assign(editingCell, { active: true, rowIndex: specialIdx, columnName, originalValue: original, currentValue: original })
  nextTick(() => {
    const el = document.getElementById('edit-cell-input')
    if (el) { el.focus(); el.select() }
  })
}
function confirmNewRowCellEdit(insertIdx) {
  if (!editingCell.active) return
  const { columnName, currentValue } = editingCell
  if (editChanges.inserts[insertIdx]) {
    editChanges.inserts[insertIdx][columnName] = currentValue
    editDirty.value = true
  }
  Object.assign(editingCell, { active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
}
function onNewRowCellEditKeydown(e, insertIdx) {
  if (e.key === 'Enter') { e.preventDefault(); confirmNewRowCellEdit(insertIdx) }
  else if (e.key === 'Escape') { e.preventDefault(); cancelCellEdit() }
}

// ── 编辑模式：行操作 ──
function toggleRowSelection(idx) {
  const key = computeRowKey(tableView.rows[idx], idx)
  if (editChanges.deletes.has(key)) return
  if (editSelectedRows.has(key)) editSelectedRows.delete(key)
  else editSelectedRows.add(key)
}
function toggleSelectAll() {
  const selectableKeys = tableView.rows
    .map((row, idx) => computeRowKey(row, idx))
    .filter(k => !editChanges.deletes.has(k))
  if (editSelectedRows.size > 0 && editSelectedRows.size === selectableKeys.length) {
    editSelectedRows.clear()
  } else {
    selectableKeys.forEach(k => editSelectedRows.add(k))
  }
}
function addNewRow() {
  const newRow = {}
  tableView.columns.forEach(c => { newRow[c.column_name] = '' })
  editChanges.inserts.push(newRow)
  editDirty.value = true
}
function removeNewRow(insertIdx) {
  editChanges.inserts.splice(insertIdx, 1)
  editDirty.value = editChanges.updates.size > 0 || editChanges.inserts.length > 0 || editChanges.deletes.size > 0
}
function deleteSelectedRows() {
  editSelectedRows.forEach(key => {
    editChanges.deletes.add(key)
    // Remove any pending updates for deleted rows
    editChanges.updates.delete(key)
  })
  editSelectedRows.clear()
  editDirty.value = true
}
function isRowDeleted(row, idx) {
  return editChanges.deletes.has(computeRowKey(row, idx))
}
function isRowModified(row, idx) {
  return editChanges.updates.has(computeRowKey(row, idx))
}
function isCellModified(row, idx, columnName) {
  const key = computeRowKey(row, idx)
  const upd = editChanges.updates.get(key)
  return upd ? columnName in upd.changes : false
}

// ── 编辑模式：保存 ──
function openSaveDialog() {
  editSaveDialogOpen.value = true
}
async function confirmSave() {
  editSaveDialogOpen.value = false
  const pks = getTablePrimaryKeys()
  const hasPk = pks.length > 0

  const updates = []
  editChanges.updates.forEach((val) => {
    updates.push({ whereKeys: val.whereKeys, changes: val.changes })
  })

  const deletes = []
  editChanges.deletes.forEach(key => {
    // Find matching row
    const rowIdx = tableView.rows.findIndex((r, i) => computeRowKey(r, i) === key)
    if (rowIdx >= 0) {
      const row = tableView.rows[rowIdx]
      const rowData = {}
      if (hasPk) {
        pks.forEach(pk => { rowData[pk] = String(row[pk] ?? '') })
      } else {
        tableView.columns.forEach(c => { rowData[c.column_name] = String(row[c.column_name] ?? '') })
      }
      deletes.push(rowData)
    }
  })

  const inserts = editChanges.inserts
    .filter(r => Object.values(r).some(v => v !== ''))
    .map(r => {
      const clean = {}
      Object.entries(r).forEach(([k, v]) => { if (v !== '') clean[k] = v })
      return clean
    })

  const changeset = {
    tableName: tableView.tableName,
    primaryKeys: pks,
    updates,
    inserts,
    deletes,
  }

  try {
    const result = await invoke('save_table_changes', { changeset })
    const parts = []
    if (result.inserted > 0) parts.push(`插入 ${result.inserted} 行`)
    if (result.updated > 0) parts.push(`更新 ${result.updated} 行`)
    if (result.deleted > 0) parts.push(`删除 ${result.deleted} 行`)
    showCopyToast(parts.length > 0 ? parts.join('，') : '无变更', 'success')
    resetEditChanges()
    await loadTablePage({ resetFocus: false, clearHitCache: false })
  } catch (err) {
    showCopyToast(`保存失败: ${String(err)}`, 'error')
  }
}
function discardAndProceed() {
  editUnsavedDialogOpen.value = false
  const cb = editUnsavedCallback.value
  editUnsavedCallback.value = null
  if (cb) cb()
}

async function loadConfig() {
  try {
    const loaded = await invoke("get_config");
    if (loaded?.shared?.db) Object.assign(config.shared.db, loaded.shared.db);
    if (loaded?.shared?.search) Object.assign(config.shared.search, loaded.shared.search);
    if (Array.isArray(loaded?.shared?.db_templates)) config.shared.db_templates = loaded.shared.db_templates;
    if (loaded?.personal) Object.assign(config.personal, loaded.personal);
  } catch {
    // keep default
  }
  config.personal.idle_states = sanitizeIdleStates(config.personal.idle_states);
  config.personal.ui_scale = normalizeUiScale(config.personal.ui_scale);
  config.personal.table_default_view = normalizeTableDefaultView(config.personal.table_default_view);
  config.personal.quick_date_hotkey = normalizeQuickDateHotkey(config.personal.quick_date_hotkey);
  config.personal.template_prev_hotkey = normalizeTemplateSwitchHotkey(
    config.personal.template_prev_hotkey,
    "Ctrl+Alt+Left",
  );
  config.personal.template_next_hotkey = normalizeTemplateSwitchHotkey(
    config.personal.template_next_hotkey,
    "Ctrl+Alt+Right",
  );
  config.personal.reset_on_open_to_all_tables = config.personal.reset_on_open_to_all_tables !== false;
  config.personal.background_opacity = normalizeBackgroundOpacity(config.personal.background_opacity);
  config.personal.reduce_transparency_mode = !!config.personal.reduce_transparency_mode;
  {
    const syncSettings = normalizeSyncWorkspaceSettings(config.personal);
    const defaultProfileId = syncSettings.defaultProfileId || syncSettings.profiles[0]?.id || null;
    const lastUsedProfileId = resolveSyncProfileSelection(syncSettings.profiles, {
      lastUsedProfileId: syncSettings.lastUsedProfileId,
      defaultProfileId,
    });
    config.personal.sync_window_hotkey = syncSettings.syncWindowHotkey;
    config.personal.sync_profiles = syncSettings.profiles.map((profile) => ({ ...profile }));
    config.personal.default_sync_profile_id = defaultProfileId;
    config.personal.last_used_sync_profile_id = lastUsedProfileId || null;
  }
  templateCursorIndex.value = findTemplateIndexByDb(config.shared.db);
}

watch(activeTemplateIndex, (idx) => {
  const list = Array.isArray(config.shared.db_templates) ? config.shared.db_templates : [];
  if (idx >= 0 && idx < list.length && !templateSwitching.value) {
    templateCursorIndex.value = idx;
    return;
  }
  if (templateCursorIndex.value >= list.length) {
    templateCursorIndex.value = list.length > 0 ? list.length - 1 : -1;
  }
});

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
  await runPetMenuAction(action, {
    isTauriWindow,
    invoke,
    getWindowByLabel: Window.getByLabel,
    setPetHiddenForSession(value) {
      petHiddenForSession.value = value;
    },
  });
}

function petPointerDown(event) {
  if (event.button !== 0 || !isTauriWindow) return;
  event.preventDefault();
  petDragging.value = true;

  const endDrag = () => {
    petDragging.value = false;
    document.removeEventListener('pointerup', endDrag);
    window.removeEventListener('blur', endDrag);
    clearTimeout(fallback);
  };
  document.addEventListener('pointerup', endDrag, { once: true });
  window.addEventListener('blur', endDrag, { once: true });
  const fallback = setTimeout(endDrag, 5000);

  getCurrentWindow().startDragging().catch(() => {});
}

// ── 宠物窗口尺寸同步 ──
const PET_WINDOW_PADDING = 16; // px padding around sprite

function syncPetWindowSize() {
  if (!isPetWindow.value || !isTauriWindow) return;
  const sprite = document.getElementById("eagleSprite");
  if (!sprite) return;
  const container = sprite.closest(".eagle-container") || sprite.closest(".spritesheet-container");
  const el = container || sprite;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const winW = rect.width + PET_WINDOW_PADDING * 2;
  const winH = rect.height + PET_WINDOW_PADDING * 2;

  invoke("resize_pet_window", { width: Math.ceil(winW), height: Math.ceil(winH) }).catch(() => {});

  // Report hitbox to Rust for click-through polling
  invoke("update_pet_hitbox", {
    hitbox: {
      width: rect.width,
      height: rect.height,
      offset_x: PET_WINDOW_PADDING,
      offset_y: PET_WINDOW_PADDING,
    },
  }).catch(() => {});
}

// ── 导出 ──
const filteredExportTables = computed(() => {
  const list = Array.isArray(tableOptions.value) ? tableOptions.value : [];
  const q = exportFilter.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (t) => t.table_name.toLowerCase().includes(q) || (t.table_comment || "").toLowerCase().includes(q)
  );
});

async function exportCurrentTable() {
  if (!tableView.tableName) return;
  const filePath = await save({
    defaultPath: `${tableView.tableName}.xlsx`,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (!filePath) return;
  exportLoading.value = true;
  try {
    const result = await invoke("export_tables_xlsx", {
      tables: [tableView.tableName],
      filePath,
    });
    showCopyToast(`导出完成：${result.totalRows} 行`, "success");
  } catch (e) {
    showCopyToast(`导出失败：${e}`, "error");
  } finally {
    exportLoading.value = false;
  }
}

function openBatchExport() {
  exportSelectedTables.clear();
  exportFilter.value = "";
  exportDialogOpen.value = true;
}

function toggleExportSelectAll() {
  const visible = filteredExportTables.value;
  const allSelected = visible.length > 0 && visible.every((t) => exportSelectedTables.has(t.table_name));
  if (allSelected) {
    visible.forEach((t) => exportSelectedTables.delete(t.table_name));
  } else {
    visible.forEach((t) => exportSelectedTables.add(t.table_name));
  }
}

async function doBatchExport() {
  if (exportSelectedTables.size === 0) return;
  const dirPath = await open({ directory: true, title: "选择导出目录" });
  if (!dirPath) return;
  exportLoading.value = true;
  try {
    const result = await invoke("export_tables_xlsx_batch", {
      tables: [...exportSelectedTables],
      dirPath,
    });
    showCopyToast(`导出完成：${result.tableCount} 张表，${result.totalRows} 行`, "success");
    exportDialogOpen.value = false;
  } catch (e) {
    showCopyToast(`导出失败：${e}`, "error");
  } finally {
    exportLoading.value = false;
  }
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

function copyRow(row) {
  if (!row || !tableView.columns.length) return;
  const text = tableView.columns.map(col => String(row[col.column_name] ?? '')).join('\t');
  copyText(text);
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

</script>

<template>
  <main
    v-if="isPanelWindow"
    :class="['app-shell', 'open', 'panel-shell', { 'reduced-transparency': reducedTransparencyEnabled }]"
    id="appShell"
    @contextmenu.prevent
  >
    <section
      class="widget widget--demo-shell"
      id="widget"
      :class="{
        'no-weather': !weatherEnabled,
        'is-weather-preview': weatherPreviewActive,
        'reduced-transparency': reducedTransparencyEnabled,
      }"
      :data-surface-tone="weatherPresentation.surfaceTone"
      :data-text-tone="weatherPresentation.textTone"
      :data-weather-skin="weatherSkinState.category"
      :style="panelChromeStyle"
    >
      <!-- Phase 1: Sky gradient background -->
      <div v-if="weatherEnabled" class="sky-background" :style="{ filter: skyBackgroundFilter }">
        <div class="sky-layer sky-dawn" :style="{ opacity: skyOpacities.dawn }"></div>
        <div class="sky-layer sky-day" :style="{ opacity: skyOpacities.day }"></div>
        <div class="sky-layer sky-dusk" :style="{ opacity: skyOpacities.dusk }"></div>
        <div class="sky-layer sky-night" :style="{ opacity: skyOpacities.night }"></div>
      </div>
      <!-- Phase 2: CSS weather effects layer -->
      <div v-if="weatherEnabled && weatherQuality === 'high'" class="weather-effects-layer">
        <!-- Sun -->
        <div v-if="showSun" class="weather-sun" :style="{ left: sunPosition.left, top: sunPosition.top, opacity: sunPosition.opacity }"></div>
        <!-- Stars -->
        <div v-for="s in starElements" :key="'star-'+s.id" class="weather-star" :style="{ left: s.left, top: s.top, width: s.size, height: s.size, animationDuration: s.animDuration }"></div>
        <!-- Clouds -->
        <div v-for="c in cloudElements" :key="'cloud-'+c.id" class="weather-cloud" :style="{ top: c.top, transform: 'scale('+c.scale+')', opacity: isNightTime ? c.opacity*0.5 : c.opacity, animationDuration: c.duration, animationDelay: c.delay }">
          <svg width="120" height="60" viewBox="0 0 120 60" fill="currentColor"><ellipse cx="60" cy="38" rx="55" ry="22"/><ellipse cx="36" cy="28" rx="30" ry="20"/><ellipse cx="80" cy="30" rx="28" ry="18"/><ellipse cx="56" cy="20" rx="24" ry="16"/></svg>
        </div>
        <!-- Rain drops -->
        <div v-for="r in rainDropElements" :key="'rain-'+r.id" :class="['weather-raindrop', r.heavy ? 'heavy' : 'light']" :style="{ left: r.left, animationDuration: r.duration, animationDelay: r.delay }"></div>
        <!-- Snow -->
        <div v-for="sn in snowElements" :key="'snow-'+sn.id" class="weather-snowflake" :style="{ left: sn.left, width: sn.size, height: sn.size, animationDuration: sn.duration, animationDelay: sn.delay, '--drift': sn.drift }"></div>
      </div>
      <!-- Canvas engine for low-quality mode -->
      <canvas v-if="weatherEnabled && weatherQuality === 'low'" ref="weatherCanvasRef" class="weather-canvas"></canvas>
      <header class="widget-header widget-header--demo" @pointerdown="panelHeaderPointerDown" @dblclick="panelToggleMaximize">
        <div class="traffic-lights" @dblclick.stop>
          <button class="traffic-btn traffic-red" title="隐藏窗口" @click="panelClose"></button>
          <button class="traffic-btn traffic-yellow" title="最小化" @click="panelMinimize"></button>
          <button class="traffic-btn traffic-green" title="最大化/还原" @click="panelToggleMaximize"></button>
        </div>
        <div class="title-drag"></div>
        <span class="window-title" @pointerdown.stop @dblclick.stop style="cursor:default">鹰捷v4.1</span>
        <button
          class="header-weather header-weather--action"
          :title="`${FIXED_WEATHER_CITY} ${weatherHeaderLabel} ${weatherTemp}°C`"
          @click="openSettings('appearance')"
        >
          <span class="header-weather-icon">{{ weatherHeaderIcon }}</span>
          <span class="header-weather-city">{{ FIXED_WEATHER_CITY }}</span>
          <span class="header-weather-temp">{{ weatherTemp }}°</span>
        </button>
        <div class="header-actions">
          <span :class="['db-status', { connected: dbConnected }]" id="dbStatusDot"></span>
          <span class="db-name" id="dbName">{{ dbConnected ? dbName : '未连接' }}</span>
          <button class="icon-btn icon-btn-subtle" title="设置" @click="openSettings()">⚙</button>
        </div>
      </header>

      <div v-if="dbConnected" class="panel-tab-strip-wrap">
        <section class="panel-tab-strip panel-tab-strip--demo" @click.self="closeAllOrgMenus" @wheel="onTableTabsWheel">
          <button class="panel-tab-chip panel-tab-chip-add" title="最近打开的表" @click.stop="toggleRecentTabsDropdown">
            <span :class="['recent-tabs-arrow', { open: recentTabsDropdownOpen }]">▾</span>
          </button>
          <button
            v-for="tab in panelTabs"
            :key="tab.key"
            :class="['panel-tab-chip', { active: tab.active, opened: tab.opened, starred: tab.starred }]"
            :title="tab.tableName"
            @click="activatePanelChromeTab(tab)"
          >
            <span v-if="tab.starred" class="panel-tab-chip-star">★</span>
            <span class="panel-tab-chip-label">{{ tab.tableName }}</span>
            <span v-if="tab.opened" class="panel-tab-chip-close" title="关闭标签" @click.stop="closePanelChromeTab(tab)">✕</span>
          </button>
        </section>
        <Transition name="recent-dropdown">
          <div v-if="recentTabsDropdownOpen" class="recent-tabs-dropdown" @click.stop>
            <div class="recent-tabs-header">
              <span>最近打开</span>
              <button class="recent-tabs-close" @click="recentTabsDropdownOpen = false">✕</button>
            </div>
            <div v-if="recentTables.length === 0" class="recent-tabs-empty">暂无最近打开的表</div>
            <template v-for="group in recentTablesGrouped" :key="group.folderName || '_ungrouped'">
              <div v-if="group.folderName" class="recent-tabs-group-header">{{ group.folderName }}</div>
              <button
                v-for="item in group.tables" :key="item.tableName"
                class="recent-tabs-item"
                @click="openOrActivateTableTab(item.tableName); recentTabsDropdownOpen = false"
              >
                <span v-if="starredTables.has(item.tableName)" class="recent-tabs-star">★</span>
                <span class="recent-tabs-name">{{ item.tableName }}</span>
                <span class="recent-tabs-comment">{{ item.tableComment || '' }}</span>
              </button>
            </template>
          </div>
        </Transition>
      </div>
      <div v-if="recentTabsDropdownOpen" class="recent-tabs-backdrop" @click="recentTabsDropdownOpen = false"></div>

      <div class="panel-content-viewport">
      <div class="panel-content-scale" :style="contentScaleStyle">
      <section class="search-panel search-panel--demo">
        <div class="search-composer">
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

      <!-- 表整理工具栏 -->
      <div v-if="dbConnected" class="org-toolbar org-toolbar--demo" @click.self="closeAllOrgMenus">
        <div class="org-folder-chips">
          <button :class="['org-chip', { active: activeFolder === 'all' }]" @click="activeFolder = 'all'; syncSummaryForDefaultTableBrowse()">全部</button>
          <button :class="['org-chip org-chip-star', { active: activeFolder === 'starred' }]" @click="activeFolder = 'starred'; syncSummaryForDefaultTableBrowse()">
            <span class="org-chip-icon">★</span>星标
          </button>
          <template v-for="folder in tableFolders" :key="folder.id">
            <button
              v-if="folderRenameId !== folder.id"
              :class="['org-chip', { active: activeFolder === folder.id }]"
              @click="activeFolder = folder.id; syncSummaryForDefaultTableBrowse()"
              @contextmenu.prevent.stop="openFolderCtxMenu($event, folder.id)"
            >
              <span class="org-chip-icon">📁</span>{{ folder.name }}
            </button>
            <input
              v-else
              class="org-chip-rename-input"
              v-model="folderRenameValue"
              @blur="commitFolderRename"
              @keydown.enter="commitFolderRename"
              @keydown.escape="folderRenameId = null"
              @vue:mounted="({ el }) => nextTick(() => el.focus())"
            />
          </template>
          <button class="org-chip org-chip-add" title="新建文件夹" @click="newFolderDialogOpen = true; newFolderName = ''">＋</button>
        </div>
        <div class="org-sort-wrap">
          <button class="org-sort-btn" @click.stop="toggleSortMenu" title="排序">
            <span class="org-sort-icon">↕</span>{{ sortLabel }}
          </button>
          <template v-if="sortMenuOpen">
            <div class="org-ctx-backdrop" @click="sortMenuOpen = false"></div>
            <div class="org-sort-menu">
              <button
                v-for="opt in SORT_OPTIONS" :key="opt.key"
                :class="['org-sort-option', { active: sortMode === opt.key }]"
                @click="selectSortMode(opt.key)"
              >
                {{ opt.label }}
                <span v-if="sortMode === opt.key" class="org-sort-check">✓</span>
              </button>
            </div>
          </template>
        </div>
      </div>

      <div class="results-layout" id="resultsWrap">
        <aside :class="['result-sidebar', { 'kb-zone': navZone === 'sidebar' }]">
          <div class="demo-sidebar-heading">Data Explorer</div>
          <button
            v-for="tab in resultTabs" :key="tab.key"
            :class="['sidebar-item sidebar-item--demo', { active: activeResultTab === tab.key }]"
            @click="activeResultTab = tab.key; navZone = 'sidebar'"
          >
            <span>{{ tab.label }}</span>
            <span class="sidebar-count" v-if="tab.count > 0">{{ tab.count }}</span>
          </button>
        </aside>

        <section class="results-main">
          <div class="list list-main">
            <template v-for="(item, idx) in filteredResults" :key="getResultKey(item)">
              <button
                v-if="item._type === 'table'"
                :id="`result-item-${idx}`"
                :class="['list-item demo-result-card', { 'kb-active': navZone === 'results' && navResultIndex === idx }]"
                @click="navZone = 'results'; navResultIndex = idx; openFromMeta(item)"
                @contextmenu="openItemCtxMenu($event, item.table_name)"
              >
                <span :class="['star-btn', { starred: starredTables.has(item.table_name) }]" @click.stop="toggleStar(item.table_name)" title="星标">{{ starredTables.has(item.table_name) ? '★' : '☆' }}</span>
                <div class="main" v-html="renderHighlighted(item.table_name)"></div>
                <div class="sub" v-html="renderHighlighted(getTableComment(item.table_name) || '-')"></div>
                <span
                  v-if="getTableFolderChip(item.table_name).visible"
                  :class="['badge', 'folder-badge', { 'is-uncategorized': getTableFolderChip(item.table_name).uncategorized }]"
                  :title="getTableFolderChip(item.table_name).title"
                >
                  <span class="folder-badge-label">{{ getTableFolderChip(item.table_name).label }}</span>
                  <span v-if="getTableFolderChip(item.table_name).extraCount > 0" class="folder-badge-more">+{{ getTableFolderChip(item.table_name).extraCount }}</span>
                </span>
                <span class="copy-icon-btn" @click.stop="copyText(item.table_name)" title="复制">⎘</span>
              </button>
              <button
                v-else-if="item._type === 'column'"
                :id="`result-item-${idx}`"
                :class="['list-item demo-result-card', { 'kb-active': navZone === 'results' && navResultIndex === idx }]"
                @click="navZone = 'results'; navResultIndex = idx; openFromMeta(item)"
                @contextmenu="openItemCtxMenu($event, item.table_name)"
              >
                <div class="main" v-html="`${item.table_name}.` + renderHighlighted(item.column_name || '')"></div>
                <span class="badge">FIELD</span>
                <span class="copy-icon-btn" @click.stop="copyText(item.column_name || item.table_name)" title="复制">⎘</span>
              </button>
              <button
                v-else-if="item._type === 'comment'"
                :id="`result-item-${idx}`"
                :class="['list-item demo-result-card', { 'kb-active': navZone === 'results' && navResultIndex === idx }]"
                @click="navZone = 'results'; navResultIndex = idx; openFromMeta(item)"
                @contextmenu="openItemCtxMenu($event, item.table_name)"
              >
                <div class="main">{{ item.table_name }}<span v-if="item.column_name">.{{ item.column_name }}</span></div>
                <div class="sub" v-html="renderHighlighted(item.matched_text)"></div>
                <span class="badge">{{ item.match_type === 'TableComment' ? '表备注' : '列备注' }}</span>
                <span class="copy-icon-btn" @click.stop="copyText(item.column_name || item.table_name)" title="复制">⎘</span>
              </button>
              <button
                v-else-if="item._type === 'data'"
                :id="`result-item-${idx}`"
                :class="['list-item demo-result-card', { 'kb-active': navZone === 'results' && navResultIndex === idx }]"
                @click="navZone = 'results'; navResultIndex = idx; openFromData(item)"
                @contextmenu="openItemCtxMenu($event, item.table_name)"
              >
                <div class="main">{{ item.table_name }}</div>
                <div class="sub" v-html="renderHighlighted(item.preview)"></div>
              </button>
            </template>
            <div v-if="filteredResults.length === 0 && !keyword.trim() && activeFolder !== 'all'" class="muted p-10">
              该文件夹为空
            </div>
            <div v-else-if="filteredResults.length === 0 && keyword.trim()" class="muted p-10">
              {{ activeResultTab === '数据值' ? '按回车搜索数据值' : '暂无结果' }}
            </div>
          </div>
        </section>
      </div>

      <!-- 右键菜单 -->
      <Teleport to="body">
        <div v-if="itemCtxOpen" class="org-ctx-backdrop" @click="closeItemCtxMenu" @contextmenu.prevent="closeItemCtxMenu"></div>
        <div v-if="itemCtxOpen" class="org-ctx-menu" :style="{ left: itemCtxPos.x + 'px', top: itemCtxPos.y + 'px' }">
          <button class="org-ctx-item" @click="toggleStar(itemCtxTableName); closeItemCtxMenu()">
            {{ starredTables.has(itemCtxTableName) ? '取消星标' : '添加星标' }}
          </button>
          <div class="org-ctx-divider"></div>
          <div class="org-ctx-item org-ctx-submenu-trigger" @mouseenter="itemCtxSubMenuOpen = true" @mouseleave="itemCtxSubMenuOpen = false">
            添加到文件夹 ▸
            <div v-if="itemCtxSubMenuOpen" class="org-ctx-submenu">
              <button v-for="folder in tableFolders" :key="folder.id" class="org-ctx-item" @click="handleItemCtxAddToFolder(folder.id)">
                <span class="org-ctx-folder-icon">📁</span>{{ folder.name }}
                <span v-if="isTableInFolder(itemCtxTableName, folder.id)" class="org-ctx-check">✓</span>
              </button>
              <div v-if="tableFolders.length > 0" class="org-ctx-divider"></div>
              <button class="org-ctx-item" @click="handleNewFolderFromCtx">＋ 新建文件夹</button>
            </div>
          </div>
          <button v-if="activeFolder !== 'all' && activeFolder !== 'starred'" class="org-ctx-item org-ctx-danger" @click="handleItemCtxRemoveFromFolder">
            从当前文件夹移除
          </button>
        </div>

        <!-- 文件夹右键菜单 -->
        <div v-if="folderCtxTarget" class="org-ctx-backdrop" @click="closeFolderCtxMenu" @contextmenu.prevent="closeFolderCtxMenu"></div>
        <div v-if="folderCtxTarget" class="org-ctx-menu" :style="{ left: folderCtxPos.x + 'px', top: folderCtxPos.y + 'px' }">
          <button class="org-ctx-item" @click="startFolderRename(folderCtxTarget)">重命名</button>
          <button class="org-ctx-item org-ctx-danger" @click="handleDeleteFolder(folderCtxTarget)">删除文件夹</button>
        </div>

        <!-- 新建文件夹对话框 -->
        <div v-if="newFolderDialogOpen" class="org-dialog-backdrop" @click="newFolderDialogOpen = false">
          <div class="org-dialog" @click.stop>
            <div class="org-dialog-title">新建文件夹</div>
            <input class="org-dialog-input" v-model="newFolderName" placeholder="文件夹名称" @keydown.enter="handleNewFolderConfirm" @vue:mounted="({ el }) => nextTick(() => el.focus())" />
            <div class="org-dialog-actions">
              <button class="org-dialog-btn" @click="newFolderDialogOpen = false">取消</button>
              <button class="org-dialog-btn org-dialog-btn-primary" @click="handleNewFolderConfirm" :disabled="!newFolderName.trim()">创建</button>
            </div>
          </div>
        </div>
      </Teleport>
      </div>
      </div>
      <div class="panel-footer panel-footer--demo">
        <div class="template-quick-switch template-quick-switch--demo">
          <button
            class="small-btn template-switch-btn"
            :disabled="templateSwitching || config.shared.db_templates.length === 0"
            title="上一模板"
            @click="switchTemplateByStep(-1)"
          >
            ◀
          </button>
          <span class="template-current-name">{{ activeTemplateName }}</span>
          <button
            class="small-btn template-switch-btn"
            :disabled="templateSwitching || config.shared.db_templates.length === 0"
            title="下一模板"
            @click="switchTemplateByStep(1)"
          >
            ▶
          </button>
        </div>
      </div>
    </section>
  </main>

  <div v-else-if="isPetWindow" class="pet-root">
    <div
      id="pet"
      class="pet pet-anchored"
      :style="petScaleStyle"
      role="button"
      aria-label="鹰捷"
      data-tauri-drag-region
      @click="togglePanel"
      @contextmenu="openContextMenu"
      @pointerdown="petPointerDown"
    >
      <template v-if="isSpriteSheetSkin">
        <div class="spritesheet-container">
          <div id="eagleSprite" class="spritesheet-sprite" :style="spriteSheetStyle"></div>
        </div>
      </template>
      <template v-else>
      <div class="eagle-container" :class="{ 'hd-container': isHdPetSkin }">
        <div id="eagleSprite" class="eagle-sprite" :class="[petSpriteClasses, `skin-${config.personal.pet_skin}`, { 'hd-skin': isHdPetSkin }]">
          <template v-if="isHdPetSkin">
            <div class="hd-pet" :class="`hd-${config.personal.pet_skin}`">
              <div class="hd-halo" v-if="config.personal.pet_skin === 'spirit'"></div>
              <div class="hd-orbit">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div class="hd-tail" v-if="config.personal.pet_skin === 'lion'">
                <div class="hd-tail-core"></div>
                <div class="hd-tail-tip"></div>
              </div>
              <div class="hd-sprout" v-if="config.personal.pet_skin === 'lion'"></div>
              <div class="hd-orb" v-if="config.personal.pet_skin === 'spirit'"></div>
              <div class="hd-body"></div>
              <div class="hd-arm hd-arm-left"></div>
              <div class="hd-arm hd-arm-right"></div>
              <div class="hd-leg hd-leg-left"></div>
              <div class="hd-leg hd-leg-right"></div>
              <div class="hd-face">
                <span class="hd-eye hd-eye-left"></span>
                <span class="hd-eye hd-eye-right"></span>
                <span class="hd-mouth"></span>
              </div>
            </div>
            <template v-if="petIdleActive && currentIdleState === 'sleep_zzz'">
              <div class="hd-zzz">z</div>
              <div class="hd-zzz">z</div>
            </template>
          </template>
          <template v-else>
            <div class="blink-overlay"></div>
            <template v-if="petIdleActive && currentIdleState === 'sleep_zzz'">
              <div class="pixel-zzz">z</div>
              <div class="pixel-zzz">z</div>
            </template>
          </template>
        </div>
        <div class="eagle-shadow"></div>
      </div>
      </template>
    </div>
  </div>

  <main v-else-if="isSyncWorkspaceWindow" class="sw-root" @contextmenu.prevent>
    <header class="sw-toolbar" @pointerdown="syncWorkspaceHeaderPointerDown">
      <div class="traffic-lights" @dblclick.stop @pointerdown.stop>
        <button class="traffic-btn traffic-red" title="关闭" @click="closeSyncWorkspaceWindow" />
        <button class="traffic-btn traffic-yellow" title="最小化" @click="syncWorkspaceMinimize" />
        <button class="traffic-btn traffic-green" title="最大化/还原" @click="syncWorkspaceToggleMaximize" />
      </div>
      <span class="sw-toolbar-title">一键同步工作台</span>
      <div class="sw-toolbar-actions">
        <button class="sw-toolbar-btn" title="新增配置" :disabled="syncWorkspaceRunning" @click="addSyncProfile">+</button>
        <button class="sw-toolbar-btn" title="设置" @click="openSyncSettings">⚙</button>
      </div>
    </header>

    <div class="sw-body">
      <nav class="sw-sidebar">
        <button
          v-for="profile in syncWorkspaceProfilesView"
          :key="profile.id"
          :class="['sw-sidebar-item', { selected: profile.id === syncWorkspaceActiveProfileId }]"
          @click="focusSyncProfile(profile.id)"
        >
          <span :class="['sw-sidebar-status-dot', `is-${syncWorkspaceRunning && syncWorkspaceRunProfileId === profile.id ? 'running' : (profile.last_run_status || 'idle')}`]"></span>
          <span class="sw-sidebar-label">{{ profile.name }}</span>
          <span v-if="profile.last_run_at" class="sw-sidebar-time">{{ formatSyncWorkspaceTimestamp(profile.last_run_at) }}</span>
        </button>
      </nav>

      <section v-if="activeSyncProfile" class="sw-content">
        <div class="sw-content-header">
          <h1 class="sw-profile-name">{{ activeSyncProfile.name }}</h1>
          <div class="sw-status-line">
            <span :class="['sw-status-badge', `is-${currentProfileStatusTone}`]">{{ currentProfileStatusText }}</span>
            <span v-if="activeSyncProfile.last_run_at">· {{ formatSyncWorkspaceTimestamp(activeSyncProfile.last_run_at) }}</span>
          </div>
        </div>

        <div class="sw-action-row">
          <button
            class="sw-run-btn"
            :disabled="!canRunSyncProfile(activeSyncProfile) || syncWorkspaceRunning"
            @click="runActiveSyncProfile"
          >
            {{ syncWorkspaceRunning && syncWorkspaceRunProfileId === activeSyncProfile.id ? '⏳ 同步中...' : '▶ 运行同步' }}
          </button>
          <button
            v-if="activeSyncProfile.target_path"
            class="sw-open-dir-btn"
            @click="openSyncTargetDir"
            title="在资源管理器中打开项目目标路径"
          >
            📂 打开目标目录
          </button>
        </div>

        <div v-if="syncWorkspaceMessage" :class="['sw-banner', `tone-${syncWorkspaceMessageTone}`]">
          {{ syncWorkspaceMessage }}
        </div>

        <div v-if="!canRunSyncProfile(activeSyncProfile) || syncContentEditing" class="sw-config-form">
          <div class="sw-config-form-title">配置路径</div>
          <div class="sw-config-field">
            <label>配置名称</label>
            <input v-model="activeSyncProfile.name" @input="markSyncWorkspaceDirty()" />
          </div>
          <div class="sw-config-field sw-config-path-row">
            <div>
              <label>脚本软件路径</label>
              <input v-model="activeSyncProfile.script_executable_path" @input="markSyncWorkspaceDirty()" />
            </div>
            <button @click="chooseSyncExecutable(activeSyncProfile.id)">浏览</button>
          </div>
          <div class="sw-config-field sw-config-path-row">
            <div>
              <label>脚本输出目录</label>
              <input v-model="activeSyncProfile.output_root" @input="markSyncWorkspaceDirty()" />
            </div>
            <button @click="chooseSyncDirectory(activeSyncProfile.id, 'output_root', '选择脚本输出目录')">浏览</button>
          </div>
          <div class="sw-config-field sw-config-path-row">
            <div>
              <label>项目目标路径</label>
              <input v-model="activeSyncProfile.target_path" @input="markSyncWorkspaceDirty()" />
            </div>
            <button @click="chooseSyncDirectory(activeSyncProfile.id, 'target_path', '选择项目目标路径')">浏览</button>
          </div>
          <button v-if="syncContentEditing" class="sw-config-form-close" @click="syncContentEditing = false">收起</button>
        </div>
        <button v-if="canRunSyncProfile(activeSyncProfile) && !syncContentEditing"
                class="sw-edit-toggle" @click="syncContentEditing = true">
          编辑配置
        </button>

        <div class="sw-pipeline">
          <div class="sw-pipeline-title">执行步骤</div>
          <ul class="sw-step-list">
            <li v-for="step in pipelineStepsView" :key="step.key" class="sw-step-item">
              <span :class="['sw-step-icon', `is-${step.status}`]">{{ step.icon }}</span>
              <span :class="['sw-step-label', { 'is-pending': step.status === 'pending' }]">{{ step.label }}</span>
              <span v-if="step.message" class="sw-step-msg" :title="step.message">{{ step.message }}</span>
              <span v-if="step.timeLabel" class="sw-step-time">{{ step.timeLabel }}</span>
            </li>
          </ul>
        </div>

        <details v-if="syncWorkspaceTimelineView.length > 0" class="sw-log-details">
          <summary>详细日志 ({{ syncWorkspaceTimelineView.length }})</summary>
          <ol class="sw-log-list-inner">
            <li v-for="entry in syncWorkspaceTimelineView" :key="entry.key" class="sw-log-entry">
              <div class="sw-log-entry-top">
                <span class="sw-log-entry-step">{{ entry.stepLabel }}</span>
                <span class="sw-log-entry-time">{{ entry.timeLabel }}</span>
                <span :class="['sw-log-entry-status', `is-${entry.statusTone}`]">{{ entry.statusText }}</span>
              </div>
              <div v-if="entry.message" class="sw-log-entry-msg">{{ entry.message }}</div>
              <div v-if="entry.command" class="sw-log-entry-cmd">{{ entry.command }}</div>
              <pre v-if="entry.detail" class="sw-log-entry-detail">{{ entry.detail }}</pre>
            </li>
          </ol>
        </details>
      </section>

      <section v-else class="sw-content">
        <div class="sw-empty">
          <div class="sw-empty-title">先创建一套配置</div>
          <div class="sw-empty-desc">每套配置保存三个路径，后续就能在这里一键执行，不用再手动找目录和更新 SVN。</div>
          <button class="sw-empty-btn" @click="addSyncProfile">创建第一套配置</button>
        </div>
      </section>
    </div>

    <!-- Settings Sheet -->
    <div v-if="syncSettingsOpen" class="sw-settings-overlay" @click.self="closeSyncSettings">
      <section class="sw-settings-sheet">
        <header class="sw-settings-header">
          <h2>同步工作台设置</h2>
          <button class="sw-toolbar-btn" @click="closeSyncSettings">✕</button>
        </header>

        <div class="sw-settings-body">
          <div class="sw-settings-section">
            <div class="sw-settings-section-title">快捷键</div>
            <div class="sw-settings-field">
              <span class="sw-settings-field-label">打开同步工作台</span>
              <input
                class="sw-settings-input"
                :value="syncWorkspaceHotkey"
                type="text"
                readonly
                :placeholder="syncWorkspaceHotkeyPlaceholder"
                @keydown="onSyncWorkspaceHotkeyInputKeydown"
              />
            </div>
          </div>

          <div class="sw-settings-section">
            <div class="sw-settings-section-title">配置管理</div>

            <div v-if="syncWorkspaceProfiles.length === 0" style="font-size: 13px; color: #86868B;">
              暂无配置，点击工具栏 + 按钮添加。
            </div>

            <div
              v-for="profile in syncWorkspaceProfiles"
              :key="profile.id"
              class="sw-settings-profile-item"
            >
              <button class="sw-settings-profile-row" @click="toggleSettingsProfileEdit(profile.id)">
                <span class="sw-settings-profile-name">
                  {{ profile.name }}
                  <span v-if="profile.id === syncWorkspaceDefaultProfileId" class="sw-default-pill">默认</span>
                </span>
                <span :class="['sw-settings-profile-chevron', { open: syncSettingsEditingProfileId === profile.id }]">▶</span>
              </button>

              <div v-if="syncSettingsEditingProfileId === profile.id" class="sw-settings-profile-edit">
                <div class="sw-settings-field">
                  <span class="sw-settings-field-label">配置名称</span>
                  <input
                    class="sw-settings-input"
                    v-model="profile.name"
                    type="text"
                    placeholder="例如：客户端导表"
                    @input="markSyncWorkspaceDirty()"
                  />
                </div>

                <div class="sw-settings-path-row">
                  <div class="sw-settings-field">
                    <span class="sw-settings-field-label">脚本软件路径</span>
                    <input
                      class="sw-settings-input"
                      v-model="profile.script_executable_path"
                      type="text"
                      placeholder="选择转表工具可执行程序"
                      @input="markSyncWorkspaceDirty()"
                    />
                  </div>
                  <button class="sw-settings-browse-btn" type="button" @click="chooseSyncExecutable(profile.id)">浏览</button>
                </div>

                <div class="sw-settings-path-row">
                  <div class="sw-settings-field">
                    <span class="sw-settings-field-label">脚本输出目录</span>
                    <input
                      class="sw-settings-input"
                      v-model="profile.output_root"
                      type="text"
                      placeholder="选择时间戳目录的根路径"
                      @input="markSyncWorkspaceDirty()"
                    />
                  </div>
                  <button class="sw-settings-browse-btn" type="button" @click="chooseSyncDirectory(profile.id, 'output_root', '选择脚本输出目录')">浏览</button>
                </div>

                <div class="sw-settings-path-row">
                  <div class="sw-settings-field">
                    <span class="sw-settings-field-label">项目目标路径</span>
                    <input
                      class="sw-settings-input"
                      v-model="profile.target_path"
                      type="text"
                      placeholder="选择 SVN 更新与文件同步目录"
                      @input="markSyncWorkspaceDirty()"
                    />
                  </div>
                  <button class="sw-settings-browse-btn" type="button" @click="chooseSyncDirectory(profile.id, 'target_path', '选择项目目标路径')">浏览</button>
                </div>

                <div class="sw-settings-profile-actions">
                  <button class="sw-settings-action-btn" :disabled="syncWorkspaceRunning" @click="setDefaultSyncProfile(profile.id)">
                    {{ profile.id === syncWorkspaceDefaultProfileId ? '已是默认' : '设为默认' }}
                  </button>
                  <button class="sw-settings-action-btn danger" :disabled="syncWorkspaceRunning" @click="removeSyncProfile(profile.id)">删除</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer class="sw-settings-footer">
          <button class="sw-settings-cancel-btn" @click="closeSyncSettings">取消</button>
          <button class="sw-settings-save-btn" :disabled="syncWorkspaceRunning" @click="saveSyncWorkspaceSettings(); closeSyncSettings()">保存</button>
        </footer>
      </section>
    </div>
  </main>

  <div v-else-if="isMenuWindow" class="pet-menu-root">
    <section :class="['pet-menu-window', { 'reduced-transparency': reducedTransparencyEnabled }]">
      <button class="pet-menu-btn" @click="contextAction('open')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 0 4.031 11.604l4.433 4.433 1.414-1.414-4.433-4.433A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0-9Z" fill="currentColor"/></svg>
        <span>打开搜索</span>
      </button>
      <button class="pet-menu-btn" @click="contextAction('sync')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l3.5 3.5-1.414 1.414L13 7.828V15h-2V7.828L9.914 8.914 8.5 7.5 12 4Zm0 16l-3.5-3.5 1.414-1.414L11 16.172V9h2v7.172l1.086-1.086 1.414 1.414L12 20Zm7-10h2v8a2 2 0 0 1-2 2h-4v-2h4v-8ZM3 6a2 2 0 0 1 2-2h4v2H5v8H3V6Z" fill="currentColor"/></svg>
        <span>文件同步</span>
      </button>
      <button class="pet-menu-btn" @click="contextAction('settings')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.036-.31.06-.62.06-.94s-.024-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.12 7.12 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 14.9 2h-3.8a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L3.7 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.046.31-.07.62-.07.94s.024.63.07.94L3.82 14.16a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.8a.5.5 0 0 0 .5-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" fill="currentColor"/></svg>
        <span>设置</span>
      </button>
      <button class="pet-menu-btn" @click="contextAction('hide_pet')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.75 4.5 5.25 19.5 20.25 18 21.75l-3.07-3.07A11.54 11.54 0 0 1 12 19.5C6.75 19.5 2.27 16.24.5 12c.91-2.17 2.49-4.05 4.5-5.45L3 6.75Zm6.31 6.31a3.75 3.75 0 0 0 5.63 1.63l-1.55-1.55a1.75 1.75 0 0 1-2.53-2.53l-1.55-1.55ZM12 4.5c5.25 0 9.73 3.26 11.5 7.5a12.12 12.12 0 0 1-3.88 4.87l-1.45-1.45A9.76 9.76 0 0 0 21.26 12C19.68 8.76 16.09 6.5 12 6.5c-1.1 0-2.17.16-3.18.46L7.2 5.34A11.8 11.8 0 0 1 12 4.5Zm-.07 3.01A4.5 4.5 0 0 1 16.43 12c0 .41-.06.81-.16 1.19l-4.3-4.31c.38-.1.78-.16 1.18-.16Z" fill="currentColor"/></svg>
        <span>隐藏宠物</span>
      </button>
      <hr />
      <button class="pet-menu-btn danger" @click="contextAction('exit')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v10h-2V3Zm1 18a9 9 0 0 1-6.364-15.364l1.414 1.414A7 7 0 1 0 16.95 7.05l1.414-1.414A9 9 0 0 1 12 21Z" fill="currentColor"/></svg>
        <span>退出程序</span>
      </button>
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
              <div class="sub" v-html="renderHighlighted(getTableComment(item.table_name) || '-')"></div>
              <span
                v-if="getTableFolderChip(item.table_name).visible"
                :class="['badge', 'folder-badge', { 'is-uncategorized': getTableFolderChip(item.table_name).uncategorized }]"
                :title="getTableFolderChip(item.table_name).title"
              >
                <span class="folder-badge-label">{{ getTableFolderChip(item.table_name).label }}</span>
                <span v-if="getTableFolderChip(item.table_name).extraCount > 0" class="folder-badge-more">+{{ getTableFolderChip(item.table_name).extraCount }}</span>
              </span>
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
            <button v-for="item in resultZoomItems" :key="`${item.table_name}-${item.row_index}-${item.column}`" class="list-item" @click="openFromData(item)">
              <div class="main">{{ item.table_name }}</div>
              <div class="sub" v-html="renderHighlighted(item.preview)"></div>
            </button>
          </template>
          <div v-if="resultZoomItems.length === 0" class="muted p-12">暂无结果</div>
        </div>
      </section>
    </section>
  </div>

  <div v-if="tableOpen" class="dialog-mask" @mousedown.self="closeTableDialog">
    <section ref="tableModalRef" :class="[
      'modal-card', 'wide', 'table-modal',
      { fullscreen: tableFullscreen },
      editGlowPhase !== 'none' ? `edit-glow-${editGlowPhase}` : '',
      { 'edit-mode-active': editMode },
      { 'reduced-transparency': reducedTransparencyEnabled },
    ]">
      <header class="modal-header" @pointerdown="modalHeaderPointerDown">
        <div class="modal-title-row">
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
          <button class="small-btn" @click="toggleTableFullscreen">{{ tableFullscreen ? '退出全屏' : '全屏查看' }}</button>
          <button :class="['small-btn', 'edit-toggle-btn', { active: editMode }]"
            :disabled="!dbConnected" @click="onEditToggleClick"
            :title="editMode ? '退出编辑模式' : '进入编辑模式'">
            {{ editMode ? '退出编辑(\`)' : '编辑(\`)' }}
          </button>
          <button class="icon-btn" @click="closeTableDialog">✕</button>
        </div>
      </header>
      <section ref="tableTabsRef" :class="['table-tabs', { 'is-compressed': tableTabsCompressed }]" @wheel="onTableTabsWheel">
        <button
          v-for="tab in tableTabs"
          :key="tab.id"
          :id="`table-tab-${tab.id}`"
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

      <div v-if="editMode && editNoPkWarningShown" class="edit-no-pk-warning">
        <span>⚠ 该表无主键，编辑操作将使用全列值匹配（LIMIT 1），请谨慎操作</span>
        <button class="small-btn" @click="editNoPkWarningShown = false">知道了</button>
      </div>

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
                    <th v-if="editMode" class="edit-checkbox-col">
                      <input type="checkbox" @change="toggleSelectAll"
                        :checked="editSelectedRows.size > 0 && editSelectedRows.size === tableView.rows.filter((r,i) => !isRowDeleted(r,i)).length" />
                    </th>
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
                      'edit-deleted': editMode && isRowDeleted(row, idx),
                      'edit-modified': editMode && isRowModified(row, idx),
                    }"
                    @contextmenu.prevent="copyRow(row)"
                  >
                    <td v-if="editMode" class="edit-checkbox-col">
                      <input type="checkbox"
                        :checked="editSelectedRows.has(computeRowKey(row, idx))"
                        :disabled="isRowDeleted(row, idx)"
                        @change="toggleRowSelection(idx)" />
                    </td>
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
                        'edit-cell-modified': editMode && isCellModified(row, idx, col.column_name),
                      }"
                      @click="editMode && startCellEdit(idx, col.column_name)"
                    >
                      <input v-if="editingCell.active && editingCell.rowIndex === idx && editingCell.columnName === col.column_name"
                        id="edit-cell-input"
                        class="edit-cell-input"
                        v-model="editingCell.currentValue"
                        @blur="confirmCellEdit"
                        @keydown="onCellEditKeydown"
                      />
                      <div v-else class="td-clip" v-html="renderDataCell(row, col.column_name)"></div>
                    </td>
                  </tr>
                  <!-- 新增行 -->
                  <tr v-for="(newRow, nIdx) in editChanges.inserts" :key="'new-'+nIdx" class="edit-new-row">
                    <td class="edit-checkbox-col">
                      <button class="edit-remove-insert-btn" @click="removeNewRow(nIdx)" title="移除">✕</button>
                    </td>
                    <td v-for="col in tableView.columns" :key="col.column_name"
                      :style="getColumnStyle(col.column_name)"
                      @click="startNewRowCellEdit(nIdx, col.column_name)"
                    >
                      <input v-if="editingCell.active && editingCell.rowIndex === (tableView.rows.length + nIdx) && editingCell.columnName === col.column_name"
                        id="edit-cell-input"
                        class="edit-cell-input"
                        v-model="editingCell.currentValue"
                        @blur="confirmNewRowCellEdit(nIdx)"
                        @keydown="onNewRowCellEditKeydown($event, nIdx)"
                      />
                      <div v-else class="td-clip">{{ newRow[col.column_name] || '' }}</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- 编辑模式底部工具栏 -->
            <div v-if="editMode" class="edit-toolbar">
              <div class="edit-toolbar-left">
                <button class="small-btn" @click="addNewRow">+ 添加行</button>
                <button class="small-btn danger" :disabled="editSelectedRows.size === 0"
                  @click="deleteSelectedRows">删除选中 ({{ editSelectedRows.size }})</button>
              </div>
              <div class="edit-toolbar-right">
                <span v-if="editDirty" class="edit-dirty-badge">
                  <span class="edit-dirty-dot"></span> {{ editSaveSummary.total }} 项未保存
                </span>
                <button class="primary-btn" :disabled="!editDirty" @click="openSaveDialog">保存更改</button>
              </div>
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

  <div v-if="settingsOpen" class="dialog-mask-v2" @click.self="closeSettings" @dragover.prevent @drop.prevent="onDropConfig">
    <section class="settings-modal-v2">
      <!-- Header -->
      <header class="settings-header-v2" @pointerdown="modalHeaderPointerDown">
        <div style="display:flex;align-items:center;gap:8px">
          <button v-if="settingsTab >= 0" class="settings-back-btn" @click="settingsTab = -1" title="返回">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7L9 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <h3>{{ settingsTab >= 0 ? SETTINGS_TABS[settingsTab].label : '设置' }}</h3>
        </div>
        <button class="icon-btn" @click="closeSettings">✕</button>
      </header>

      <!-- Entry Card Grid (when no tab selected) -->
      <div v-if="settingsTab === -1" class="settings-entry-grid">
        <div v-for="(tab, i) in SETTINGS_TABS" :key="tab.id" class="settings-entry-card" @click="switchSettingsTab(i)">
          <span class="entry-icon">{{ tab.icon }}</span>
          <span class="entry-title">{{ tab.label }}</span>
          <span v-if="tab.id === 'connection' && config.shared.db.host" class="entry-summary">{{ config.shared.db.host }}:{{ config.shared.db.port }}</span>
        </div>
      </div>

      <!-- Tab Content -->
      <div v-if="settingsTab >= 0" class="settings-body-v2 settings-detail-expand">
          <!-- Tab 0: 连接 -->
          <div v-if="settingsTab === 0" key="connection" class="settings-tab-pane">
            <div class="glass-card">
              <h4 class="glass-card-title">数据库连接 <span class="drop-hint">（可拖入 JSON 配置文件）</span></h4>
              <div class="glass-form-grid">
                <label class="glass-form-label">主机<input v-model="settingsDraft.host" type="text" class="glass-input" /></label>
                <label class="glass-form-label">端口<input v-model.number="settingsDraft.port" type="number" class="glass-input" /></label>
                <label class="glass-form-label">用户名<input v-model="settingsDraft.username" type="text" class="glass-input" /></label>
                <label class="glass-form-label">密码<input v-model="settingsDraft.password" type="password" class="glass-input" /></label>
                <label class="glass-form-label full">数据库<input v-model="settingsDraft.database" type="text" class="glass-input" /></label>
              </div>
            </div>
            <div class="glass-card">
              <h4 class="glass-card-title">数据库模板</h4>
              <div v-if="config.shared.db_templates.length > 0" style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px">
                <div v-for="(tpl, idx) in config.shared.db_templates" :key="idx" class="glass-template-item">
                  <span class="template-name">{{ tpl.name }}</span>
                  <span class="template-info">{{ tpl.db.host }}:{{ tpl.db.port }}/{{ tpl.db.database }}</span>
                  <button class="glass-btn-ghost" :disabled="templateSwitching" @click="switchToTemplate(idx)">
                    {{ templateSwitching && templateSwitchingIndex === idx ? "加载中..." : "加载" }}
                  </button>
                  <button class="glass-btn-danger" :disabled="templateSwitching" @click="deleteTemplate(idx)">删除</button>
                </div>
              </div>
              <div v-else class="muted" style="margin-bottom:6px">暂无模板</div>
              <div style="display:flex;gap:6px;align-items:center">
                <input v-model="settingsDraft.templateName" type="text" class="glass-input" placeholder="模板名称" style="flex:1" />
                <button class="glass-btn-secondary" :disabled="templateSwitching || !settingsDraft.templateName.trim()" @click="saveAsTemplate(settingsDraft.templateName); settingsDraft.templateName = ''">保存当前连接为模板</button>
              </div>
            </div>
          </div>

          <!-- Tab 1: 快捷键 -->
          <div v-else-if="settingsTab === 1" key="shortcuts" class="settings-tab-pane">
            <div class="glass-card">
              <h4 class="glass-card-title">快捷键</h4>
              <div class="glass-form-grid">
                <label class="glass-form-label">搜索快捷键<input v-model="settingsDraft.hotkey" type="text" class="glass-input" readonly :placeholder="hotkeyPlaceholder" @keydown="onHotkeyInputKeydown" /></label>
                <label class="glass-form-label">日期快捷键<input v-model="settingsDraft.quickDateHotkey" type="text" class="glass-input" readonly :placeholder="quickDateHotkeyPlaceholder" @keydown="onQuickDateHotkeyInputKeydown" /></label>
                <label class="glass-form-label">导出快捷键<input v-model="settingsDraft.exportHotkey" type="text" class="glass-input" readonly placeholder="Ctrl+E" @keydown="onDraftHotkeyInputKeydown($event, 'exportHotkey')" /></label>
                <label class="glass-form-label">批量导出快捷键<input v-model="settingsDraft.batchExportHotkey" type="text" class="glass-input" readonly placeholder="Ctrl+Shift+E" @keydown="onDraftHotkeyInputKeydown($event, 'batchExportHotkey')" /></label>
                <label class="glass-form-label">置顶快捷键<input v-model="settingsDraft.alwaysOnTopHotkey" type="text" class="glass-input" readonly placeholder="P" @keydown="onDraftHotkeyInputKeydown($event, 'alwaysOnTopHotkey')" /></label>
                <label class="glass-form-label">模板上一快捷键<input v-model="settingsDraft.templatePrevHotkey" type="text" class="glass-input" readonly placeholder="Ctrl+Alt+Left" @keydown="onDraftHotkeyInputKeydown($event, 'templatePrevHotkey')" /></label>
                <label class="glass-form-label">模板下一快捷键<input v-model="settingsDraft.templateNextHotkey" type="text" class="glass-input" readonly placeholder="Ctrl+Alt+Right" @keydown="onDraftHotkeyInputKeydown($event, 'templateNextHotkey')" /></label>
                <label class="glass-form-label">小窗口默认视图
                  <select v-model="settingsDraft.tableDefaultView" class="glass-select">
                    <option value="hits">Tab 页面（只看命中）</option>
                    <option value="full">正常页面</option>
                  </select>
                </label>
              </div>
            </div>
            <div class="glass-card">
              <h4 class="glass-card-title">系统</h4>
              <div style="display:flex;flex-direction:column;gap:12px">
                <label class="glass-toggle"><input v-model="settingsDraft.autoStart" type="checkbox" /><span class="glass-toggle-track"></span>开机自启</label>
                <label class="glass-toggle"><input v-model="settingsDraft.alwaysOnTop" type="checkbox" /><span class="glass-toggle-track"></span>窗口置顶</label>
                <label class="glass-toggle"><input v-model="settingsDraft.resetOnOpenToAllTables" type="checkbox" /><span class="glass-toggle-track"></span>打开窗口重置为全表</label>
              </div>
            </div>
          </div>

          <!-- Tab 2: 外观 -->
          <div v-else-if="settingsTab === 2" key="appearance" class="settings-tab-pane">
            <div class="glass-card glass-card-weather-control">
              <div class="settings-section-lead">
                <div>
                  <h4 class="glass-card-title">界面主题</h4>
                  <p class="settings-section-copy">{{ weatherEnabled ? '选择主题将关闭天气效果，恢复为普通面板。' : '切换界面主题和强调色。' }}</p>
                </div>
              </div>
              <div class="settings-theme-grid">
                <button
                  v-for="t in THEMES"
                  :key="t.id"
                  :class="['settings-theme-card', { active: preferredThemeId === t.id, 'weather-active': settingsDraft.weatherEnabled }]"
                  @click="applyTheme(t.id)"
                >
                  <span class="settings-theme-swatch" :style="{ background: t.color }"></span>
                  <span class="settings-theme-name">{{ t.name }}</span>
                </button>
              </div>
            </div>
            <div class="glass-card glass-card-weather-control">
              <div class="settings-section-lead">
                <div>
                  <h4 class="glass-card-title">背景透明度</h4>
                  <p class="settings-section-copy">统一控制标题栏、标签栏、筛选栏、侧栏和结果卡片的玻璃透明度。</p>
                </div>
              </div>
              <label class="glass-form-label">面板透明度 <span class="muted">{{ backgroundOpacityPercent }}</span>
                <input
                  v-model.number="settingsDraft.backgroundOpacity"
                  type="range"
                  class="glass-slider"
                  :min="panelChromeConstants.BACKGROUND_OPACITY_MIN"
                  :max="panelChromeConstants.BACKGROUND_OPACITY_MAX"
                  :step="panelChromeConstants.BACKGROUND_OPACITY_STEP"
                />
              </label>
              <label class="glass-toggle" style="margin-top:14px">
                <input v-model="settingsDraft.reduceTransparencyMode" type="checkbox" />
                <span class="glass-toggle-track"></span>降低界面透明度
              </label>
            </div>
            <div class="glass-card glass-card-weather-control">
              <div class="settings-section-lead">
                <div>
                  <h4 class="glass-card-title">天气皮肤</h4>
                  <p class="settings-section-copy">{{ settingsDraft.weatherEnabled ? '天气模式使用默认浅色主题，关闭后恢复 ' + preferredThemeName + '。' : '开启后面板将使用天气皮肤和默认浅色主题。' }}</p>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:14px">
                <label class="glass-toggle">
                  <input v-model="settingsDraft.weatherEnabled" type="checkbox" />
                  <span class="glass-toggle-track"></span>实时天气粒子效果
                </label>
                <div class="weather-preview-grid">
                  <button
                    v-for="item in WEATHER_PREVIEW_OPTIONS"
                    :key="item.id"
                    :class="['weather-preview-btn', { active: weatherPreviewCategory === item.id }]"
                    @click="applyPreviewWeather(item.id)"
                  >
                    <span class="weather-preview-btn-icon">{{ item.icon }}</span>
                    <span class="weather-preview-btn-label">{{ item.label }}</span>
                  </button>
                </div>
                <div class="weather-preview-time">
                  <span class="weather-preview-time-icon">🌙</span>
                  <input type="range" min="0" max="24" step="0.1" :value="skyEffectiveTime" @input="onSkyTimeSlider($event)" />
                  <span class="weather-preview-time-icon">☀️</span>
                  <span class="weather-preview-time-label">{{ Math.floor(skyEffectiveTime) }}:{{ String(Math.floor((skyEffectiveTime % 1) * 60)).padStart(2, '0') }}</span>
                </div>
                <div class="weather-preview-quality">
                  <button :class="['weather-preview-quality-btn', { active: weatherQuality === 'high' }]" @click="weatherQuality = 'high'">高画质</button>
                  <button :class="['weather-preview-quality-btn', { active: weatherQuality === 'low' }]" @click="switchToLowQuality">流畅</button>
                  <button class="weather-preview-reset-btn" @click="resetToRealWeather">恢复实时天气</button>
                </div>
                <div v-if="weatherText" class="weather-preview-note">
                  当前：{{ FIXED_WEATHER_CITY }} · {{ weatherText }} · {{ weatherTemp }}°C
                </div>
              </div>
            </div>
            <div class="glass-card">
              <h4 class="glass-card-title">宠物皮肤</h4>
              <div class="glass-form-grid">
                <label class="glass-form-label">皮肤
                  <select v-model="settingsDraft.petSkin" class="glass-select">
                    <option value="eagle">鹰（默认）</option>
                    <option value="cat">猫</option>
                    <option value="bunny">兔</option>
                    <option value="fox">狐狸</option>
                    <option value="panda">熊猫</option>
                    <option value="spirit">灵童（像素参考）</option>
                    <option value="lion">狮橙（像素参考）</option>
                    <option value="knight">骑士（Sprite Sheet）</option>
                    <optgroup v-if="customSkins.length" label="自定义皮肤">
                      <option v-for="cs in customSkins" :key="cs.id" :value="'custom:' + cs.id">
                        {{ cs.manifest.name }}
                      </option>
                    </optgroup>
                  </select>
                </label>
                <label class="glass-form-label" style="justify-content:flex-end">
                  <button class="glass-btn-secondary" @click="openSkinEditor()">皮肤编辑器</button>
                </label>
              </div>
              <div style="margin-top:12px">
                <label class="glass-form-label">宠物大小 <span class="muted">{{ Math.round(settingsDraft.petScale * 100) }}%</span>
                  <input type="range" class="glass-slider" :min="PET_SCALE_MIN" :max="PET_SCALE_MAX" :step="PET_SCALE_STEP" v-model.number="settingsDraft.petScale" />
                </label>
              </div>
            </div>
            <div class="glass-card">
              <h4 class="glass-card-title">待机状态</h4>
              <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
                <div v-for="st in availableIdleOptions" :key="st.value" class="glass-idle-item">
                  <label><input v-model="settingsDraft.idleStates" type="checkbox" :value="st.value" />{{ st.label }}</label>
                  <button class="idle-play-btn" title="播放预览" @click="previewIdleState(st.value)">▶</button>
                </div>
              </div>
            </div>
            <div class="glass-card">
              <h4 class="glass-card-title">字体</h4>
              <label class="glass-form-label">全局字体
                <select v-model="settingsDraft.customFont" class="glass-select">
                  <option :value="null">默认字体</option>
                  <option v-for="font in systemFonts" :key="font" :value="font">{{ font }}</option>
                </select>
              </label>
            </div>
          </div>
      </div>

      <!-- Footer -->
      <footer v-if="settingsTab >= 0" class="settings-footer-v2">
        <span v-if="settingsMsg" class="settings-msg" :class="{ ok: settingsMsg.startsWith('✓'), err: settingsMsg.startsWith('✗') }">{{ settingsMsg }}</span>
        <button v-show="settingsTab === 0" class="glass-btn-secondary" @click="triggerImport">导入共享配置</button>
        <button v-show="settingsTab === 0" class="glass-btn-secondary" @click="testConnect">测试连接</button>
        <button class="glass-btn-primary" @click="saveSettings">保存设置</button>
      </footer>
      <input id="importFile" class="hidden" type="file" accept="application/json" @change="onImportConfig" />
    </section>
  </div>

  <!-- 皮肤编辑器弹窗 -->
  <div v-if="skinEditorOpen" class="dialog-mask" @click.self="closeSkinEditor">
    <section class="modal-card skin-editor-modal">
      <header class="modal-header" @pointerdown="modalHeaderPointerDown">
        <h3>{{ skinEditorEditingId ? '编辑皮肤' : '创建自定义皮肤' }}</h3>
        <button class="icon-btn" @click="closeSkinEditor">✕</button>
      </header>
      <div class="modal-body" style="overflow-y:auto;max-height:560px;padding:12px 16px">
        <!-- Section 1: Name + Import -->
        <div class="form-group" style="margin-bottom:12px">
          <label>皮肤名称
            <input v-model="skinEditorName" type="text" placeholder="例如：我的骑士" style="width:100%" />
          </label>
        </div>
        <div class="form-group" style="margin-bottom:12px">
          <h4>导入 Sprite Sheet（PNG）</h4>
          <div class="skin-import-dropzone" @click="onSkinEditorFileSelect">
            <span v-if="skinEditorLoading">正在导入...</span>
            <span v-else>点击选择 PNG 文件（每个动画一张 Sprite Sheet）</span>
          </div>
        </div>

        <!-- Imported animations list -->
        <div v-if="skinEditorAnims.length" class="form-group" style="margin-bottom:12px">
          <h4>动画配置</h4>
          <div v-for="(anim, idx) in skinEditorAnims" :key="idx" class="skin-anim-row">
            <div class="skin-anim-preview">
              <canvas
                :ref="(el) => { if (el) { skinEditorCanvasRefs[idx] = el; nextTick(() => startSkinEditorPreview(el, anim)); } }"
                :width="anim.frameWidth"
                :height="anim.frameHeight"
                style="image-rendering:pixelated;max-width:96px;max-height:96px;border:1px solid var(--border);background:#1a1a2e"
              ></canvas>
            </div>
            <div class="skin-anim-inputs">
              <label>名称
                <input v-model="anim.name" type="text" style="width:100%" />
              </label>
              <label>帧宽
                <input v-model.number="anim.frameWidth" type="number" min="1" @change="anim.frameCount = Math.max(1, Math.floor(anim.width / anim.frameWidth))" />
              </label>
              <label>帧高
                <input v-model.number="anim.frameHeight" type="number" min="1" />
              </label>
              <label>帧数
                <input v-model.number="anim.frameCount" type="number" min="1" />
              </label>
              <label>FPS
                <input v-model.number="anim.fps" type="number" min="1" max="60" />
              </label>
              <div class="skin-anim-info">
                <span class="muted">{{ anim.width }}×{{ anim.height }}px · {{ anim.file }}</span>
                <button class="icon-btn" style="color:var(--red)" @click="removeSkinEditorAnim(idx)">✕</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 3: Action Binding -->
        <div v-if="skinEditorAnims.length" class="form-group" style="margin-bottom:12px">
          <h4>动作绑定</h4>
          <div class="form-grid">
            <label>默认待机
              <select v-model="skinEditorDefaultAnim">
                <option v-for="a in skinEditorAnims" :key="a.name" :value="a.name">{{ a.name }}</option>
              </select>
            </label>
            <label>搜索时播放
              <select v-model="skinEditorSearchAnim">
                <option v-for="a in skinEditorAnims" :key="a.name" :value="a.name">{{ a.name }}</option>
              </select>
            </label>
            <label>找到结果时
              <select v-model="skinEditorFoundAnim">
                <option v-for="a in skinEditorAnims" :key="a.name" :value="a.name">{{ a.name }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>
      <footer class="modal-footer" style="gap:8px">
        <span v-if="skinEditorMsg" class="settings-msg" :class="{ ok: skinEditorMsg.includes('成功'), err: skinEditorMsg.includes('失败') || skinEditorMsg.includes('请') }">{{ skinEditorMsg }}</span>
        <button v-if="skinEditorEditingId" class="small-btn" style="color:var(--red)" @click="deleteSkinFromEditor(skinEditorEditingId)">删除皮肤</button>
        <div style="flex:1"></div>
        <button class="small-btn" @click="closeSkinEditor">取消</button>
        <button class="primary-btn" :disabled="skinEditorLoading" @click="saveSkinEditor">保存皮肤</button>
      </footer>
    </section>
  </div>

  <!-- 日期密码验证弹窗 -->
  <div v-if="editDateDialogOpen" class="dialog-mask" @click.self="editDateDialogOpen = false">
    <section :class="['modal-card', 'edit-date-dialog', { shake: editDateError }]">
      <header class="modal-header">
        <h3>进入编辑模式</h3>
        <button class="icon-btn" @click="editDateDialogOpen = false">✕</button>
      </header>
      <div class="edit-date-body">
        <p>请输入当前日期以验证身份</p>
        <input id="edit-date-input" v-model="editDateInput" type="text"
          maxlength="8" placeholder="YYYYMMDD"
          :class="{ 'input-error': editDateError }"
          @keydown.enter="validateEditDate" />
        <p v-if="editDateError" class="edit-date-error-text">日期不正确，请重试</p>
      </div>
      <footer class="modal-footer">
        <button class="small-btn" @click="editDateDialogOpen = false">取消</button>
        <button class="primary-btn" @click="validateEditDate">确认</button>
      </footer>
    </section>
  </div>

  <!-- 保存确认弹窗 -->
  <div v-if="editSaveDialogOpen" class="dialog-mask" @click.self="editSaveDialogOpen = false">
    <section class="modal-card edit-save-dialog">
      <header class="modal-header">
        <h3>确认保存</h3>
        <button class="icon-btn" @click="editSaveDialogOpen = false">✕</button>
      </header>
      <div class="edit-save-body">
        <p>即将提交以下变更到 <strong>{{ tableView.tableName }}</strong>：</p>
        <ul class="edit-save-summary">
          <li v-if="editSaveSummary.inserts > 0">插入 <strong>{{ editSaveSummary.inserts }}</strong> 行</li>
          <li v-if="editSaveSummary.updates > 0">更新 <strong>{{ editSaveSummary.updates }}</strong> 行</li>
          <li v-if="editSaveSummary.deletes > 0">删除 <strong>{{ editSaveSummary.deletes }}</strong> 行</li>
        </ul>
        <p v-if="!hasTablePrimaryKey()" class="edit-save-warn">⚠ 该表无主键，操作将使用全列值匹配</p>
      </div>
      <footer class="modal-footer">
        <button class="small-btn" @click="editSaveDialogOpen = false">取消</button>
        <button class="primary-btn" @click="confirmSave">确认保存</button>
      </footer>
    </section>
  </div>

  <!-- 未保存更改警告弹窗 -->
  <div v-if="editUnsavedDialogOpen" class="dialog-mask" @click.self="editUnsavedDialogOpen = false">
    <section class="modal-card edit-unsaved-dialog">
      <header class="modal-header">
        <h3>未保存的更改</h3>
        <button class="icon-btn" @click="editUnsavedDialogOpen = false">✕</button>
      </header>
      <div class="edit-unsaved-body">
        <p>当前有 <strong>{{ editSaveSummary.total }}</strong> 项未保存的更改，离开将丢失这些修改。</p>
      </div>
      <footer class="modal-footer">
        <button class="small-btn" @click="editUnsavedDialogOpen = false">继续编辑</button>
        <button class="primary-btn danger" @click="discardAndProceed">放弃更改</button>
      </footer>
    </section>
  </div>

  <!-- 批量导出弹窗 -->
  <div v-if="exportDialogOpen" class="dialog-mask" @click.self="exportDialogOpen = false">
    <section class="modal-card export-dialog">
      <header class="modal-header">
        <h3>批量导出</h3>
        <button class="icon-btn" @click="exportDialogOpen = false">✕</button>
      </header>
      <div class="export-dialog-body">
        <input v-model="exportFilter" type="text" class="export-filter-input" placeholder="搜索表名或备注..." />
        <label class="export-select-all">
          <input type="checkbox"
            :checked="filteredExportTables.length > 0 && filteredExportTables.every(t => exportSelectedTables.has(t.table_name))"
            @change="toggleExportSelectAll" />
          全选 ({{ exportSelectedTables.size }}/{{ filteredExportTables.length }})
        </label>
        <div class="export-table-list">
          <label v-for="t in filteredExportTables" :key="t.table_name" class="export-table-item">
            <input type="checkbox" :checked="exportSelectedTables.has(t.table_name)"
              @change="exportSelectedTables.has(t.table_name) ? exportSelectedTables.delete(t.table_name) : exportSelectedTables.add(t.table_name)" />
            <span class="export-table-name">{{ t.table_name }}</span>
            <span v-if="t.table_comment" class="export-table-comment">{{ t.table_comment }}</span>
          </label>
        </div>
      </div>
      <footer class="modal-footer">
        <button class="small-btn" @click="exportDialogOpen = false">取消</button>
        <button class="primary-btn" :disabled="exportSelectedTables.size === 0 || exportLoading" @click="doBatchExport">
          {{ exportLoading ? '导出中...' : `导出 ${exportSelectedTables.size} 张表` }}
        </button>
      </footer>
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
