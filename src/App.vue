<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { ask, save, open } from "@tauri-apps/plugin-dialog";
import { check as checkForAppUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./styles.css";
import { resolveSettingsVersionLabel } from "./appIdentity.js";
import { APP_PACKAGE_VERSION } from "./appVersion.js";
import DbMigrationWorkspace from "./DbMigrationWorkspace.vue";
import {
  buildStartupWelcomeStrokeOrderGlyphs,
  normalizeStartupWelcomeMode,
  normalizeStartupWelcomeText,
} from "./startupWelcome.js";
import { WeatherEngine } from "./weatherEngine.js";
import {
  buildFavoritesMenuItems,
  buildPanelTabs,
  describeTableFolderChip,
  findHighlightRanges,
  getDefaultTableDialogState,
  getTableSortMeta,
  normalizeBackgroundOpacity,
  panelChromeConstants,
  rankTableSearchCandidates,
  resolvePanelActivatedFocusTarget,
  resolveTableDialogSurfaceMode,
  resolveNextTableSortMode,
  shouldClearArmedTableDialogShortcutAfterAction,
  shouldBypassEditableGuardForArmedTableDialogKey,
  resolveTableDialogKeyAction,
  shouldFocusPanelShellFromTitlebarPointerDown,
  shouldEnablePanelTabDrag,
  shouldShowTitlebarDbSwitcher,
  shouldShowPanelTabStrip,
  shouldUseReducedTransparencyMode,
} from "./panelChrome.js";
import {
  getWeatherPresentation,
  normalizeWeatherCategory,
  resolveWeatherSkinState,
  shouldRenderWeatherClouds,
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
import {
  normalizeSyncCenterMode,
  normalizeSyncCenterSidebarCollapsed,
  normalizeSyncCenterSidebarWidth,
  resolveSyncCenterSectionToggle,
  shouldShowSyncCenterLogDrawer,
} from "./syncCenter.js";
import {
  UPDATE_CHECK_TIMEOUT_MS,
  buildPendingUpdateAnnouncement,
  checkForUpdateWithRetry,
  normalizeUpdateAnnouncement,
  normalizeUpdateSettings,
  normalizeUpdateVersion,
  preserveOpaqueInstance,
  reduceUpdateDownloadProgress,
  resolvePostUpdateAnnouncement,
  shouldAutoRunStartupUpdateCheck,
  shouldOpenUpdateDialogForInstall,
  summarizeReleaseNotes,
} from "./updateManager.js";
import { runPetMenuAction } from "./petMenu.js";
import {
  buildCellViewerPreview,
  detectCellViewerLanguage,
  normalizeCellViewerLanguage,
} from "./cellViewer.js";
import hljs from "highlight.js/lib/core";
import {
  clearCollapsedColumnState,
  computeAutoCollapsedWidth,
  measureColumnHeaderTextWidth,
  shouldShowColumnCollapseBadge,
  toggleColumnCollapsedState,
} from "./columnCollapse.js";
import { matchTableFindEntry } from "./tableFind.js";
import {
  applyPersistedTableTabOrder,
  buildTableTabOrderStorageKey,
  moveTableTab,
  serializeTableTabOrder,
} from "./tableTabsOrder.js";
import {
  hasExceededTabDragThreshold,
  resolveTabStripDropIndex,
} from "./tableTabDrag.js";
import { resolveAdaptiveTablePageSize } from "./tableDialogLayout.js";
import {
  resolvePendingCellValue,
  setPendingCellChange,
} from "./tableEditChanges.js";
import { resolveEditNavigation } from "./tableEditNavigation.js";
import {
  classifyFocusKey,
  clampFocus,
  resolveFocusMove,
} from "./tableGridFocus.js";
import {
  applyTsvToRange,
  buildFillDownChanges,
  buildRangeTsv,
  enumerateRangeCells,
  expandRange,
  fillRangeValue,
  normalizeRange,
  parseClipboardTsv,
  rangeSize,
} from "./tableCellRange.js";
import { shouldStartCellTextEdit } from "./tableCellClickEdit.js";
import {
  buildBatchImportFileItems,
  describeTableDefaultViewLabel,
  summarizeBatchImportSelection,
  toggleTableDefaultView,
} from "./batchImport.js";
import {
  buildFocusKey,
  clampTextPanelHeight,
  resolveTextPanelLoad,
  shouldRouteTextPanelKeyToGrid,
} from "./tableTextPanel.js";
import {
  buildBatchCellChanges,
  buildSelectedRowsTsv,
  resolveRowSelection,
  resolveSelectAllRowKeys,
} from "./tableEditSelection.js";
import {
  normalizeQuickPasteEditorHtml,
  serializeQuickPasteEditorHtml,
} from "./quickPasteEditor.js";
import {
  QUICK_PASTE_CATEGORIES,
  getQuickPasteCategoryCount as countQuickPasteCategory,
  getQuickPasteSnippetKind,
  isQuickPasteImageSnippet,
  isQuickPasteMixedSnippet,
  isQuickPasteTextLikeSnippet,
} from "./quickPasteCategories.js";

const APP_VERSION = APP_PACKAGE_VERSION;
const VERSION_DISPLAY_LABEL = resolveSettingsVersionLabel(APP_VERSION);
const DEMO_FEATURE_TEST_TABLE = "demo_feature_test";
const DEMO_TABLE_OPTIONS = [
  { table_name: "demo_feature_test", table_comment: "离线功能测试演示表" },
  { table_name: "demo_customer_profiles", table_comment: "测试客户档案表：姓名、城市、会员等级、余额和标签" },
  { table_name: "demo_orders", table_comment: "测试订单表：订单状态、金额、渠道、收货城市" },
  { table_name: "demo_support_tickets", table_comment: "测试工单表：问题类型、优先级、处理人和摘要" },
  { table_name: "demo_audit_logs", table_comment: "测试审计日志表：操作人、动作、IP、JSON 明细" },
];

function createTabStripDragState() {
  return {
    pointerId: null,
    tabId: "",
    startX: 0,
    startY: 0,
    overTabId: "",
    insertAfter: false,
    dragging: false,
    didReorder: false,
  };
}

function measureTabStripItemWidth(
  itemEl,
  {
    labelSelector,
    closeSelector,
    minWidth = 132,
    maxWidth = 220,
    chromeWidth = 36,
    closeGap = 8,
  } = {},
) {
  if (!(itemEl instanceof HTMLElement)) return 0;
  const labelEl = itemEl.querySelector(labelSelector);
  const closeEl = closeSelector ? itemEl.querySelector(closeSelector) : null;
  const labelWidth = labelEl instanceof HTMLElement ? labelEl.scrollWidth : 0;
  const closeWidth = closeEl instanceof HTMLElement ? closeEl.offsetWidth + closeGap : 0;
  return Math.min(maxWidth, Math.max(minWidth, labelWidth + closeWidth + chromeWidth));
}

function createTabStripController({
  isEnabled = () => true,
  getItems = () => [],
  getId = (item) => item?.id,
  isItemDraggable = () => true,
  itemIdPrefix = "",
  draggableItemSelector = "",
  measureItemSelector = draggableItemSelector,
  labelSelector = "",
  closeSelector = "",
  addButtonSelector = "",
  gapWidth = 8,
  threshold = 6,
  measureItemWidth = (itemEl) =>
    measureTabStripItemWidth(itemEl, {
      labelSelector,
      closeSelector,
    }),
  onReorder = () => {},
  onReorderCommitted = () => {},
} = {}) {
  const wrapRef = ref(null);
  const compressed = ref(false);
  const drag = reactive(createTabStripDragState());
  const suppressClickUntil = ref(0);
  let measureRaf = 0;

  function detachDragListeners() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("blur", onPointerWindowBlur);
  }

  function clearDragState() {
    detachDragListeners();
    Object.assign(drag, createTabStripDragState());
  }

  function scrollItemIntoView(itemId, behavior = "smooth") {
    if (!itemId) return;
    nextTick(() => {
      const wrap = wrapRef.value;
      if (!(wrap instanceof HTMLElement)) return;
      const itemEl = document.getElementById(`${itemIdPrefix}${itemId}`);
      if (!(itemEl instanceof HTMLElement)) return;
      const wrapRect = wrap.getBoundingClientRect();
      const itemRect = itemEl.getBoundingClientRect();
      if (itemRect.left < wrapRect.left) {
        wrap.scrollBy({ left: itemRect.left - wrapRect.left - 8, behavior });
      } else if (itemRect.right > wrapRect.right) {
        wrap.scrollBy({ left: itemRect.right - wrapRect.right + 8, behavior });
      }
    });
  }

  function stopCompressionMeasure() {
    if (measureRaf) {
      cancelAnimationFrame(measureRaf);
      measureRaf = 0;
    }
    if (!isEnabled()) {
      compressed.value = false;
    }
  }

  function scheduleCompressionMeasure() {
    stopCompressionMeasure();
    if (!isEnabled()) {
      compressed.value = false;
      return;
    }
    measureRaf = requestAnimationFrame(() => {
      measureRaf = 0;
      const wrap = wrapRef.value;
      if (!(wrap instanceof HTMLElement)) {
        compressed.value = false;
        return;
      }

      const itemEls = [...wrap.querySelectorAll(measureItemSelector)].filter((item) => item instanceof HTMLElement);
      if (itemEls.length === 0) {
        compressed.value = false;
        return;
      }

      const addButton = addButtonSelector ? wrap.querySelector(addButtonSelector) : null;
      let desiredWidth = addButton instanceof HTMLElement ? addButton.offsetWidth : 0;

      itemEls.forEach((itemEl) => {
        desiredWidth += measureItemWidth(itemEl);
      });

      desiredWidth += Math.max(0, itemEls.length) * gapWidth;
      compressed.value = desiredWidth > wrap.clientWidth;
    });
  }

  function finalizeDrag() {
    const draggedId = drag.tabId;
    const shouldSuppressClick = drag.dragging;
    const moved = drag.didReorder;
    clearDragState();
    if (shouldSuppressClick) {
      suppressClickUntil.value = Date.now() + 180;
    }
    if (!moved) return;
    onReorderCommitted();
    scrollItemIntoView(draggedId, "smooth");
  }

  function onPointerWindowBlur() {
    finalizeDrag();
  }

  function onPointerUp(event) {
    if (
      drag.pointerId !== null &&
      event?.pointerId !== undefined &&
      event.pointerId !== drag.pointerId
    ) {
      return;
    }
    finalizeDrag();
  }

  function onPointerMove(event) {
    if (
      drag.pointerId === null ||
      event.pointerId !== drag.pointerId ||
      !drag.tabId
    ) {
      return;
    }

    if (!drag.dragging) {
      const thresholdExceeded = hasExceededTabDragThreshold({
        startX: drag.startX,
        startY: drag.startY,
        currentX: event.clientX,
        currentY: event.clientY,
        threshold,
      });
      if (!thresholdExceeded) return;
      drag.dragging = true;
    }

    event.preventDefault();
    const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(draggableItemSelector);
    if (!(hovered instanceof HTMLElement)) {
      drag.overTabId = "";
      return;
    }

    const hoveredItemId = String(hovered.dataset.tabId || "");
    if (!hoveredItemId || hoveredItemId === drag.tabId) {
      drag.overTabId = "";
      return;
    }

    const draggableItems = getItems().filter((item) => isItemDraggable(item));
    const rect = hovered.getBoundingClientRect();
    drag.overTabId = hoveredItemId;
    drag.insertAfter = event.clientX >= rect.left + rect.width / 2;

    const nextIndex = resolveTabStripDropIndex({
      items: draggableItems,
      draggedId: drag.tabId,
      hoveredId: hoveredItemId,
      pointerX: event.clientX,
      hoveredRect: rect,
      getId,
    });
    if (nextIndex < 0) return;

    const fromIndex = draggableItems.findIndex((item) => String(getId(item) || "") === drag.tabId);
    if (fromIndex < 0 || fromIndex === nextIndex) return;

    onReorder({ fromIndex, toIndex: nextIndex });
    drag.didReorder = true;
    scheduleCompressionMeasure();
  }

  function onPointerDown(event, itemId) {
    if (event.button !== 0 || !itemId || !isEnabled()) return;
    if (closeSelector && event.target?.closest?.(closeSelector)) return;
    clearDragState();
    drag.pointerId = event.pointerId;
    drag.tabId = String(itemId || "");
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    const currentTarget = event.currentTarget;
    if (currentTarget instanceof HTMLElement && typeof currentTarget.setPointerCapture === "function") {
      currentTarget.setPointerCapture(event.pointerId);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", onPointerWindowBlur, { once: true });
  }

  return {
    wrapRef,
    compressed,
    drag,
    suppressClickUntil,
    clearDragState,
    stopCompressionMeasure,
    scheduleCompressionMeasure,
    scrollItemIntoView,
    onPointerDown,
  };
}

const isTauriWindow = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
function getInitialWindowLabel() {
  if (!isTauriWindow) return "browser";
  try {
    return getCurrentWindow().label || "main";
  } catch {
    return "main";
  }
}
const windowLabel = ref(getInitialWindowLabel());

const isPetWindow = computed(() => isTauriWindow && windowLabel.value === "main");
const isWelcomeWindow = computed(() => isTauriWindow && windowLabel.value === "welcome");
const isUpdateAnnouncementWindow = computed(() => isTauriWindow && windowLabel.value === "update_announcement");
const isMenuWindow = computed(() => isTauriWindow && windowLabel.value === "pet_menu");
const isSyncWorkspaceWindow = computed(() => isTauriWindow && windowLabel.value === "sync_workspace");
const isDbMigrationWorkspaceWindow = computed(() =>
  isTauriWindow && windowLabel.value === "db_migration_workspace",
);
const isArtTextSearchWindow = computed(() => isTauriWindow && windowLabel.value === "art_text_search");
const isQuickPasteWindow = computed(() => isTauriWindow && windowLabel.value === "quick_paste");
const isPanelWindow = computed(() => !isTauriWindow || windowLabel.value === "browser" || windowLabel.value === "panel");
const FIXED_WEATHER_CITY = "厦门市";
const QUICK_PASTE_SIDEBAR_DEFAULT_WIDTH = 180;
const QUICK_PASTE_SIDEBAR_MIN_WIDTH = 168;
const QUICK_PASTE_SIDEBAR_MAX_WIDTH = 240;
const QUICK_PASTE_LIST_DEFAULT_WIDTH = 240;
const QUICK_PASTE_LIST_MIN_WIDTH = 240;
const QUICK_PASTE_PREVIEW_MIN_WIDTH = 320;

const quickPaste = reactive({
  loading: false,
  saving: false,
  error: "",
  query: "",
  activeCategory: "all",
  selectedId: "",
  editorOpen: false,
  editorMode: "create",
  sidebarWidth: QUICK_PASTE_SIDEBAR_DEFAULT_WIDTH,
  listWidth: QUICK_PASTE_LIST_DEFAULT_WIDTH,
  resizingPane: "",
  imagePreview: {
    visible: false,
    src: "",
    title: "",
  },
  toast: {
    visible: false,
    text: "",
    tone: "success",
    timer: null,
  },
  config: {
    enabled: true,
    openHotkey: "F7",
    outputHotkey: "F8",
    snippets: [],
  },
  draft: {
    id: "",
    title: "",
    content: "",
    category: "text",
    favorite: false,
    isDefault: false,
    createdAt: "",
    updatedAt: "",
    imageUrl: "",
  },
});

let quickPasteInlineSaveTimer = 0;
const quickPasteEditorHtml = ref("");
const quickPasteEditorRef = ref(null);

function normalizeQuickPasteSnippets(snippets) {
  return (Array.isArray(snippets) ? snippets : []).map((snippet) => ({
    id: String(snippet.id || ""),
    title: String(snippet.title || "未命名内容"),
    content: String(snippet.content || ""),
    image: String(snippet.image || ""),
    category: String(snippet.category || "text"),
    favorite: Boolean(snippet.favorite),
    isDefault: Boolean(snippet.is_default ?? snippet.isDefault),
    createdAt: snippet.created_at ?? snippet.createdAt ?? "",
    updatedAt: snippet.updated_at ?? snippet.updatedAt ?? "",
  }));
}

function toQuickPasteSnippetPayload(snippet) {
  return {
    id: snippet.id,
    title: snippet.title,
    content: snippet.content,
    image: snippet.image || "",
    category: snippet.category || "text",
    favorite: Boolean(snippet.favorite),
    is_default: Boolean(snippet.isDefault),
    created_at: snippet.createdAt || "",
    updated_at: snippet.updatedAt || "",
  };
}

const quickPasteCategories = computed(() => QUICK_PASTE_CATEGORIES);

function getQuickPasteCategoryCount(category) {
  return countQuickPasteCategory(quickPaste.config.snippets, category);
}

const filteredQuickPasteSnippets = computed(() => {
  const query = quickPaste.query.trim().toLowerCase();
  const filtered = quickPaste.config.snippets.filter((snippet) => {
    const matchesCategory =
      quickPaste.activeCategory === "all" ||
      (quickPaste.activeCategory === "favorite" && snippet.favorite) ||
      (quickPaste.activeCategory === "text" && isQuickPasteTextLikeSnippet(snippet)) ||
      (quickPaste.activeCategory === "mixed" && isQuickPasteMixedSnippet(snippet)) ||
      (quickPaste.activeCategory === "image" && isQuickPasteImageSnippet(snippet)) ||
      snippet.category === quickPaste.activeCategory;
    const matchesQuery =
      !query ||
      snippet.title.toLowerCase().includes(query) ||
      snippet.content.toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });
  // Sort: default snippet first, then rest in original order
  const def = filtered.filter((s) => s.isDefault);
  const rest = filtered.filter((s) => !s.isDefault);
  return [...def, ...rest];
});

const selectedQuickPasteSnippet = computed(() =>
  quickPaste.config.snippets.find((snippet) => snippet.id === quickPaste.selectedId) || null,
);

const quickPasteBodyStyle = computed(() => ({
  gridTemplateColumns: `${quickPaste.sidebarWidth}px 8px ${quickPaste.listWidth}px 8px minmax(${QUICK_PASTE_PREVIEW_MIN_WIDTH}px, 1fr)`,
}));

function getQuickPasteSnippetKindLabel(snippet) {
  const kind = getQuickPasteSnippetKind(snippet);
  if (kind === "mixed") return "图文";
  if (kind === "image") return "图片";
  return "文本";
}

async function closeQuickPasteWindow() {
  await invoke("hide_quick_paste_window");
}

async function minimizeQuickPasteWindow() {
  if (!isTauriWindow) return;
  await getCurrentWindow().minimize().catch(() => {});
}

async function toggleQuickPasteZoom() {
  if (!isTauriWindow) return;
  const appWindow = getCurrentWindow();
  const maximized = await appWindow.isMaximized().catch(() => false);
  if (maximized) await appWindow.unmaximize().catch(() => {});
  else await appWindow.maximize().catch(() => {});
}

function stopQuickPastePaneResize() {
  quickPaste.resizingPane = "";
  window.removeEventListener("pointermove", handleQuickPastePaneResize);
  window.removeEventListener("pointerup", stopQuickPastePaneResize);
  window.removeEventListener("pointercancel", stopQuickPastePaneResize);
}

function handleQuickPastePaneResize(event) {
  if (!quickPaste.resizingPane) return;
  const viewportWidth = window.innerWidth || 720;
  if (quickPaste.resizingPane === "sidebar") {
    quickPaste.sidebarWidth = Math.max(
      QUICK_PASTE_SIDEBAR_MIN_WIDTH,
      Math.min(QUICK_PASTE_SIDEBAR_MAX_WIDTH, event.clientX - 14),
    );
    return;
  }

  const listLeft = 14 + quickPaste.sidebarWidth + 8 + 12;
  const maxListWidth = Math.max(
    QUICK_PASTE_LIST_MIN_WIDTH,
    viewportWidth - listLeft - QUICK_PASTE_PREVIEW_MIN_WIDTH - 18,
  );
  quickPaste.listWidth = Math.max(QUICK_PASTE_LIST_MIN_WIDTH, Math.min(maxListWidth, event.clientX - listLeft));
}

function startQuickPastePaneResize(event, pane) {
  event.preventDefault();
  quickPaste.resizingPane = pane;
  window.addEventListener("pointermove", handleQuickPastePaneResize);
  window.addEventListener("pointerup", stopQuickPastePaneResize, { once: true });
  window.addEventListener("pointercancel", stopQuickPastePaneResize, { once: true });
}

async function loadQuickPasteConfig() {
  quickPaste.loading = true;
  quickPaste.error = "";
  try {
    const quickPasteConfig = await invoke("get_quick_paste_config");
    quickPaste.config.enabled = quickPasteConfig.enabled ?? true;
    quickPaste.config.openHotkey = quickPasteConfig.open_hotkey ?? quickPasteConfig.openHotkey ?? "F7";
    quickPaste.config.outputHotkey = quickPasteConfig.output_hotkey ?? quickPasteConfig.outputHotkey ?? "F8";
    quickPaste.config.snippets = normalizeQuickPasteSnippets(quickPasteConfig.snippets);
    if (!quickPaste.selectedId || !quickPaste.config.snippets.some((item) => item.id === quickPaste.selectedId)) {
      const defaultSnippet = quickPaste.config.snippets.find((item) => item.isDefault);
      quickPaste.selectedId = defaultSnippet?.id || quickPaste.config.snippets[0]?.id || "";
    }
    const selectedSnippet = quickPaste.config.snippets.find((item) => item.id === quickPaste.selectedId) || null;
    syncQuickPasteEditorHtml(selectedSnippet);
  } catch (error) {
    quickPaste.error = String(error);
  } finally {
    quickPaste.loading = false;
  }
}

function showQuickPasteToast(text, tone = "success") {
  quickPaste.toast.text = text;
  quickPaste.toast.tone = tone;
  quickPaste.toast.visible = true;
  if (quickPaste.toast.timer) clearTimeout(quickPaste.toast.timer);
  quickPaste.toast.timer = setTimeout(() => {
    quickPaste.toast.visible = false;
    quickPaste.toast.timer = null;
  }, 1800);
}

function openQuickPasteCreate() {
  upsertQuickPasteDraft({
    id: "",
    title: "新内容",
    content: "<p><br></p>",
    category: "rich",
    favorite: false,
    isDefault: false,
    createdAt: "",
    updatedAt: "",
  }).then(() => {
    quickPaste.activeCategory = "all";
    showQuickPasteToast("已新建，可直接编辑");
  }).catch((error) => showQuickPasteToast(String(error), "error"));
}

async function saveQuickPasteSnippet() {
  if (!quickPaste.draft.title.trim()) {
    showQuickPasteToast("请输入标题", "error");
    return;
  }
  if (!quickPaste.draft.content.trim() && quickPaste.draft.category !== "image" && quickPaste.draft.title.trim() !== "新内容") {
    showQuickPasteToast("请输入文本内容", "error");
    return;
  }
  if (quickPaste.draft.category === "image" && !quickPaste.draft.imageUrl && !quickPaste.draft.content.trim()) {
    showQuickPasteToast("请粘贴图片", "error");
    return;
  }
  quickPaste.saving = true;
  try {
    const draft = { ...quickPaste.draft };
    await upsertQuickPasteDraft(draft);
    quickPaste.editorOpen = false;
    showQuickPasteToast("已保存");
  } catch (error) {
    showQuickPasteToast(String(error), "error");
  } finally {
    quickPaste.saving = false;
  }
}

async function deleteQuickPasteSnippet(snippet) {
  if (!snippet?.id) return;
  try {
    const snippets = await invoke("delete_quick_paste_snippet", { id: snippet.id });
    quickPaste.config.snippets = normalizeQuickPasteSnippets(snippets);
    if (quickPaste.selectedId === snippet.id) {
      quickPaste.selectedId = quickPaste.config.snippets[0]?.id || "";
    }
    showQuickPasteToast("已删除");
  } catch (error) {
    showQuickPasteToast(String(error), "error");
  }
}

async function toggleQuickPasteFavorite(snippet) {
  if (!snippet) return;
  try {
    const snippets = await invoke("upsert_quick_paste_snippet", {
      snippet: toQuickPasteSnippetPayload({ ...snippet, favorite: !snippet.favorite }),
    });
    quickPaste.config.snippets = normalizeQuickPasteSnippets(snippets);
  } catch (error) {
    showQuickPasteToast(String(error), "error");
  }
}

async function setQuickPasteDefault(snippet) {
  if (!snippet?.id) return;
  try {
    const snippets = await invoke("set_default_quick_paste_snippet", { id: snippet.id });
    quickPaste.config.snippets = normalizeQuickPasteSnippets(snippets);
    showQuickPasteToast("已设为默认");
  } catch (error) {
    showQuickPasteToast(String(error), "error");
  }
}

async function copyQuickPasteSnippet(snippet) {
  if (!snippet?.content) {
    showQuickPasteToast("没有可复制的内容", "error");
    return false;
  }
  try {
    if (snippet.category === "rich") {
      const html = snippet.content;
      const text = html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      showQuickPasteToast("已复制内容");
      return true;
    }
    await navigator.clipboard.writeText(snippet.content);
    showQuickPasteToast("已复制内容");
    return true;
  } catch (error) {
    showQuickPasteToast(String(error), "error");
    return false;
  }
}

async function outputQuickPasteSnippet(snippet = selectedQuickPasteSnippet.value) {
  if (!snippet?.id) {
    showQuickPasteToast("请选择要输出的文本", "error");
    return;
  }
  try {
    await invoke("output_quick_paste_snippet", { id: snippet.id });
  } catch (error) {
    showQuickPasteToast(String(error), "error");
  }
}

function quickPasteImageSrc(snippet) {
  if (!isQuickPasteImageSnippet(snippet) || !snippet.content) return "";
  if (/^(data:|blob:|https?:)/i.test(snippet.content)) return snippet.content;
  return convertFileSrc(snippet.content);
}

function extractQuickPasteFirstImageSource(snippet) {
  const content = String(snippet?.content || "");
  if (!content) return "";
  if (snippet?.category === "image") return quickPasteImageSrc(snippet);
  const match = content.match(/<img\b[^>]*(?:data-path|src)=["']([^"']+)["'][^>]*>/i);
  return match ? resolveQuickPasteImageSrc(match[1]) : "";
}

function openQuickPasteImagePreview(src, title = "图片预览") {
  const resolved = resolveQuickPasteImageSrc(src);
  if (!resolved) return;
  quickPaste.imagePreview.src = resolved;
  quickPaste.imagePreview.title = title || "图片预览";
  quickPaste.imagePreview.visible = true;
}

function closeQuickPasteImagePreview() {
  quickPaste.imagePreview.visible = false;
  quickPaste.imagePreview.src = "";
  quickPaste.imagePreview.title = "";
}

function openQuickPasteSnippetImagePreview(snippet) {
  const src = extractQuickPasteFirstImageSource(snippet);
  if (!src) return false;
  openQuickPasteImagePreview(src, snippet?.title || "图片预览");
  return true;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

async function persistQuickPasteImage(dataUrl, title) {
  if (!String(dataUrl || "").startsWith("data:image/")) return dataUrl;
  return await invoke("save_quick_paste_image", {
    dataUrl,
    fileName: title || "clipboard-image",
  });
}

async function upsertQuickPasteDraft(draft) {
  if (draft.category === "image") {
    draft.content = await persistQuickPasteImage(draft.content, draft.title);
  }
  if (draft.image && draft.image.startsWith("data:image/")) {
    draft.image = await persistQuickPasteImage(draft.image, draft.title);
  }
  const snippets = await invoke("upsert_quick_paste_snippet", {
    snippet: toQuickPasteSnippetPayload(draft),
  });
  quickPaste.config.snippets = normalizeQuickPasteSnippets(snippets);
  const selected = quickPaste.config.snippets.find((item) => item.title === draft.title && item.content === draft.content);
  quickPaste.selectedId = draft.id || selected?.id || quickPaste.selectedId;
  return snippets;
}

function hasQuickPasteContent(snippet) {
  if (snippet?.category === "image") return Boolean(String(snippet?.content || "").trim());
  if (snippet?.category === "rich") {
    const html = String(snippet?.content || "");
    if (/<img\b/i.test(html)) return true;
    return html.replace(/<br\s*\/?\s*>/gi, "").replace(/<[^>]+>/g, "").trim().length > 0;
  }
  return Boolean(String(snippet?.content || "").trim());
}

function canSaveQuickPasteSnippet(next) {
  return !next?.id || hasQuickPasteContent(next);
}

async function saveQuickPasteInlineSnippet(snippet, patch = {}) {
  if (!snippet?.id) return;
  const next = { ...snippet, ...patch };
  if (!next.title.trim()) {
    showQuickPasteToast("请输入标题", "error");
    return;
  }
  if (!canSaveQuickPasteSnippet(next)) {
    showQuickPasteToast(next.category === "image" ? "请粘贴图片" : "请输入文本内容", "error");
    return;
  }
  try {
    await upsertQuickPasteDraft(next);
  } catch (error) {
    showQuickPasteToast(String(error), "error");
  }
}

function scheduleQuickPasteInlineSave(snippet, patch = {}) {
  if (quickPasteInlineSaveTimer) clearTimeout(quickPasteInlineSaveTimer);
  quickPasteInlineSaveTimer = setTimeout(() => {
    quickPasteInlineSaveTimer = 0;
    saveQuickPasteInlineSnippet(snippet, patch);
  }, 360);
}

function resolveQuickPasteImageSrc(path) {
  if (!path) return "";
  if (/^(data:|blob:|https?:|asset:)/i.test(path)) return path;
  return convertFileSrc(path);
}

function syncQuickPasteEditorHtml(snippet = selectedQuickPasteSnippet.value) {
  quickPasteEditorHtml.value = normalizeQuickPasteEditorHtml(snippet, {
    resolveImageSrc: resolveQuickPasteImageSrc,
  });
}

function serializeCurrentQuickPasteEditorHtml() {
  const editor = quickPasteEditorRef.value;
  const html = editor instanceof HTMLElement ? editor.innerHTML : quickPasteEditorHtml.value;
  return serializeQuickPasteEditorHtml(html);
}

function saveQuickPasteEditorHtml(snippet = selectedQuickPasteSnippet.value) {
  if (!snippet?.id) return;
  normalizeQuickPasteEditorDomStyles();
  const html = serializeCurrentQuickPasteEditorHtml();
  snippet.content = html;
  snippet.category = "rich";
  saveQuickPasteInlineSnippet(snippet, { content: html, category: "rich" });
}

function updateQuickPasteEditorHtml(snippet = selectedQuickPasteSnippet.value) {
  if (!snippet?.id) return;
  normalizeQuickPasteEditorDomStyles();
  const html = serializeCurrentQuickPasteEditorHtml();
  snippet.content = html;
  snippet.category = "rich";
  scheduleQuickPasteInlineSave(snippet, { content: html, category: "rich" });
}

function focusQuickPasteEditorAfter(node) {
  nextTick(() => {
    const editor = quickPasteEditorRef.value;
    if (!(editor instanceof HTMLElement)) return;
    editor.focus();
    const selection = window.getSelection?.();
    if (!selection) return;
    const range = document.createRange();
    if (node?.parentNode) {
      range.setStartAfter(node);
    } else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

function insertImageIntoQuickPasteEditor(imagePath, imageSrc, alt = "图片") {
  const editor = quickPasteEditorRef.value;
  if (!(editor instanceof HTMLElement)) return null;
  editor.focus();

  const image = document.createElement("img");
  image.src = imageSrc;
  image.dataset.path = imagePath;
  image.alt = alt || "图片";

  const imageParagraph = document.createElement("p");
  imageParagraph.appendChild(image);
  const trailingParagraph = document.createElement("p");
  trailingParagraph.appendChild(document.createElement("br"));

  const selection = window.getSelection?.();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range && editor.contains(range.commonAncestorContainer)) {
    range.deleteContents();
    range.insertNode(trailingParagraph);
    range.insertNode(imageParagraph);
  } else {
    editor.appendChild(imageParagraph);
    editor.appendChild(trailingParagraph);
  }

  focusQuickPasteEditorAfter(imageParagraph);
  return imageParagraph;
}

function normalizeQuickPasteEditorDomStyles() {
  const editor = quickPasteEditorRef.value;
  if (!(editor instanceof HTMLElement)) return;
  editor.querySelectorAll("[style]").forEach((node) => node.removeAttribute("style"));
  editor.querySelectorAll("font[color]").forEach((node) => node.removeAttribute("color"));
}

function insertPlainTextIntoQuickPasteEditor(text) {
  const editor = quickPasteEditorRef.value;
  if (!(editor instanceof HTMLElement)) return false;
  const value = String(text || "");
  if (!value) return false;
  editor.focus();

  const fragment = document.createDocumentFragment();
  const lines = value.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (index > 0) fragment.appendChild(document.createElement("br"));
    fragment.appendChild(document.createTextNode(line));
  });

  const selection = window.getSelection?.();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range && editor.contains(range.commonAncestorContainer)) {
    range.deleteContents();
    range.insertNode(fragment);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    editor.appendChild(fragment);
  }
  return true;
}

async function handleQuickPasteEditorContextMenu(event) {
  const target = event.target instanceof Element ? event.target : null;
  const image = target?.closest?.("img");
  if (!image) return;
  event.preventDefault();
  event.stopPropagation();
  await openQuickPasteImagePath(
    image.dataset.path || image.getAttribute("data-path") || image.getAttribute("src"),
  );
}

function handleQuickPasteEditorDoubleClick(event) {
  if (event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  const image = target?.closest?.("img");
  if (!image) return;
  event.preventDefault();
  event.stopPropagation();
  openQuickPasteImagePreview(
    image.dataset.path || image.getAttribute("data-path") || image.getAttribute("src"),
    image.getAttribute("alt") || selectedQuickPasteSnippet.value?.title || "图片预览",
  );
}

async function handleQuickPasteEditorPaste(event) {
  const snippet = selectedQuickPasteSnippet.value;
  if (!snippet?.id) return;
  const files = Array.from(event.clipboardData?.files || []);
  const image = files.find((file) => file.type.startsWith("image/"));
  if (!image) {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    insertPlainTextIntoQuickPasteEditor(text);
    updateQuickPasteEditorHtml(snippet);
    return;
  }

  try {
    event.preventDefault();
    event.stopPropagation();
    const dataUrl = await fileToDataUrl(image);
    const imagePath = await persistQuickPasteImage(dataUrl, image.name || snippet.title || "clipboard-image");
    insertImageIntoQuickPasteEditor(imagePath, resolveQuickPasteImageSrc(imagePath), image.name || "图片");
    const html = serializeCurrentQuickPasteEditorHtml();
    snippet.content = html;
    snippet.category = "rich";
    await saveQuickPasteInlineSnippet(snippet, { content: html, category: "rich" });
    showQuickPasteToast("已插入图片");
  } catch (error) {
    showQuickPasteToast(String(error), "error");
  }
}

async function createQuickPasteImageFromFile(file) {
  if (!file?.type?.startsWith("image/")) return false;
  const dataUrl = await fileToDataUrl(file);
  const title = file.name || `剪贴板图片-${new Date().toLocaleTimeString()}`;
  await upsertQuickPasteDraft({
    id: "",
    title,
    content: dataUrl,
    category: "image",
    favorite: false,
    isDefault: false,
    createdAt: "",
    updatedAt: "",
  });
  quickPaste.activeCategory = "all";
  showQuickPasteToast("已保存图片");
  return true;
}

async function createQuickPasteTextFromClipboard(text) {
  const content = text.trim();
  if (!content) return false;
  await upsertQuickPasteDraft({
    id: "",
    title: content.slice(0, 24) || "剪贴板文本",
    content,
    category: "text",
    favorite: false,
    isDefault: false,
    createdAt: "",
    updatedAt: "",
  });
  quickPaste.activeCategory = "all";
  showQuickPasteToast("已保存文本");
  return true;
}

async function setQuickPasteDraftImage(file) {
  if (!file?.type?.startsWith("image/")) return false;
  quickPaste.draft.category = "image";
  quickPaste.draft.content = await fileToDataUrl(file);
  quickPaste.draft.imageUrl = quickPaste.draft.content;
  if (!quickPaste.draft.title.trim()) quickPaste.draft.title = file.name || "剪贴板图片";
  return true;
}

async function handleQuickPastePaste(event) {
  const tag = event.target?.tagName?.toLowerCase();
  const isTyping = tag === "input" || tag === "textarea" || event.target?.isContentEditable;
  const files = Array.from(event.clipboardData?.files || []);
  const image = files.find((file) => file.type.startsWith("image/"));

  if (isTyping) return;

  const text = event.clipboardData?.getData("text/plain") || "";
  try {
    if (quickPaste.editorOpen) {
      if (image && await setQuickPasteDraftImage(image)) {
        event.preventDefault();
        showQuickPasteToast("已粘贴图片");
      }
      return;
    }
    if (image && await createQuickPasteImageFromFile(image)) {
      event.preventDefault();
      return;
    }
    if (text.trim() && await createQuickPasteTextFromClipboard(text)) {
      event.preventDefault();
    }
  } catch (error) {
    showQuickPasteToast(String(error), "error");
  }
}


async function handleQuickPasteContextMenu(event) {
  const tag = event.target?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;
  event.preventDefault();
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (imageType) {
        const blob = await item.getType(imageType);
        await createQuickPasteImageFromFile(new File([blob], `剪贴板图片-${Date.now()}.png`, { type: imageType }));
        return;
      }
    }
    const text = await navigator.clipboard.readText();
    if (await createQuickPasteTextFromClipboard(text)) return;
    showQuickPasteToast("剪贴板没有可保存的内容", "error");
  } catch (error) {
    showQuickPasteToast("请用 Ctrl+V 粘贴保存", "error");
  }
}

async function openQuickPasteImagePath(path) {
  let content = String(path || "");
  if (!content) return;
  if (content.startsWith("data:")) {
    showQuickPasteToast("剪贴板图片未保存到本地", "error");
    return;
  }
  if (content.startsWith("file://")) {
    try {
      content = decodeURIComponent(new URL(content).pathname).replace(/^\//, "");
    } catch {
      content = content.replace(/^file:\/\//, "");
    }
  }
  try {
    await invoke("open_file_in_explorer", { path: content });
  } catch (error) {
    showQuickPasteToast(String(error), "error");
  }
}

async function openImageFileLocation(snippet) {
  if (!isQuickPasteImageSnippet(snippet)) return;
  await openQuickPasteImagePath(snippet?.content);
}

async function copyQuickPasteImage(snippet) {
  if (!snippet?.content) {
    showQuickPasteToast("没有可复制的图片", "error");
    return false;
  }
  try {
    const response = await fetch(quickPasteImageSrc(snippet));
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    showQuickPasteToast("已复制图片");
    return true;
  } catch (error) {
    showQuickPasteToast(`复制图片失败: ${String(error)}`, "error");
    return false;
  }
}

async function outputOrCopyQuickPasteSnippet(snippet = selectedQuickPasteSnippet.value) {
  if (isQuickPasteImageSnippet(snippet)) {
    openQuickPasteSnippetImagePreview(snippet);
    return;
  }
  if (!snippet?.id) {
    showQuickPasteToast("请选择要输出的文本", "error");
    return;
  }
  try {
    await invoke("output_quick_paste_snippet", { id: snippet.id });
  } catch (error) {
    await copyQuickPasteSnippet(snippet);
  }
}

function moveQuickPasteSelection(delta) {
  const items = filteredQuickPasteSnippets.value;
  if (!items.length) return;
  const currentIndex = items.findIndex((item) => item.id === quickPaste.selectedId);
  const nextIndex = currentIndex < 0 ? 0 : Math.max(0, Math.min(items.length - 1, currentIndex + delta));
  quickPaste.selectedId = items[nextIndex].id;
}

async function handleQuickPasteKeydown(event) {
  const tag = event.target?.tagName?.toLowerCase();
  const isTyping = tag === "input" || tag === "textarea" || event.target?.isContentEditable;
  if (event.key === "Escape") {
    event.preventDefault();
    if (quickPaste.imagePreview.visible) closeQuickPasteImagePreview();
    else if (quickPaste.editorOpen) quickPaste.editorOpen = false;
    else await invoke("hide_quick_paste_window");
    return;
  }
  if (!isTyping && event.key === "Enter") {
    event.preventDefault();
    await outputOrCopyQuickPasteSnippet();
    return;
  }
  if (!isTyping && event.key === "ArrowDown") {
    event.preventDefault();
    moveQuickPasteSelection(1);
  }
  if (!isTyping && event.key === "ArrowUp") {
    event.preventDefault();
    moveQuickPasteSelection(-1);
  }
}


const settingsTab = ref(-1);
const settingsOpen = ref(false);
const SETTINGS_TABS = [
  { id: 'connection', label: '连接', icon: '\u{1F5C4}' },
  { id: 'shortcuts',  label: '快捷键', icon: '\u2328' },
  { id: 'appearance', label: '外观', icon: '\u{1F3A8}' },
  { id: 'version', label: '版本号', icon: VERSION_DISPLAY_LABEL },
];
const PANEL_SHORTCUT_GROUPS = [
  {
    id: "panelNavigation",
    label: "搜索面板",
    items: [
      { id: "openTableCommand", label: "打开表命令面板", defaultValue: "Ctrl+P" },
      { id: "focusSidebar", label: "焦点到分类栏", defaultValue: "Ctrl+Left" },
      { id: "focusResults", label: "焦点到结果区", defaultValue: "Ctrl+Right" },
      { id: "moveUp", label: "上移选择", defaultValue: "Ctrl+Up" },
      { id: "moveDown", label: "下移选择", defaultValue: "Ctrl+Down" },
    ],
  },
  {
    id: "tableNavigation",
    label: "表窗口",
    items: [
      { id: "openTableFind", label: "打开表内查找", defaultValue: "Ctrl+O" },
      { id: "previousSearchTable", label: "上一张命中表", defaultValue: "Ctrl+[" },
      { id: "nextSearchTable", label: "下一张命中表", defaultValue: "Ctrl+]" },
      { id: "previousTab", label: "上一个已打开标签", defaultValue: "Ctrl+Shift+Tab" },
      { id: "nextTab", label: "下一个已打开标签", defaultValue: "Ctrl+Tab" },
      { id: "scrollTableLeft", label: "表格向左滚动", defaultValue: "Ctrl+Left" },
      { id: "scrollTableRight", label: "表格向右滚动", defaultValue: "Ctrl+Right" },
      { id: "toggleTableView", label: "切换命中/完整视图", defaultValue: "Tab" },
      { id: "jumpPreviousHit", label: "上一条命中", defaultValue: "Q" },
      { id: "jumpNextHit", label: "下一条命中", defaultValue: "E" },
      { id: "toggleEditMode", label: "切换编辑模式", defaultValue: "`" },
      { id: "toggleFullscreen", label: "全屏查看表", defaultValue: "W" },
      { id: "closeTable", label: "关闭当前表", defaultValue: "Ctrl+W" },
      { id: "closeAllTables", label: "关闭全部表", defaultValue: "Alt+W" },
    ],
  },
  {
    id: "editing",
    label: "编辑模式",
    items: [
      { id: "editSelectAll", label: "选择当前页全部行", defaultValue: "Ctrl+A" },
      { id: "editCopySelected", label: "复制选中行", defaultValue: "Ctrl+C" },
      { id: "editSave", label: "保存编辑更改", defaultValue: "Ctrl+S" },
      { id: "cellViewerSave", label: "保存单元格查看器", defaultValue: "Ctrl+S" },
    ],
  },
];
const PANEL_SHORTCUT_DEFAULTS = Object.fromEntries(
  PANEL_SHORTCUT_GROUPS.flatMap((group) =>
    group.items.map((item) => [item.id, item.defaultValue]),
  ),
);
const TABLE_DIALOG_DEFAULTS = getDefaultTableDialogState();
const tableOpen = ref(false);
const tableDetailView = ref("hits");
const tableFullscreen = ref(TABLE_DIALOG_DEFAULTS.fullscreen);
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
// Use ref(new Set()) + whole-set replacement so template bindings like
// :checked="editSelectedRows.has(...)" always see a fresh value. Mutating a
// reactive Set via .clear()+.add() can cause the :checked binding to miss
// updates between the clear and the add, leaving the checkbox visually out
// of sync. See docs/plans/实现计划 — Navicat 风格编辑模式升级.md#bug.
const editSelectedRows = ref(new Set())
const editSelectionAnchorIndex = ref(-1)
const editBatchColumn = ref("")
const editBatchValue = ref("")
const editingCell = reactive({ active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
const editNoPkWarningShown = ref(false)
const editSaveDialogOpen = ref(false)
const editUnsavedDialogOpen = ref(false)
const editUnsavedCallback = ref(null)
const editDateSuccessCallback = ref(null)
let editGlowTimer = null

// ── 编辑模式：网格焦点 + 矩形选区 ──
// gridFocus:  active focus cell (null when no focus). rowKind is "page" for
//             existing rows and "insert" for pending new rows.
// gridRange:  rectangular selection pinned to a single rowKind. anchor is the
//             fixed corner, head is the moving corner. null when there is no
//             multi-cell selection.
const gridFocus = reactive({ rowKind: null, rowIndex: -1, columnName: "" })
const gridRange = reactive({ anchor: null, head: null })
// Set when the user is mid-drag (mousedown on a cell) so that mouseenter on
// neighbour cells extends the range without requiring a modifier key.
let gridRangeDragging = false
let gridPointerDownStartedFocused = false
let gridPointerMovedDuringClick = false
let gridPointerDownTargetIsInput = false
// Multi-cell overwrite accumulation: when the user starts typing with a range
// of 2+ cells selected, each successive printable char / Backspace rewrites
// every cell in the range to the evolving buffer. Cleared when focus moves,
// range changes, Enter/Esc/Tab are pressed, or the user clicks anywhere.
const gridTypingBuffer = ref("")
const gridTypingActive = ref(false)
// Undo stack for the edit mode. Each snapshot captures enough information to
// revert a single user action. Kinds: "cells" (per-cell old values), "insert"
// (we added a row), "delete" (we deleted page rows / spliced insert rows).
const editUndoStack = ref([])
const editRedoStack = ref([])
const EDIT_UNDO_LIMIT = 200
// 📝 文本选项 — bottom text editing panel state (Task 8).
const textPanelOpen = ref(false)
const textPanelHeight = ref(220)
const textPanelDraft = ref("")
const textPanelDirty = ref(false)
const textPanelFocusKey = ref("")
const textPanelOriginal = ref("")
const editMirrorSelection = reactive({ start: 0, end: 0 })
let editMirrorApplyingSelection = false

const CELL_VIEWER_LANGUAGE_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "json", label: "JSON" },
  { value: "javascript", label: "JS" },
  { value: "typescript", label: "TS" },
  { value: "python", label: "Python" },
  { value: "plaintext", label: "文本" },
]

const cellViewerOpen = ref(false)
const cellViewerDiscardDialogOpen = ref(false)
const cellViewer = reactive({
  rowIndex: -1,
  page: 1,
  globalIndex: null,
  columnName: "",
  isInsert: false,
  sourceKind: "page",
  originalText: "",
  draftText: "",
  mode: "preview",
  manualLanguage: "auto",
})

// ── 导出 ──
const exportDialogOpen = ref(false)
const exportSelectedTables = reactive(new Set())
const exportFilter = ref("")
const exportLoading = ref(false)
const batchImportDialogOpen = ref(false)
const batchImportFiles = ref([])
const batchImportStep = ref("select")
const batchImportLoading = ref(false)
const batchImportError = ref("")
const batchImportResult = ref(null)
const batchImportProgress = reactive({
  percent: 0,
  text: "",
})

const historyOpen = ref(false);
const resultZoomOpen = ref(false);
const resultZoomType = ref("table");
const settingsMsg = ref("");
const settingsSaving = ref(false);

const keyword = ref("");
const dbConnected = ref(false);
const dbName = ref("未连接");
const databaseMenuOpen = ref(false);
const databaseMenuLoading = ref(false);
const databaseMenuError = ref("");
const availableDatabases = ref([]);
const templateMenuOpen = ref(false);
const templateMenuPosition = reactive({ left: 0, bottom: 48 });
const demoDbConnected = ref(false);
const summaryText = ref("输入关键词开始搜索");
const copyToast = reactive({
  visible: false,
  text: "",
  tone: "success",
  version: 0,
});
const updateCurrentVersion = ref(APP_VERSION);
const updateDialogOpen = ref(false);
const updateChecking = ref(false);
const updateInstalling = ref(false);
const updateLatestVersion = ref("");
const updateReleaseDate = ref("");
const updateNotesSummary = ref("");
const updateError = ref("");
const availableUpdateRef = ref(null);
let updateCheckTimer = null;
const postUpdateAnnouncement = reactive({
  version: "",
  notes: "",
  notesLines: [],
  pubDate: null,
});
const updateProgress = reactive({
  status: "idle",
  downloadedBytes: 0,
  totalBytes: 0,
  percent: 0,
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
    sync_window_hotkey: "Shift+D",
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
    panel_shortcuts: {},
    reset_on_open_to_all_tables: true,
    always_on_top_hotkey: "P",
    pet_skin: "eagle",
    pet_scale: {},
    custom_font: null,
    weather_enabled: true,
    weather_skin: "",
    background_opacity: 1.0,
    reduce_transparency_mode: false,
    startup_welcome_text: "Louis",
    startup_welcome_mode: "handwriting",
    sync_profiles: [],
    default_sync_profile_id: null,
    last_used_sync_profile_id: null,
    auto_check_updates: true,
    last_update_check_at: null,
    pending_update_announcement: null,
    last_update_announcement_version: null,
    quick_paste: {
      enabled: true,
      open_hotkey: "F7",
      output_hotkey: "F8",
      snippets: [],
    },
  },
});

const syncWorkspaceHotkey = ref("Shift+D");
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

const syncCenterMode = ref(normalizeSyncCenterMode(localStorage.getItem("dbsearch-sync-center-mode")));
const syncCenterLogOpen = ref(false);
const syncCenterSidebarCollapsed = ref(
  normalizeSyncCenterSidebarCollapsed(localStorage.getItem("dbsearch-sync-center-sidebar-collapsed")),
);
const syncCenterSidebarWidth = ref(
  normalizeSyncCenterSidebarWidth(localStorage.getItem("dbsearch-sync-center-sidebar-width")),
);
const syncCenterSectionCollapsed = ref({
  database: false,
  file: false,
});
const syncCenterCtxMenu = ref(null);

function openSyncCenterCtxMenu(event, profileId, mode) {
  event.preventDefault();
  event.stopPropagation();
  syncCenterCtxMenu.value = {
    profileId,
    mode,
    x: event.clientX,
    y: event.clientY,
  };
}

function closeSyncCenterCtxMenu() {
  syncCenterCtxMenu.value = null;
}

function deleteSyncCenterProfile() {
  if (!syncCenterCtxMenu.value) return;
  const { profileId, mode } = syncCenterCtxMenu.value;
  closeSyncCenterCtxMenu();
  if (mode === "database") {
    dbMigrationWorkspaceRef.value?.removeProfile?.(profileId);
  } else {
    removeSyncProfile(profileId);
  }
}


const syncCenterDbLogState = ref({
  entries: [],
  running: false,
  steps: [],
});
const syncCenterDbSidebarState = ref({
  profiles: [],
  activeProfileId: "",
  statusText: "暂无模板",
  statusTone: "idle",
  running: false,
  connecting: false,
});
const dbMigrationWorkspaceRef = ref(null);

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
  if (!shouldRenderWeatherClouds(cat)) return []
  const count = weatherQuality.value === 'high' ? 4 : 2
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    top: `${5 + Math.random() * 20}%`,
    duration: `${40 + Math.random() * 40}s`,
    delay: `-${Math.random() * 40}s`,
    opacity: 0.7,
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
const tableFindExact = ref(false);
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
const favoritesDropdownOpen = ref(false);
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
const tableSortFlashColumn = ref("");
let tableSortFlashTimer = null;
const slashModeOpen = ref(false);
const slashQuery = ref("");
const slashActiveIndex = ref(0);
const tableTabs = ref([]);
const activeTableTabId = ref("");
const recentTables = ref([]);
const recentTabsDropdownOpen = ref(false);
const RECENT_TABLES_MAX = 10;
const tableCommandOpen = ref(false);
const tableCommandQuery = ref("");
const tableCommandActiveIndex = ref(0);
const tableCommandSlashMode = ref(false);
let armedTitlebarTableShortcut = false;
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
let unlistenSyncCenterOpenMode = null;
let unlistenPetLockChanged = null;
let unlistenMenuOpened = null;
let unlistenPetMoved = null;
let unlistenSearchFound = null;
let unlistenArtTextIndexProgress = null;
let unlistenArtTextOcrInstallProgress = null;
let unlistenPetIdleStatesChanged = null;
let unlistenPetIdlePreview = null;
let unlistenBatchImportProgress = null;
let welcomeCloseTimer = null;
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
const schemaColumnWidthMap = reactive({});
const collapsedColumnMap = reactive({});
const collapsedColumnRestoreWidthMap = reactive({});
const overflowingColumnMap = reactive({});
let columnResizeState = null;
let schemaColumnResizeState = null;
let tableLayoutObserver = null;
let tableLayoutRaf = 0;
let columnOverflowMeasureRaf = 0;
let columnHeaderMeasureCanvas = null;
let tablePageSizeAdjustToken = 0;
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
const TABLE_TAB_DRAG_THRESHOLD = 6;
const SCHEMA_COLUMN_WIDTH_MIN = 80;
const COLUMN_COLLAPSE_HORIZONTAL_PADDING = 16;
const COLUMN_COLLAPSE_BADGE_ALLOWANCE = 20;
const COLUMN_COLLAPSE_RESIZE_ALLOWANCE = 8;
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
const editPageRowKeys = computed(() =>
  tableView.rows.map((row, idx) => computeRowKey(row, idx)),
);
const editDeletedRowKeys = computed(() =>
  tableView.rows
    .map((row, idx) => (isRowDeleted(row, idx) ? computeRowKey(row, idx) : ""))
    .filter(Boolean),
);
const editCurrentPageSelectedCount = computed(() => {
  const deleted = new Set(editDeletedRowKeys.value);
  return editPageRowKeys.value.filter((key) => editSelectedRows.value.has(key) && !deleted.has(key)).length;
});
const editSelectableRowCount = computed(() => Math.max(0, editPageRowKeys.value.length - editDeletedRowKeys.value.length));
const editAllPageRowsSelected = computed(() =>
  editSelectableRowCount.value > 0 && editCurrentPageSelectedCount.value === editSelectableRowCount.value,
);
const editBatchCanApply = computed(() =>
  editCurrentPageSelectedCount.value > 0 && String(editBatchColumn.value || "").length > 0,
);
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
  syncWindowHotkey: "Shift+D",
  dbMigrationWindowHotkey: "Shift+S",
  quickPasteOpenHotkey: "F7",
  quickPasteOutputHotkey: "F8",
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
  panelShortcuts: { ...PANEL_SHORTCUT_DEFAULTS },
  resetOnOpenToAllTables: true,
  templateName: "",
  petSkin: "eagle",
  petScale: 1.0,
  customFont: null,
  weatherEnabled: true,
  backgroundOpacity: 1.0,
  reduceTransparencyMode: false,
  startupWelcomeText: "Louis",
  startupWelcomeMode: "handwriting",
  autoCheckUpdates: true,
});
const backgroundOpacityPercent = computed(() =>
  `${Math.round(normalizeBackgroundOpacity(settingsDraft.backgroundOpacity) * 100)}%`,
);
const startupWelcomeText = computed(() =>
  normalizeStartupWelcomeText(config.personal.startup_welcome_text),
);
const startupWelcomeMode = computed(() =>
  normalizeStartupWelcomeMode(config.personal.startup_welcome_mode),
);
const startupWelcomeStrokeOrderGlyphs = computed(() =>
  buildStartupWelcomeStrokeOrderGlyphs(startupWelcomeText.value),
);
const startupWelcomeFontSize = computed(() => {
  const len = startupWelcomeText.value.length;
  if (len <= 6) return 112;
  if (len <= 9) return 96;
  return 80;
});
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
const syncCenterDbProfilesView = computed(() =>
  Array.isArray(syncCenterDbSidebarState.value.profiles)
    ? syncCenterDbSidebarState.value.profiles
    : [],
);
const syncCenterDbStatusText = computed(() =>
  syncCenterDbSidebarState.value.statusText || "暂无模板",
);
const syncCenterDbStatusTone = computed(() =>
  syncCenterDbSidebarState.value.statusTone || "idle",
);
const syncCenterDbProfilesFiltered = computed(() => syncCenterDbProfilesView.value);
const syncCenterFileProfilesFiltered = computed(() => syncWorkspaceProfilesView.value);
const syncCenterAnyRunning = computed(() =>
  Boolean(syncWorkspaceRunning.value || syncCenterDbLogState.value.running),
);
const syncCenterFileSummary = computed(() => ({
  name: activeSyncProfile.value?.name || "同步配置 1",
  status: currentProfileStatusText.value || "未执行",
  tone: currentProfileStatusTone.value || "idle",
}));
const syncCenterLogDrawerVisible = computed(() =>
  shouldShowSyncCenterLogDrawer({
    manualOpen: syncCenterLogOpen.value,
    running: syncCenterAnyRunning.value,
  }),
);
const syncCenterActiveLogEntries = computed(() =>
  syncCenterMode.value === "database"
    ? syncCenterDbLogState.value.entries
    : syncWorkspaceTimelineView.value,
);
const syncCenterLogTitle = computed(() =>
  syncCenterMode.value === "database" ? "数据库同步日志" : "转表日志",
);
const syncCenterActiveLogEmptyText = computed(() =>
  syncCenterMode.value === "database" ? "数据库同步暂无日志" : "转表暂无日志",
);
const syncCenterActiveFallbackSteps = computed(() =>
  syncCenterMode.value === "database"
    ? (Array.isArray(syncCenterDbLogState.value.steps) ? syncCenterDbLogState.value.steps : [])
    : pipelineStepsView.value,
);

function selectSyncCenterMode(mode) {
  const nextMode = normalizeSyncCenterMode(mode);
  syncCenterMode.value = nextMode;
  localStorage.setItem("dbsearch-sync-center-mode", nextMode);
}

function toggleSyncCenterSection(section) {
  const nextState = resolveSyncCenterSectionToggle(
    section,
    syncCenterMode.value,
    syncCenterSectionCollapsed.value,
  );
  selectSyncCenterMode(nextState.mode);
  syncCenterSectionCollapsed.value = nextState.collapsed;
}

function toggleSyncCenterLogDrawer() {
  syncCenterLogOpen.value = !syncCenterLogOpen.value;
}

function toggleSyncCenterSidebarCollapsed() {
  syncCenterSidebarCollapsed.value = !syncCenterSidebarCollapsed.value;
  localStorage.setItem(
    "dbsearch-sync-center-sidebar-collapsed",
    syncCenterSidebarCollapsed.value ? "1" : "0",
  );
}

function handleDbMigrationLogState(state = {}) {
  syncCenterDbLogState.value = {
    entries: Array.isArray(state.entries) ? state.entries : [],
    running: Boolean(state.running),
    steps: Array.isArray(state.steps) ? state.steps : [],
  };
}

function handleDbMigrationSidebarState(state = {}) {
  syncCenterDbSidebarState.value = {
    profiles: Array.isArray(state.profiles) ? state.profiles : [],
    activeProfileId: state.activeProfileId ? String(state.activeProfileId) : "",
    statusText: state.statusText ? String(state.statusText) : "暂无模板",
    statusTone: state.statusTone ? String(state.statusTone) : "idle",
    running: Boolean(state.running),
    connecting: Boolean(state.connecting),
  };
}

function addDbMigrationProfileFromSyncCenter() {
  selectSyncCenterMode("database");
  syncCenterSectionCollapsed.value = { ...syncCenterSectionCollapsed.value, database: false };
  nextTick(() => {
    dbMigrationWorkspaceRef.value?.addProfile?.();
  });
}

function selectDbMigrationProfileFromSyncCenter(profileId) {
  selectSyncCenterMode("database");
  syncCenterSectionCollapsed.value = { ...syncCenterSectionCollapsed.value, database: false };
  nextTick(() => {
    dbMigrationWorkspaceRef.value?.activateProfile?.(profileId);
  });
}

function addSyncProfileFromSyncCenter() {
  selectSyncCenterMode("file");
  syncCenterSectionCollapsed.value = { ...syncCenterSectionCollapsed.value, file: false };
  addSyncProfile();
}

function selectSyncProfileFromSyncCenter(profileId) {
  selectSyncCenterMode("file");
  syncCenterSectionCollapsed.value = { ...syncCenterSectionCollapsed.value, file: false };
  focusSyncProfile(profileId);
}

function openDbMigrationSettingsFromSyncCenter() {
  dbMigrationWorkspaceRef.value?.openSettings?.();
}

function addDbMigrationProfileFromSyncSettings() {
  closeSyncSettings();
  addDbMigrationProfileFromSyncCenter();
}

function editDbMigrationProfileFromSyncSettings(profileId) {
  closeSyncSettings();
  selectDbMigrationProfileFromSyncCenter(profileId);
}

function removeDbMigrationProfileFromSyncSettings(profileId) {
  dbMigrationWorkspaceRef.value?.removeProfile?.(profileId);
}

function addSyncProfileFromSettings() {
  closeSyncSettings();
  addSyncProfileFromSyncCenter();
}

function editSyncProfileFromSettings(profileId) {
  closeSyncSettings();
  selectSyncProfileFromSyncCenter(profileId);
  syncContentEditing.value = true;
}

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
  markSyncWorkspaceDirty();
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

function startSyncCenterResize(event, direction) {
  if (event.button !== 0 || !isTauriWindow || !isSyncWorkspaceWindow.value) return;
  event.preventDefault();
  getCurrentWindow().startResizeDragging(direction).catch(() => {});
}

function startSyncCenterSidebarResize(event) {
  if (event.button !== 0 || syncCenterSidebarCollapsed.value) return;
  event.preventDefault();

  const startX = event.clientX;
  const startWidth = syncCenterSidebarWidth.value;

  const stopResize = () => {
    localStorage.setItem("dbsearch-sync-center-sidebar-width", String(syncCenterSidebarWidth.value));
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  };

  const onPointerMove = (moveEvent) => {
    syncCenterSidebarWidth.value = normalizeSyncCenterSidebarWidth(
      startWidth + moveEvent.clientX - startX,
    );
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
}

// ── Art Text Search ──────────────────────────────────────────────────────────
const artTextDirs = ref([]);
const artTextQuery = ref("");
const artTextResults = ref([]);
const artTextSearching = ref(false);
const artTextBuilding = ref(false);
const artTextIndexBuiltAt = ref("");
const artTextProgressCurrent = ref(0);
const artTextProgressTotal = ref(0);
const artTextProgressFile = ref("");
const artTextProgressPhase = ref("");
const artTextMessage = ref("");
const artTextScanningDirs = ref(false);
const artTextSubDirs = ref([]);
const artTextOcrStatus = ref(null);
const artTextOcrChecking = ref(false);
const artTextOcrInstalling = ref(false);
const artTextOcrInstallCurrent = ref(0);
const artTextOcrInstallTotal = ref(0);
const artTextOcrInstallFile = ref("");
const artTextOcrInstallPhase = ref("");

const artTextAllSubDirsSelected = computed(() =>
  artTextSubDirs.value.length > 0 && artTextSubDirs.value.every(d => d.selected)
);
const artTextSelectedSubDirCount = computed(() =>
  artTextSubDirs.value.filter(d => d.selected).length
);
let artTextSearchDebounce = null;

const artTextProgressPercent = computed(() => {
  if (artTextProgressTotal.value <= 0) return 0;
  return Math.round((artTextProgressCurrent.value / artTextProgressTotal.value) * 100);
});

const artTextOcrReady = computed(() => Boolean(artTextOcrStatus.value?.ready));
const artTextOcrMissingText = computed(() => {
  const missing = artTextOcrStatus.value?.missing || [];
  return missing.length ? missing.join("、") : "";
});
const artTextOcrInstallPercent = computed(() => {
  if (artTextOcrInstallTotal.value <= 0) return 0;
  return Math.min(100, Math.round((artTextOcrInstallCurrent.value / artTextOcrInstallTotal.value) * 100));
});

async function loadArtTextDirs() {
  try {
    artTextDirs.value = await invoke("get_art_text_search_dirs");
  } catch { /* ignore */ }
}

async function loadArtTextIndexInfo() {
  try {
    const info = await invoke("get_art_text_index_info");
    artTextIndexBuiltAt.value = info.builtAt || "";
  } catch { /* ignore */ }
}

async function checkArtTextOcrStatus(showMessage = true) {
  artTextOcrChecking.value = true;
  try {
    const status = await invoke("get_art_text_ocr_status");
    artTextOcrStatus.value = status;
    if (showMessage) {
      artTextMessage.value = status.ready
        ? `OCR 模型已安装：${status.path}`
        : `OCR 模型未安装，缺少：${(status.missing || []).join("、")}`;
    }
    return status;
  } catch (e) {
    artTextMessage.value = String(e);
    return null;
  } finally {
    artTextOcrChecking.value = false;
  }
}

async function installArtTextOcrModels() {
  artTextOcrInstalling.value = true;
  artTextMessage.value = "正在下载并安装 OCR 模型...";
  artTextOcrInstallCurrent.value = 0;
  artTextOcrInstallTotal.value = 0;
  artTextOcrInstallFile.value = "";
  artTextOcrInstallPhase.value = "";
  try {
    const status = await invoke("install_art_text_ocr_models");
    artTextOcrStatus.value = status;
    artTextMessage.value = `OCR 模型安装完成：${status.path}`;
  } catch (e) {
    artTextMessage.value = String(e);
  } finally {
    artTextOcrInstalling.value = false;
  }
}

async function importArtTextOcrModels() {
  try {
    const dir = await open({ directory: true, multiple: false, title: "选择 OCR 模型目录" });
    if (!dir) return;
    artTextOcrInstalling.value = true;
    artTextMessage.value = "正在复制本地 OCR 模型...";
    const status = await invoke("import_art_text_ocr_models", { sourceDir: dir });
    artTextOcrStatus.value = status;
    artTextMessage.value = `OCR 模型导入完成：${status.path}`;
  } catch (e) {
    artTextMessage.value = String(e);
  } finally {
    artTextOcrInstalling.value = false;
  }
}

async function addArtTextDir() {
  try {
    const dir = await open({ directory: true, multiple: false });
    if (dir && !artTextDirs.value.includes(dir)) {
      artTextDirs.value.push(dir);
      await invoke("save_art_text_search_dirs", { dirs: artTextDirs.value });
    }
  } catch (e) {
    console.warn("Failed to add directory:", e);
  }
}

async function scanArtTextSubDirs() {
  if (artTextDirs.value.length === 0) {
    artTextMessage.value = "请先添加一个目录";
    return;
  }
  artTextScanningDirs.value = true;
  artTextMessage.value = "";
  try {
    // Scan the first (most recently added) directory
    const targetDir = artTextDirs.value[artTextDirs.value.length - 1];
    const result = await invoke("scan_art_text_sub_dirs", { dir: targetDir });
    artTextSubDirs.value = result.map(d => ({ ...d, selected: true }));
    if (result.length === 0) {
      artTextMessage.value = "该目录下未找到含图片的子目录";
    }
  } catch (e) {
    artTextMessage.value = String(e);
  } finally {
    artTextScanningDirs.value = false;
  }
}

function toggleAllSubDirs() {
  const allSelected = artTextAllSubDirsSelected.value;
  artTextSubDirs.value.forEach(d => { d.selected = !allSelected; });
}

async function confirmSubDirSelection() {
  const selected = artTextSubDirs.value.filter(d => d.selected).map(d => d.path);
  if (selected.length === 0) return;
  artTextDirs.value = selected;
  await invoke("save_art_text_search_dirs", { dirs: selected });
  artTextSubDirs.value = [];
  artTextMessage.value = `已选择 ${selected.length} 个目录，可以开始构建索引`;
}

async function removeArtTextDir(index) {
  artTextDirs.value.splice(index, 1);
  try {
    await invoke("save_art_text_search_dirs", { dirs: artTextDirs.value });
  } catch { /* ignore */ }
}

async function buildArtTextIndex() {
  const status = artTextOcrReady.value ? artTextOcrStatus.value : await checkArtTextOcrStatus(false);
  if (!status?.ready) {
    artTextMessage.value = `请先安装 OCR 模型${status?.missing?.length ? `，缺少：${status.missing.join("、")}` : ""}`;
    return;
  }
  artTextBuilding.value = true;
  artTextMessage.value = "";
  artTextProgressCurrent.value = 0;
  artTextProgressTotal.value = 0;
  artTextProgressFile.value = "";
  try {
    const result = await invoke("build_art_text_index");
    artTextIndexBuiltAt.value = result.index.builtAt || "";
    const parts = [`索引共 ${result.index.entries.length} 条记录`];
    if (result.new_count > 0) parts.push(`新增 ${result.new_count}`);
    if (result.moved_count > 0) parts.push(`移动/重命名 ${result.moved_count}`);
    if (result.removed_count > 0) parts.push(`已移除 ${result.removed_count}`);
    if (result.error_count > 0) parts.push(`失败 ${result.error_count}`);
    artTextMessage.value = parts.join("，");
  } catch (e) {
    artTextMessage.value = String(e);
    console.warn("Build index failed:", e);
  } finally {
    artTextBuilding.value = false;
  }
}

function onArtTextSearchInput() {
  if (artTextSearchDebounce) clearTimeout(artTextSearchDebounce);
  const query = artTextQuery.value.trim();
  if (!query) {
    artTextResults.value = [];
    artTextSearching.value = false;
    return;
  }
  artTextSearching.value = true;
  artTextSearchDebounce = setTimeout(async () => {
    try {
      artTextResults.value = await invoke("search_art_text", { text: query });
    } catch {
      artTextResults.value = [];
    } finally {
      artTextSearching.value = false;
    }
  }, 300);
}

async function openArtTextFile(path) {
  try {
    await invoke("open_file_in_explorer", { path });
  } catch (e) {
    console.warn("Failed to open file:", e);
  }
}

async function closeArtTextSearchWindow() {
  if (!isTauriWindow || !isArtTextSearchWindow.value) return;
  await invoke("hide_art_text_search_window").catch(() => {});
}

async function artTextSearchMinimize() {
  if (!isTauriWindow || !isArtTextSearchWindow.value) return;
  await getCurrentWindow().minimize().catch(() => {});
}

async function artTextSearchToggleMaximize() {
  if (!isTauriWindow || !isArtTextSearchWindow.value) return;
  const appWindow = getCurrentWindow();
  const maximized = await appWindow.isMaximized().catch(() => false);
  if (maximized) {
    await appWindow.unmaximize().catch(() => {});
  } else {
    await appWindow.maximize().catch(() => {});
  }
}

function artTextSearchHeaderPointerDown(event) {
  if (event.button !== 0 || !isTauriWindow || !isArtTextSearchWindow.value) return;
  const target = event.target;
  if (target instanceof Element && target.closest("button, input, textarea, select, label, a")) {
    return;
  }
  getCurrentWindow().startDragging().catch(() => {});
}

function handleArtTextIndexProgress(event) {
  const { current, total, currentFile, phase } = event.payload || {};
  artTextProgressCurrent.value = Number(current) || 0;
  artTextProgressTotal.value = Number(total) || 0;
  artTextProgressFile.value = currentFile || "";
  artTextProgressPhase.value = phase || "";
}

function handleArtTextOcrInstallProgress(event) {
  const { current, total, currentFile, phase } = event.payload || {};
  artTextOcrInstallCurrent.value = Number(current) || 0;
  artTextOcrInstallTotal.value = Number(total) || 0;
  artTextOcrInstallFile.value = currentFile || "";
  artTextOcrInstallPhase.value = phase || "";
}

async function initArtTextSearchWindow() {
  await loadArtTextDirs();
  await loadArtTextIndexInfo();
  await checkArtTextOcrStatus(false);
  if (isTauriWindow && !unlistenArtTextIndexProgress) {
    unlistenArtTextIndexProgress = await listen("art-text-index-progress", handleArtTextIndexProgress);
  }
  if (isTauriWindow && !unlistenArtTextOcrInstallProgress) {
    unlistenArtTextOcrInstallProgress = await listen("art-text-ocr-install-progress", handleArtTextOcrInstallProgress);
  }
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
const offlineDemoMode = computed(() => !dbConnected.value);
const canEditCurrentTable = computed(() =>
  dbConnected.value ||
  (offlineDemoMode.value && tableView.tableName === DEMO_FEATURE_TEST_TABLE),
);
const canSearchData = computed(() => (dbConnected.value || offlineDemoMode.value) && keyword.value.trim().length > 0);
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
function tableTabOrderStorageKey() {
  return buildTableTabOrderStorageKey(config.shared.db);
}
function loadPersistedTableTabOrder() {
  try {
    const key = tableTabOrderStorageKey();
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function saveTableTabOrder(tabs = tableTabs.value) {
  try {
    const key = tableTabOrderStorageKey();
    if (!key) return;
    const order = serializeTableTabOrder(tabs);
    if (order.length === 0) return;
    localStorage.setItem(key, JSON.stringify(order));
  } catch {
    // ignore persistence failures
  }
}
function addToRecentTables(tableName, tableComment) {
  recentTables.value = [
    { tableName, tableComment: tableComment || "", openedAt: Date.now() },
    ...recentTables.value.filter((r) => r.tableName !== tableName),
  ].slice(0, RECENT_TABLES_MAX);
  saveRecentTables();
}
function toggleRecentTabsDropdown() {
  favoritesDropdownOpen.value = false;
  recentTabsDropdownOpen.value = !recentTabsDropdownOpen.value;
}

function toggleFavoritesDropdown() {
  recentTabsDropdownOpen.value = false;
  favoritesDropdownOpen.value = !favoritesDropdownOpen.value;
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

const favoritesMenuItems = computed(() =>
  buildFavoritesMenuItems({
    starredTables: [...starredTables],
    tableFolders: tableFolders.value,
    activeFolder: activeFolder.value,
  }),
);

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
  const base = rankTableSearchCandidates(
    keyword.value,
    (Array.isArray(tableOptions.value) ? tableOptions.value : []).map((item) => ({
      ...item,
      match_type: "TableName",
      matched_text: item.table_name,
      score: 0,
      _type: "table",
    })),
  );
  // 搜索模式下保持 rankTableSearchCandidates 的相关性排序，不再按字母重排
  // （无关键词时走 defaultTableResults，仍使用 sortTableItems 排序）
  return applyStarPinning(applyFolderFilter(base));
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
  { key: '全部',  label: '全部',  icon: 'all', count: totalResultCount.value },
  { key: '表名',  label: '表名',  icon: 'table', count: tableTabCount.value },
  { key: '字段名', label: '字段名', icon: 'columns', count: sortedSearchColumnResults.value.length },
  { key: '备注',  label: '备注',  icon: 'comment', count: sortedSearchCommentResults.value.length },
  { key: '数据值', label: '数据值', icon: 'data', count: isKeywordEmpty.value ? 0 : sortedSearchDataResults.value.length },
]);
const panelTableDefaultViewLabel = computed(() =>
  describeTableDefaultViewLabel(config.personal.table_default_view),
);
const panelTableDefaultViewTitle = computed(() =>
  `${panelTableDefaultViewLabel.value}，点击切换为${describeTableDefaultViewLabel(toggleTableDefaultView(config.personal.table_default_view))}`,
);
const panelTabs = computed(() =>
  buildPanelTabs({
    starredTables: [...starredTables],
    tableTabs: tableTabs.value,
    activeTableTabId: activeTableTabId.value,
  }),
);
const showPanelTabStrip = computed(() =>
  shouldShowPanelTabStrip({
    dbConnected: dbConnected.value,
    panelTabsCount: panelTabs.value.length,
    recentTablesCount: recentTables.value.length,
  }),
);
const showTitlebarDbSwitcher = computed(() =>
  shouldShowTitlebarDbSwitcher({
    dbConnected: dbConnected.value,
    templateCount: Array.isArray(config.shared.db_templates) ? config.shared.db_templates.length : 0,
  }),
);
const showHeaderShelf = computed(() =>
  dbConnected.value ||
  panelTabs.value.length > 0 ||
  recentTables.value.length > 0 ||
  starredTables.size > 0 ||
  tableFolders.value.length > 0,
);
const tableSortMeta = computed(() => getTableSortMeta(sortMode.value));
const showTableScopeBar = computed(() => activeFolder.value !== "all");
const showTableResultHeader = computed(() => {
  if (isKeywordEmpty.value) {
    return activeResultTab.value === "全部" || activeResultTab.value === "表名";
  }
  return activeResultTab.value === "表名";
});

const tableTabsController = createTabStripController({
  isEnabled: () => tableOpen.value,
  getItems: () => tableTabs.value,
  getId: (tab) => tab?.id,
  itemIdPrefix: "table-tab-",
  draggableItemSelector: ".table-tab",
  labelSelector: ".table-tab-label",
  closeSelector: ".table-tab-close",
  addButtonSelector: ".table-tab-add",
  gapWidth: 4,
  threshold: TABLE_TAB_DRAG_THRESHOLD,
  onReorder: ({ fromIndex, toIndex }) => {
    tableTabs.value = moveTableTab(tableTabs.value, fromIndex, toIndex);
  },
  onReorderCommitted: () => {
    saveTableTabOrder();
  },
});

const panelTabsController = createTabStripController({
  isEnabled: () =>
    shouldEnablePanelTabDrag({
      panelTabs: panelTabs.value,
    }),
  getItems: () => panelTabs.value,
  getId: (tab) => tab?.tabId,
  isItemDraggable: (tab) => Boolean(tab?.draggable && tab?.tabId),
  itemIdPrefix: "panel-tab-",
  draggableItemSelector: '.panel-tab-chip[data-tab-draggable="true"]',
  measureItemSelector: '.panel-tab-chip[data-tab-kind="opened"]',
  labelSelector: ".panel-tab-chip-label",
  closeSelector: ".panel-tab-chip-close",
  addButtonSelector: ".panel-tab-chip-add",
  gapWidth: 4,
  threshold: TABLE_TAB_DRAG_THRESHOLD,
  onReorder: ({ fromIndex, toIndex }) => {
    tableTabs.value = moveTableTab(tableTabs.value, fromIndex, toIndex);
  },
  onReorderCommitted: () => {
    saveTableTabOrder();
  },
  measureItemWidth: (itemEl) =>
    measureTabStripItemWidth(itemEl, {
      labelSelector: ".panel-tab-chip-label",
      closeSelector: ".panel-tab-chip-close",
      minWidth: 120,
      maxWidth: 208,
      chromeWidth: 40,
    }),
});

const tableTabsCompressed = tableTabsController.compressed;
const tableTabDrag = tableTabsController.drag;
const tableTabSuppressClickUntil = tableTabsController.suppressClickUntil;
const tableTabsRef = tableTabsController.wrapRef;

const panelTabsCompressed = panelTabsController.compressed;
const panelTabDrag = panelTabsController.drag;
const panelTabSuppressClickUntil = panelTabsController.suppressClickUntil;
const panelTabsRef = panelTabsController.wrapRef;
const resultsMainRef = ref(null);
const tableCommentAlignOffset = ref(18);
const TABLE_COMMENT_OFFSET_FALLBACK = 18;
let tableCommentAlignObserver = null;
let tableCommentAlignRaf = 0;

const tableListLayoutStyle = computed(() => ({
  "--table-comment-offset": `${tableCommentAlignOffset.value}px`,
}));

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
  tableCommandSlashMode.value ? "Slash 模式 / 选择表" : `${getPanelShortcut("openTableCommand")} 输入表名，Enter 打开`,
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
const tableDialogSurfaceMode = computed(() =>
  resolveTableDialogSurfaceMode({
    isPanelWindow: isPanelWindow.value,
  }),
);
const contentScaleStyle = computed(() => ({
  "--content-scale": String(normalizeUiScale(config.personal.ui_scale)),
}));
const panelChromeStyle = computed(() => {
  const style = {
    "--panel-opacity": String(normalizeBackgroundOpacity(config.personal.background_opacity)),
  };
  if (weatherEnabled.value && weatherPresentation.value?.surfaceVars) {
    Object.assign(style, weatherPresentation.value.surfaceVars);
  }
  return style;
});
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
const cellViewerDirty = computed(() => cellViewer.draftText !== cellViewer.originalText);
const cellViewerPreview = computed(() => buildCellViewerPreview({
  text: cellViewer.draftText,
  manualLanguage: cellViewer.manualLanguage,
}));
const cellViewerCanSave = computed(() => editMode.value && cellViewerDirty.value);
const cellViewerEditSupported = computed(() =>
  cellViewer.isInsert ||
  cellViewer.sourceKind === "page" ||
  (cellViewer.sourceKind === "hit" && cellViewer.page === tableView.page)
);
const cellViewerCanEnterEdit = computed(() => cellViewerEditSupported.value && (!editMode.value || cellViewer.mode !== "edit"));
const cellViewerTitle = computed(() => {
  if (!cellViewer.columnName) return "单元格详细内容";
  const rowLabel = cellViewer.isInsert
    ? "新增行"
    : (cellViewer.globalIndex != null ? `第 ${cellViewer.globalIndex} 行` : `第 ${cellViewer.rowIndex + 1} 行`);
  return `${cellViewer.columnName} · ${rowLabel}`;
});
const cellViewerEditHint = computed(() => {
  if (cellViewerEditSupported.value) return "";
  return "汇总命中视图仅支持查看，编辑请切回原页数据";
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
  favoritesDropdownOpen.value = false;
  folderCtxTarget.value = null;
}
function closeItemCtxMenu() {
  itemCtxOpen.value = false;
  itemCtxSubMenuOpen.value = false;
}
function selectSortMode(mode) {
  sortMode.value = mode;
  saveOrgData();
  syncSummaryForDefaultTableBrowse();
}
function triggerTableSortFlash(column) {
  tableSortFlashColumn.value = column;
  if (tableSortFlashTimer) clearTimeout(tableSortFlashTimer);
  tableSortFlashTimer = window.setTimeout(() => {
    if (tableSortFlashColumn.value === column) tableSortFlashColumn.value = "";
  }, 180);
}
function toggleTableSort(column) {
  triggerTableSortFlash(column);
  selectSortMode(resolveNextTableSortMode(sortMode.value, column));
}
function selectFavoriteFilter(target) {
  activeFolder.value = target;
  favoritesDropdownOpen.value = false;
  syncSummaryForDefaultTableBrowse();
}
function openFolderCtxMenu(event, folderId) {
  event.preventDefault();
  event.stopPropagation();
  folderCtxTarget.value = folderId;
  folderCtxPos.x = event.clientX;
  folderCtxPos.y = event.clientY;
  favoritesDropdownOpen.value = true;
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
  favoritesDropdownOpen.value = false;
  newFolderDialogOpen.value = true;
  newFolderName.value = "";
}
function handleNewFolderFromFavorites() {
  favoritesDropdownOpen.value = false;
  newFolderDialogOpen.value = true;
  newFolderName.value = "";
}
function handleDeleteFolder(folderId) {
  deleteFolder(folderId);
  closeFolderCtxMenu();
  syncSummaryForDefaultTableBrowse();
}
function closeAllOrgMenus() {
  favoritesDropdownOpen.value = false;
  recentTabsDropdownOpen.value = false;
  closeItemCtxMenu();
  closeFolderCtxMenu();
}
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
  if (offlineDemoMode.value) return true;
  if (dbConnected.value) return true;
  summaryText.value = "当前数据库未连接";
  return false;
}

function ensureDatabaseSelectedForSearch() {
  if (offlineDemoMode.value) return true;
  if (!ensureDbConnectedForSearch()) return false;
  if (dbName.value && dbName.value !== "未连接" && dbName.value !== "请选择数据库") return true;
  summaryText.value = "请先选择数据库";
  return false;
}

function syncSummaryForDefaultTableBrowse() {
  if (!isPanelWindow.value || !isKeywordEmpty.value) return;
  const total = (Array.isArray(tableOptions.value) ? tableOptions.value : []).length;
  const shown = defaultTableResults.value.length;
  if (!offlineDemoMode.value && dbConnected.value && (!dbName.value || dbName.value === "请选择数据库")) {
    summaryText.value = "已连接 MySQL，请选择数据库";
    return;
  }
  if (activeFolder.value === "all") {
    summaryText.value = offlineDemoMode.value ? `离线演示：共 ${total} 张表` : `共 ${total} 张表`;
  } else {
    const folderName = activeFolder.value === "starred" ? "星标" : (tableFolders.value.find((f) => f.id === activeFolder.value)?.name || "文件夹");
    const prefix = offlineDemoMode.value ? "离线演示 · " : "";
    summaryText.value = `${prefix}${folderName}：${shown} 张表（共 ${total}）`;
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
  if (dbConnected.value && (!dbName.value || dbName.value === "请选择数据库")) {
    tableOptions.value = [];
    syncSummaryForDefaultTableBrowse();
    return;
  }
  if (demoDbConnected.value) {
    tableOptions.value = DEMO_TABLE_OPTIONS.map((item) => ({ ...item }));
    syncSummaryForDefaultTableBrowse();
    return;
  }
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
  if (reset) {
    resetPanelStateForDefaultBrowse();
    focusKeyword();
    return;
  }
  const focusTarget = resolvePanelActivatedFocusTarget({
    isPanelWindow: isPanelWindow.value,
    tableOpen: tableOpen.value,
  });
  if (focusTarget === "table") {
    focusTableSurface();
  } else if (focusTarget === "keyword") {
    focusKeyword();
  }
  syncSummaryForDefaultTableBrowse();
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

function cloneSchemaColumnWidthMap(input = schemaColumnWidthMap) {
  const out = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    const width = Number(value);
    if (Number.isFinite(width) && width > 0) out[key] = width;
  });
  return out;
}

function cloneBooleanMap(input = {}) {
  const out = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    if (value) out[key] = true;
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
      exact: tableFindExact.value,
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
    schemaColumnWidthMap: cloneSchemaColumnWidthMap(schemaColumnWidthMap),
    collapsedColumnMap: cloneBooleanMap(collapsedColumnMap),
    collapsedColumnRestoreWidthMap: cloneColumnWidthMap(collapsedColumnRestoreWidthMap),
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
      exact: false,
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
    schemaColumnWidthMap: {},
    collapsedColumnMap: {},
    collapsedColumnRestoreWidthMap: {},
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

function applySchemaColumnWidthMap(nextMap = {}) {
  clearSchemaColumnWidths();
  Object.entries(nextMap || {}).forEach(([key, value]) => {
    const width = Number(value);
    if (Number.isFinite(width) && width > 0) {
      schemaColumnWidthMap[key] = width;
    }
  });
}

function clearCollapsedColumnMaps() {
  Object.keys(collapsedColumnMap).forEach((key) => { delete collapsedColumnMap[key]; });
  Object.keys(collapsedColumnRestoreWidthMap).forEach((key) => { delete collapsedColumnRestoreWidthMap[key]; });
}

function applyCollapsedColumnState(nextCollapsedMap = {}, nextRestoreWidthMap = {}) {
  clearCollapsedColumnMaps();
  Object.entries(nextCollapsedMap || {}).forEach(([key, value]) => {
    if (value) collapsedColumnMap[key] = true;
  });
  Object.entries(nextRestoreWidthMap || {}).forEach(([key, value]) => {
    const width = Number(value);
    if (Number.isFinite(width) && width > 0) {
      collapsedColumnRestoreWidthMap[key] = width;
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
  tableFindExact.value = !!tab.tableFind?.exact;
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
  applySchemaColumnWidthMap(tab.schemaColumnWidthMap || {});
  applyCollapsedColumnState(tab.collapsedColumnMap || {}, tab.collapsedColumnRestoreWidthMap || {});
  tableTabRestoring = false;
  scheduleColumnOverflowMeasure();
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

function clearTableTabDragState() {
  tableTabsController.clearDragState();
}

function scrollTableTabIntoView(tabId, behavior = "smooth") {
  tableTabsController.scrollItemIntoView(tabId, behavior);
}

function stopTableTabsCompressionMeasure() {
  tableTabsController.stopCompressionMeasure();
}

function scheduleTableTabsCompressionMeasure() {
  tableTabsController.scheduleCompressionMeasure();
}

function clearPanelTabDragState() {
  panelTabsController.clearDragState();
}

function scrollPanelTabIntoView(tabId, behavior = "smooth") {
  panelTabsController.scrollItemIntoView(tabId, behavior);
}

function stopPanelTabsCompressionMeasure() {
  panelTabsController.stopCompressionMeasure();
}

function schedulePanelTabsCompressionMeasure() {
  panelTabsController.scheduleCompressionMeasure();
}

function measureTableCommentAlignment() {
  const root = resultsMainRef.value;
  if (!(root instanceof HTMLElement) || !showTableResultHeader.value) {
    tableCommentAlignOffset.value = TABLE_COMMENT_OFFSET_FALLBACK;
    return;
  }

  const commentLabel = root.querySelector(".table-results-header .table-results-header-btn:nth-child(2) .table-results-header-label");
  const firstCommentCell = root.querySelector(".list-main .demo-result-card--table .table-result-comment");
  if (!(commentLabel instanceof HTMLElement) || !(firstCommentCell instanceof HTMLElement)) {
    tableCommentAlignOffset.value = TABLE_COMMENT_OFFSET_FALLBACK;
    return;
  }

  const nextOffset = Math.round(commentLabel.getBoundingClientRect().left - firstCommentCell.getBoundingClientRect().left);
  tableCommentAlignOffset.value = Number.isFinite(nextOffset)
    ? Math.max(0, nextOffset)
    : TABLE_COMMENT_OFFSET_FALLBACK;
}

function stopTableCommentAlignObserver() {
  if (tableCommentAlignObserver) {
    tableCommentAlignObserver.disconnect();
    tableCommentAlignObserver = null;
  }
  if (tableCommentAlignRaf) {
    cancelAnimationFrame(tableCommentAlignRaf);
    tableCommentAlignRaf = 0;
  }
}

function scheduleTableCommentAlignmentMeasure() {
  if (tableCommentAlignRaf) {
    cancelAnimationFrame(tableCommentAlignRaf);
  }
  tableCommentAlignRaf = requestAnimationFrame(() => {
    tableCommentAlignRaf = 0;
    nextTick(() => {
      measureTableCommentAlignment();
    });
  });
}

async function startTableCommentAlignObserver() {
  stopTableCommentAlignObserver();
  if (typeof ResizeObserver === "undefined") return;
  await nextTick();

  const root = resultsMainRef.value;
  if (!(root instanceof HTMLElement)) return;

  const targets = [
    root,
    root.querySelector(".table-results-header"),
    root.querySelector(".list-main"),
    root.querySelector(".list-main .demo-result-card--table"),
  ].filter((item) => item instanceof HTMLElement);

  if (targets.length === 0) {
    tableCommentAlignOffset.value = TABLE_COMMENT_OFFSET_FALLBACK;
    return;
  }

  tableCommentAlignObserver = new ResizeObserver(() => {
    scheduleTableCommentAlignmentMeasure();
  });
  targets.forEach((target) => tableCommentAlignObserver.observe(target));
  scheduleTableCommentAlignmentMeasure();
}

function applyDefaultTableDialogState() {
  tableFullscreen.value = TABLE_DIALOG_DEFAULTS.fullscreen;
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
  applyDefaultTableDialogState();
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
  if (next.needsReload) {
    next.needsReload = false;
    tableView.page = 1;
    await loadTablePage({ resetFocus: true, clearHitCache: true });
  }
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
  tableTabs.value = applyPersistedTableTabOrder(
    [...tableTabs.value, nextTab],
    loadPersistedTableTabOrder(),
  );
  activeTableTabId.value = nextTab.id;
  saveTableTabOrder();

  resultZoomOpen.value = false;
  restoreLiveStateFromTableSnapshot(nextTab);
  applyDefaultTableDialogState();
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
  if (tableTabs.value.length > 0) {
    saveTableTabOrder();
  }

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
  clearTableTabDragState();
  clearPanelTabDragState();
}

function handleTableTabClick(tabId) {
  if (Date.now() < tableTabSuppressClickUntil.value) return;
  activateTableTab(tabId);
}

function handleTableTabClose(tabId) {
  if (tableTabDrag.dragging) return;
  closeTableTab(tabId);
}

function onTableTabPointerDown(event, tabId) {
  tableTabsController.onPointerDown(event, tabId);
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
  if (Date.now() < panelTabSuppressClickUntil.value) return;
  if (!tab?.tableName) return;
  if (tab.opened && tab.tabId) {
    await activateTableTab(tab.tabId);
    scrollPanelTabIntoView(tab.tabId);
    return;
  }
  await openOrActivateTableTab(tab.tableName);
  scrollPanelTabIntoView(activeTableTabId.value);
}

async function closePanelChromeTab(tab) {
  if (panelTabDrag.dragging) return;
  if (!tab?.opened || !tab.tabId) return;
  const wasTableOpen = tableOpen.value;
  await closeTableTab(tab.tabId);
  if (!wasTableOpen && tableOpen.value) {
    tableOpen.value = false;
  }
}

function onPanelTabPointerDown(event, tab) {
  if (shouldFocusPanelShellFromTitlebarPointerDown({
    button: event.button,
    interactiveTarget: false,
  })) {
    armedTitlebarTableShortcut = true;
    focusPanelShell();
  }
  if (!tab?.draggable || !tab?.tabId) return;
  panelTabsController.onPointerDown(event, tab.tabId);
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
  if (!isTauriWindow) return;
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

function ensureWeatherRefreshTimer() {
  if (!weatherRefreshTimer) {
    weatherRefreshTimer = setInterval(fetchWeather, WEATHER_REFRESH_MS);
  }
}

function stopWeatherRefreshTimer() {
  if (weatherRefreshTimer) {
    clearInterval(weatherRefreshTimer);
    weatherRefreshTimer = null;
  }
}

function applyPreviewWeather(cat) {
  if (settingsOpen.value && !settingsDraft.weatherEnabled) {
    settingsDraft.weatherEnabled = true
  }
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
  if (config.personal) {
    config.personal.weather_skin = ''
  }
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
}

onMounted(async () => {
  if (isTauriWindow) {
    windowLabel.value = getCurrentWindow().label;
  }

  applyTheme(themeId.value)
  await loadConfig();

  if (isWelcomeWindow.value) {
    welcomeCloseTimer = window.setTimeout(() => {
      invoke("close_welcome_window").catch(() => {});
    }, 4300);
    return;
  }

  if (isUpdateAnnouncementWindow.value) {
    await refreshUpdateSettings();
    refreshPostUpdateAnnouncementFromConfig();
    if (!postUpdateAnnouncement.version) {
      await acknowledgePostUpdateAnnouncement();
    }
    return;
  }

  await refreshUpdateSettings();
  applyCustomFont();
  await startTableCommentAlignObserver();
  // Load custom skins
  if (isTauriWindow) {
    try {
      customSkins.value = await invoke("list_custom_skins");
      await registerCustomSkins();
    } catch (e) { console.error("Failed to load custom skins:", e); }
  }
  tableDetailView.value = normalizeTableDefaultView(config.personal.table_default_view);

  if (isQuickPasteWindow.value) {
    await loadQuickPasteConfig();
    if (isTauriWindow) {
      await listen("quick-paste-toast", (event) => {
        showQuickPasteToast(String(event.payload || ""), "error");
      }).catch(() => null);
      await listen("quick-paste-copy-image", async (event) => {
        const content = event.payload?.content;
        if (!content) return;
        const snippet = { content, category: "image" };
        await copyQuickPasteImage(snippet);
        await invoke("hide_quick_paste_window").catch(() => {});
      }).catch(() => null);
    }
    return;
  }

  if (isPanelWindow.value) {
    if (isTauriWindow && config.shared.db.host) {
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
    if (isTauriWindow) {
      unlistenBatchImportProgress = await listen("batch-import-progress", (event) => {
        handleBatchImportProgress(event.payload || {});
      });
    }
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

    // ── Weather data + weather engine init ──
    weatherEnabled.value = config.personal.weather_enabled !== false;
    weatherPreviewCategory.value = String(config.personal.weather_skin || "");
    fetchWeather();
    ensureWeatherRefreshTimer();
    if (weatherEnabled.value) {
      themeId.value = 'azure'
      document.documentElement.dataset.theme = 'azure'
      await nextTick();
      initWeatherEngine();
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
      unlistenSyncCenterOpenMode = await listen("sync-center-open-mode", (event) => {
        const payload = event.payload;
        selectSyncCenterMode(typeof payload === "string" ? payload : payload?.mode);
      });
    }
    return;
  }

  if (isArtTextSearchWindow.value) {
    await initArtTextSearchWindow();
    return;
  }

  if (shouldAutoRunStartupUpdateCheck({
    isTauriWindow,
    windowLabel: windowLabel.value,
  })) {
    setTimeout(() => {
      runAppUpdateCheck({ manual: false }).catch(() => {});
    }, 600);
    startPeriodicUpdateCheck();
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
  stopQuickPastePaneResize();
  if (quickPaste.toast.timer) {
    clearTimeout(quickPaste.toast.timer);
    quickPaste.toast.timer = null;
  }
  if (welcomeCloseTimer) {
    clearTimeout(welcomeCloseTimer);
    welcomeCloseTimer = null;
  }
  stopSpriteSheetAnimation();
  destroyWeatherEngine();
  stopWeatherRefreshTimer();
  if (skyTimeTimer) { clearInterval(skyTimeTimer); skyTimeTimer = null; }
  if (tableSortFlashTimer) { clearTimeout(tableSortFlashTimer); tableSortFlashTimer = null; }
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
  if (unlistenSyncCenterOpenMode) {
    unlistenSyncCenterOpenMode();
    unlistenSyncCenterOpenMode = null;
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
  if (unlistenArtTextIndexProgress) {
    unlistenArtTextIndexProgress();
    unlistenArtTextIndexProgress = null;
  }
  if (unlistenArtTextOcrInstallProgress) {
    unlistenArtTextOcrInstallProgress();
    unlistenArtTextOcrInstallProgress = null;
  }
  if (unlistenPetIdleStatesChanged) {
    unlistenPetIdleStatesChanged();
    unlistenPetIdleStatesChanged = null;
  }
  if (unlistenPetIdlePreview) {
    unlistenPetIdlePreview();
    unlistenPetIdlePreview = null;
  }
  if (unlistenBatchImportProgress) {
    unlistenBatchImportProgress();
    unlistenBatchImportProgress = null;
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
  stopPeriodicUpdateCheck();
  disposeAvailableUpdate();
  stopTableTabsCompressionMeasure();
  stopPanelTabsCompressionMeasure();
  stopTableCommentAlignObserver();
  stopTableLayoutObserver();
  if (columnOverflowMeasureRaf) {
    cancelAnimationFrame(columnOverflowMeasureRaf);
    columnOverflowMeasureRaf = 0;
  }
  stopColumnResize();
  stopSchemaColumnResize();
  clearTableTabDragState();
  clearPanelTabDragState();
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

watch(
  () => [
    dbConnected.value,
    panelTabs.value.map((tab) => `${tab.kind}:${tab.tabId || tab.tableName}`).join("|"),
    activeTableTabId.value,
    config.personal.ui_scale,
  ],
  async ([connected]) => {
    if (!connected) {
      stopPanelTabsCompressionMeasure();
      panelTabsCompressed.value = false;
      return;
    }
    await nextTick();
    schedulePanelTabsCompressionMeasure();
    if (activeTableTabId.value) {
      scrollPanelTabIntoView(activeTableTabId.value, "smooth");
    }
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

watch(() => [tableFindKeyword.value, tableFindExact.value], () => {
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
      clearOverflowingColumns();
      return;
    }
    if (tableDetailView.value === "full" && !dataCollapsed.value) {
      startTableLayoutObserver().catch(() => {});
    } else {
      stopTableLayoutObserver();
    }
    scheduleAdaptiveTablePageSize();
    scheduleColumnOverflowMeasure();
  },
);

watch(
  () => [tableView.rows.length, tableView.columns.length, tableView.page],
  () => {
    scheduleAdaptiveTablePageSize();
    scheduleColumnOverflowMeasure();
  },
);

watch(
  () => [tableDetailView.value, hitOnlyDisplayColumns.value.join("|"), hitOnlyRows.value.length],
  () => {
    scheduleColumnOverflowMeasure();
  },
);

watch(columnWidthMap, () => {
  scheduleColumnOverflowMeasure();
}, { deep: true });

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

watch(
  () => [
    showTableResultHeader.value,
    filteredResults.value.length,
    filteredResults.value.find((item) => item?._type === "table")?.table_name || "",
    activeResultTab.value,
    keyword.value,
  ],
  () => {
    startTableCommentAlignObserver().catch(() => {});
  },
  { flush: "post" },
);

watch(() => selectedQuickPasteSnippet.value?.id, () => {
  syncQuickPasteEditorHtml(selectedQuickPasteSnippet.value);
}, { immediate: true, flush: "post" });

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
  if (isEditableTarget(event.target)) {
    armedTitlebarTableShortcut = false;
  }
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
  schedulePanelTabsCompressionMeasure();
  scheduleColumnOverflowMeasure();
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
  const bypassEditableGuard = shouldBypassEditableGuardForArmedTableDialogKey({
    key: event.key,
    code: event.code,
    armed: armedTitlebarTableShortcut,
  });

  if (!isTauriWindow && !event.repeat && isEventMatchingHotkey(event, config.personal.quick_date_hotkey)) {
    if (!resolveEditableTarget(document.activeElement)) return;
    event.preventDefault();
    insertTodayDateToken();
    return;
  }

  if (isPanelShortcut(event, "openTableCommand")) {
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
    (isPanelShortcut(event, "previousSearchTable") || isPanelShortcut(event, "nextSearchTable")) &&
    !isEditableTarget(event.target)
  ) {
    event.preventDefault();
    switchTableByStep(isPanelShortcut(event, "nextSearchTable") ? 1 : -1).catch(() => {});
    return;
  }

  if (tableCommandOpen.value && event.key === "Escape") {
    closeTableCommandPalette();
    return;
  }

  if (tableCommandOpen.value) return;

  if (cellViewerDiscardDialogOpen.value && event.key === "Escape") {
    event.preventDefault();
    cellViewerDiscardDialogOpen.value = false;
    return;
  }

  if (cellViewerOpen.value) {
    if (isPanelShortcut(event, "cellViewerSave") && cellViewer.mode === "edit" && cellViewerCanSave.value) {
      event.preventDefault();
      saveCellViewerChanges();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeCellViewer();
      return;
    }
    if (!isEditableTarget(event.target)) {
      return;
    }
  }

  if (tableOpen.value && editMode.value && isPanelShortcut(event, "editSelectAll") && !isEditableTarget(event.target)) {
    event.preventDefault();
    selectAllPageRows();
    return;
  }

  if (
    tableOpen.value &&
    editMode.value &&
    isPanelShortcut(event, "editCopySelected") &&
    !isEditableTarget(event.target) &&
    editCurrentPageSelectedCount.value > 0
  ) {
    event.preventDefault();
    copySelectedRows().catch(() => {})
    return;
  }

  if (tableOpen.value && editMode.value && isPanelShortcut(event, "editSave")) {
    event.preventDefault();
    confirmCellEdit();
    if (editDirty.value) {
      openSaveDialog();
    }
    return;
  }

  // Grid focus / rectangular selection keys (Navicat-style edit mode).
  // Must run before other table shortcuts so Enter/F2/arrows/letters are
  // consumed while editing, but after modal dialog bails above.
  if (handleGridFocusKeydown(event)) {
    return;
  }

  if (tableOpen.value && isPanelShortcut(event, "openTableFind")) {
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
    !settingsOpen.value &&
    !isEditableTarget(event.target) &&
    (isPanelShortcut(event, "scrollTableLeft") || isPanelShortcut(event, "scrollTableRight"))
  ) {
    const moved = scrollTableContentHorizontally(isPanelShortcut(event, "scrollTableLeft") ? -240 : 240);
    if (moved) {
      event.preventDefault();
    }
    return;
  }

  if (
    !tableOpen.value &&
    !settingsOpen.value &&
    allowPanelShortcut &&
    (
      isPanelShortcut(event, "focusSidebar") ||
      isPanelShortcut(event, "focusResults") ||
      isPanelShortcut(event, "moveUp") ||
      isPanelShortcut(event, "moveDown")
    )
  ) {
    event.preventDefault();
    if (isPanelShortcut(event, "focusSidebar")) {
      navZone.value = "sidebar";
      return;
    }
    if (isPanelShortcut(event, "focusResults")) {
      navZone.value = "results";
      ensureKeyboardResultNav();
      scrollKeyboardResultIntoView();
      return;
    }
    if (navZone.value === "sidebar") {
      moveSidebarTabByStep(isPanelShortcut(event, "moveDown") ? 1 : -1);
      return;
    }
    moveResultNavByStep(isPanelShortcut(event, "moveDown") ? 1 : -1);
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

  if (tableOpen.value && (isPanelShortcut(event, "nextTab") || isPanelShortcut(event, "previousTab"))) {
    event.preventDefault();
    const tabs = tableTabs.value;
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === activeTableTabId.value);
    const next = (idx + (isPanelShortcut(event, "previousTab") ? -1 : 1) + tabs.length) % tabs.length;
    activateTableTab(tabs[next].id).catch(() => {});
    return;
  }

  if (tableOpen.value && isPanelShortcut(event, "toggleTableView")) {
    event.preventDefault();
    toggleTableDetailView();
    return;
  }

  if (
    tableOpen.value &&
    !isEditableTarget(event.target)
  ) {
    if (isPanelShortcut(event, "jumpPreviousHit")) {
      event.preventDefault();
      jumpHitRow(-1).catch(() => {});
      return;
    }
    if (isPanelShortcut(event, "jumpNextHit")) {
      event.preventDefault();
      jumpHitRow(1).catch(() => {});
      return;
    }
    if (isPanelShortcut(event, "toggleEditMode")) {
      event.preventDefault();
      onEditToggleClick();
      return;
    }
  }

  const tableDialogKeyAction = tableOpen.value && !settingsOpen.value && !(isEditableTarget(event.target) && !bypassEditableGuard)
    ? isPanelShortcut(event, "closeTable")
      ? "closeTable"
      : isPanelShortcut(event, "closeAllTables")
        ? "closeAllTables"
        : isPanelShortcut(event, "toggleFullscreen")
          ? "toggleFullscreen"
          : "none"
    : "none";
  if (shouldClearArmedTableDialogShortcutAfterAction(tableDialogKeyAction)) {
    armedTitlebarTableShortcut = false;
  }
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
  if (armedTitlebarTableShortcut && lower && !["control", "shift", "alt", "meta"].includes(lower)) {
    armedTitlebarTableShortcut = false;
  }

  if (!isEditableTarget(event.target) && isEventMatchingHotkey(event, config.personal.always_on_top_hotkey)) {
    event.preventDefault();
    togglePanelAlwaysOnTop().catch(() => {});
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

  if (cellViewerDiscardDialogOpen.value) {
    cellViewerDiscardDialogOpen.value = false;
    return;
  }

  if (cellViewerOpen.value) {
    closeCellViewer();
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

function focusTableSurface() {
  requestAnimationFrame(() => {
    const tableSurface = tableModalRef.value;
    if (tableSurface instanceof HTMLElement) {
      tableSurface.focus({ preventScroll: true });
    }
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

function normalizePanelShortcuts(shortcuts = {}) {
  const source = shortcuts && typeof shortcuts === "object" ? shortcuts : {};
  return Object.fromEntries(
    Object.entries(PANEL_SHORTCUT_DEFAULTS).map(([id, fallback]) => {
      const normalized = normalizeHotkeyDisplay(source[id] || fallback);
      return [id, normalized || fallback];
    }),
  );
}

function getPanelShortcut(id) {
  return config.personal.panel_shortcuts?.[id] || PANEL_SHORTCUT_DEFAULTS[id] || "";
}

function isPanelShortcut(event, id) {
  return isEventMatchingHotkey(event, getPanelShortcut(id));
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

function onPanelShortcutInputKeydown(event, shortcutId) {
  if (event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Backspace" || event.key === "Delete") {
    settingsDraft.panelShortcuts[shortcutId] = "";
    return;
  }

  settingsDraft.panelShortcuts[shortcutId] = buildHotkeyFromEvent(event);
}

function onSyncWindowHotkeyInputKeydown(event) {
  onDraftHotkeyInputKeydown(event, "syncWindowHotkey");
}

function onDbMigrationWindowHotkeyInputKeydown(event) {
  onDraftHotkeyInputKeydown(event, "dbMigrationWindowHotkey");
}

function onQuickPasteOpenHotkeyInputKeydown(event) {
  onDraftHotkeyInputKeydown(event, "quickPasteOpenHotkey");
}

function onQuickPasteOutputHotkeyInputKeydown(event) {
  onDraftHotkeyInputKeydown(event, "quickPasteOutputHotkey");
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
  const target = event.target;
  const interactiveTarget = target instanceof Element && target.closest("button, input, textarea, select, label, a");
  if (shouldFocusPanelShellFromTitlebarPointerDown({
    button: event.button,
    interactiveTarget: Boolean(interactiveTarget),
  })) {
    armedTitlebarTableShortcut = true;
    focusPanelShell();
  }
  if (event.button !== 0 || !isTauriWindow || !isPanelWindow.value) return;
  if (interactiveTarget) return;
  getCurrentWindow().startDragging().catch(() => {});
}

function focusPanelShell() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  const shell = document.getElementById("appShell");
  if (shell instanceof HTMLElement) {
    shell.focus({ preventScroll: true });
    requestAnimationFrame(() => shell.focus({ preventScroll: true }));
    return;
  }
}

function modalHeaderPointerDown(event) {
  const target = event.target;
  const interactiveTarget = target instanceof Element && target.closest("button, input, textarea, select, label, a");
  if (shouldFocusPanelShellFromTitlebarPointerDown({
    button: event.button,
    interactiveTarget: Boolean(interactiveTarget),
  })) {
    armedTitlebarTableShortcut = true;
  }
  if (event.button !== 0) return;
  if (interactiveTarget) return;
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  const tableSurface = event.currentTarget instanceof Element
    ? event.currentTarget.closest(".table-modal")
    : null;
  if (tableSurface instanceof HTMLElement) {
    tableSurface.focus({ preventScroll: true });
    requestAnimationFrame(() => tableSurface.focus({ preventScroll: true }));
  }
  if (!isTauriWindow) return;
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
  settingsDraft.syncWindowHotkey = normalizeSyncWindowHotkey(config.personal.sync_window_hotkey);
  settingsDraft.dbMigrationWindowHotkey = normalizeHotkeyDisplay(config.personal.db_migration_window_hotkey || "Shift+S");
  settingsDraft.quickPasteOpenHotkey = normalizeHotkeyDisplay(config.personal.quick_paste?.open_hotkey || "F7");
  settingsDraft.quickPasteOutputHotkey = normalizeHotkeyDisplay(config.personal.quick_paste?.output_hotkey || "F8");
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
  settingsDraft.panelShortcuts = normalizePanelShortcuts(config.personal.panel_shortcuts);
  settingsDraft.resetOnOpenToAllTables = config.personal.reset_on_open_to_all_tables !== false;
  settingsDraft.templateName = "";
  settingsDraft.petSkin = config.personal.pet_skin || "eagle";
  settingsDraft.petScale = getPetScale(settingsDraft.petSkin);
  settingsDraft.customFont = config.personal.custom_font || null;
  settingsDraft.weatherEnabled = config.personal.weather_enabled !== false;
  weatherPreviewCategory.value = String(config.personal.weather_skin || "");
  settingsDraft.backgroundOpacity = normalizeBackgroundOpacity(config.personal.background_opacity);
  settingsDraft.reduceTransparencyMode = !!config.personal.reduce_transparency_mode;
  settingsDraft.startupWelcomeText = normalizeStartupWelcomeText(config.personal.startup_welcome_text);
  settingsDraft.startupWelcomeMode = normalizeStartupWelcomeMode(config.personal.startup_welcome_mode);
  settingsDraft.autoCheckUpdates = config.personal.auto_check_updates !== false;
  _opacityBeforeSettings = config.personal.background_opacity;
  _reduceTransparencyBeforeSettings = !!config.personal.reduce_transparency_mode;
  _weatherBeforeSettings = weatherEnabled.value;
  _weatherPreviewBeforeSettings = weatherPreviewCategory.value;
  _skyTimeOverrideBeforeSettings = skyTimeOverride.value;
  if (isTauriWindow) {
    invoke("list_system_fonts").then((fonts) => { systemFonts.value = fonts; }).catch(() => {});
  }
  settingsMsg.value = "";
  settingsOpen.value = true;
}

let _opacityBeforeSettings = 1;
let _reduceTransparencyBeforeSettings = false;
let _weatherBeforeSettings = true;
let _weatherPreviewBeforeSettings = "";
let _skyTimeOverrideBeforeSettings = null;

function closeSettings() {
  clearIdlePreview();
  config.personal.background_opacity = _opacityBeforeSettings;
  config.personal.reduce_transparency_mode = _reduceTransparencyBeforeSettings;
  // Restore weather state if toggled during settings without saving
  if (_weatherBeforeSettings !== weatherEnabled.value) {
    weatherEnabled.value = _weatherBeforeSettings;
    fetchWeather();
    ensureWeatherRefreshTimer();
    if (_weatherBeforeSettings) {
      themeId.value = 'azure'
      document.documentElement.dataset.theme = 'azure'
      nextTick().then(() => {
        if (!weatherEngine) {
          initWeatherEngine();
        }
      });
    } else {
      destroyWeatherEngine();
      themeId.value = preferredThemeId.value
      document.documentElement.dataset.theme = preferredThemeId.value
    }
  }
  weatherPreviewCategory.value = _weatherPreviewBeforeSettings;
  skyTimeOverride.value = _skyTimeOverrideBeforeSettings;
  settingsTab.value = -1;
  settingsOpen.value = false;
}

async function testConnect() {
  settingsMsg.value = "连接中...";
  if (String(settingsDraft.host || "").trim().toLowerCase() === "demo") {
    demoDbConnected.value = true;
    dbConnected.value = true;
    dbName.value = settingsDraft.database || "请选择数据库";
    applyDbConfigToShared({
      host: "demo",
      port: Number(settingsDraft.port) || 3306,
      username: settingsDraft.username,
      password: settingsDraft.password,
      database: settingsDraft.database,
    });
    await onDbConnectionChanged({ resetContext: true });
    settingsMsg.value = "✓ 测试数据库连接成功，请在左下角选择数据库";
    return;
  }
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

async function connectDemoDatabase() {
  settingsDraft.host = "demo";
  settingsDraft.port = 3306;
  settingsDraft.username = "";
  settingsDraft.password = "";
  settingsDraft.database = "";
  await testConnect();
}

async function disconnectDatabase() {
  settingsMsg.value = "断开中...";
  try {
    if (!demoDbConnected.value) {
      await invoke("disconnect_db");
    }
    demoDbConnected.value = false;
    dbConnected.value = false;
    dbName.value = "未连接";
    tableOptions.value = [];
    resetContextAfterDbSwitch();
    summaryText.value = "当前数据库未连接";
    closeDatabaseMenu();
    settingsMsg.value = "✓ 已断开连接";
  } catch (error) {
    settingsMsg.value = `✗ 断开失败：${String(error)}`;
  }
}

function stopSettingsSave(message) {
  settingsMsg.value = message;
  settingsSaving.value = false;
}

async function saveSettings() {
  if (settingsSaving.value) return;
  settingsSaving.value = true;
  settingsMsg.value = "保存中...";
  const previousHotkey = config.personal.hotkey;
  const previousQuickDateHotkey = config.personal.quick_date_hotkey;
  const previousSyncWindowHotkey = config.personal.sync_window_hotkey;
  const previousDbMigrationWindowHotkey = config.personal.db_migration_window_hotkey;
  const previousQuickPasteConfig = {
    enabled: config.personal.quick_paste?.enabled ?? true,
    open_hotkey: config.personal.quick_paste?.open_hotkey || "F7",
    output_hotkey: config.personal.quick_paste?.output_hotkey || "F8",
    snippets: Array.isArray(config.personal.quick_paste?.snippets)
      ? config.personal.quick_paste.snippets.map((snippet) => ({ ...snippet }))
      : [],
  };
  applyDbConfigToShared({
    host: settingsDraft.host.trim(),
    port: Number(settingsDraft.port) || 3306,
    username: settingsDraft.username.trim(),
    password: settingsDraft.password,
    database: settingsDraft.database.trim(),
  });

  config.personal.hotkey = normalizeHotkeyDisplay(settingsDraft.hotkey.trim() || "Ctrl+Shift+F");
  config.personal.quick_date_hotkey = normalizeQuickDateHotkey(settingsDraft.quickDateHotkey.trim() || "F9");
  config.personal.sync_window_hotkey = normalizeSyncWindowHotkey(settingsDraft.syncWindowHotkey.trim() || "Shift+D");
  config.personal.db_migration_window_hotkey = normalizeHotkeyDisplay(settingsDraft.dbMigrationWindowHotkey.trim() || "Shift+S");
  config.personal.quick_paste = {
    enabled: previousQuickPasteConfig.enabled,
    open_hotkey: normalizeHotkeyDisplay(settingsDraft.quickPasteOpenHotkey.trim() || "F7"),
    output_hotkey: normalizeHotkeyDisplay(settingsDraft.quickPasteOutputHotkey.trim() || "F8"),
    snippets: previousQuickPasteConfig.snippets,
  };
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
  config.personal.panel_shortcuts = normalizePanelShortcuts(settingsDraft.panelShortcuts);
  if (isModifierOnlyHotkey(config.personal.hotkey)) {
    stopSettingsSave("✗ 快捷键必须包含至少一个非修饰键，例如 Ctrl+Shift+F");
    return;
  }
  if (isModifierOnlyHotkey(config.personal.quick_date_hotkey)) {
    stopSettingsSave("✗ 日期快捷键必须包含至少一个非修饰键，例如 F9");
    return;
  }
  if (config.personal.quick_date_hotkey === config.personal.hotkey) {
    stopSettingsSave("✗ 日期快捷键不能与主快捷键重复");
    return;
  }
  if (isModifierOnlyHotkey(config.personal.sync_window_hotkey)) {
    stopSettingsSave("✗ 同步中心快捷键必须包含至少一个非修饰键，例如 Shift+D");
    return;
  }
  if (isModifierOnlyHotkey(config.personal.db_migration_window_hotkey)) {
    stopSettingsSave("✗ 数据库迁移快捷键必须包含至少一个非修饰键，例如 Shift+S");
    return;
  }
  if (isModifierOnlyHotkey(config.personal.quick_paste.open_hotkey)) {
    stopSettingsSave("✗ 快捷粘贴打开快捷键必须包含至少一个非修饰键，例如 F7");
    return;
  }
  if (isModifierOnlyHotkey(config.personal.quick_paste.output_hotkey)) {
    stopSettingsSave("✗ 快捷粘贴输出快捷键必须包含至少一个非修饰键，例如 F8");
    return;
  }
  if (config.personal.quick_paste.open_hotkey === config.personal.quick_paste.output_hotkey) {
    stopSettingsSave("✗ 快捷粘贴打开和输出快捷键不能重复");
    return;
  }
  if (config.personal.template_prev_hotkey === config.personal.template_next_hotkey) {
    stopSettingsSave("✗ 模板上一快捷键不能与模板下一快捷键重复");
    return;
  }

  const fixedPanelHotkeys = new Set(["Ctrl+P", "Ctrl+O", "Ctrl+[", "Ctrl+]"]);
  if (fixedPanelHotkeys.has(config.personal.template_prev_hotkey) || fixedPanelHotkeys.has(config.personal.template_next_hotkey)) {
    stopSettingsSave("✗ 模板切换快捷键不能与默认面板快捷键冲突");
    return;
  }

  const duplicateCheck = new Map();
  const configurableHotkeys = [
    ["主快捷键", config.personal.hotkey],
    ["日期快捷键", config.personal.quick_date_hotkey],
    ["同步中心快捷键", config.personal.sync_window_hotkey],
    ["数据库迁移快捷键", config.personal.db_migration_window_hotkey],
    ["快捷粘贴打开快捷键", config.personal.quick_paste.open_hotkey],
    ["快捷粘贴输出快捷键", config.personal.quick_paste.output_hotkey],
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
      stopSettingsSave(`✗ ${label}与${duplicateCheck.get(normalizedKey)}重复`);
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
  config.personal.weather_skin = settingsDraft.weatherEnabled ? String(weatherPreviewCategory.value || "") : "";
  config.personal.background_opacity = normalizeBackgroundOpacity(settingsDraft.backgroundOpacity);
  config.personal.reduce_transparency_mode = !!settingsDraft.reduceTransparencyMode;
  config.personal.startup_welcome_text = normalizeStartupWelcomeText(settingsDraft.startupWelcomeText);
  config.personal.startup_welcome_mode = normalizeStartupWelcomeMode(settingsDraft.startupWelcomeMode);
  config.personal.auto_check_updates = !!settingsDraft.autoCheckUpdates;
  weatherEnabled.value = !!settingsDraft.weatherEnabled;
  weatherPreviewCategory.value = config.personal.weather_skin;
  fetchWeather();
  ensureWeatherRefreshTimer();
  if (weatherEnabled.value) {
    themeId.value = 'azure'
    document.documentElement.dataset.theme = 'azure'
    await nextTick();
    if (!weatherEngine) {
      initWeatherEngine();
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
      stopSettingsSave(`✗ 快捷键注册失败：${String(error)}`);
      return;
    }

    try {
      await invoke("register_quick_date_hotkey", { hotkey: config.personal.quick_date_hotkey });
    } catch (error) {
      config.personal.quick_date_hotkey = previousQuickDateHotkey;
      config.personal.hotkey = previousHotkey;
      await invoke("register_hotkey", { hotkey: previousHotkey }).catch(() => {});
      stopSettingsSave(`✗ 日期快捷键注册失败：${String(error)}`);
      return;
    }

    try {
      const registeredSyncHotkey = await invoke("register_sync_window_hotkey", {
        hotkey: config.personal.sync_window_hotkey,
      });
      config.personal.sync_window_hotkey = normalizeSyncWindowHotkey(registeredSyncHotkey);
      syncWorkspaceHotkey.value = config.personal.sync_window_hotkey;
    } catch (error) {
      config.personal.sync_window_hotkey = previousSyncWindowHotkey;
      config.personal.db_migration_window_hotkey = previousDbMigrationWindowHotkey;
      config.personal.quick_date_hotkey = previousQuickDateHotkey;
      config.personal.hotkey = previousHotkey;
      await invoke("register_quick_date_hotkey", { hotkey: previousQuickDateHotkey }).catch(() => {});
      await invoke("register_hotkey", { hotkey: previousHotkey }).catch(() => {});
      stopSettingsSave(`✗ 同步中心快捷键注册失败：${String(error)}`);
      return;
    }

    try {
      const registeredDbMigrationHotkey = await invoke("register_db_migration_window_hotkey", {
        hotkey: config.personal.db_migration_window_hotkey,
      });
      config.personal.db_migration_window_hotkey = normalizeHotkeyDisplay(registeredDbMigrationHotkey);
    } catch (error) {
      config.personal.sync_window_hotkey = previousSyncWindowHotkey;
      config.personal.quick_date_hotkey = previousQuickDateHotkey;
      config.personal.hotkey = previousHotkey;
      await invoke("register_sync_window_hotkey", { hotkey: previousSyncWindowHotkey }).catch(() => {});
      await invoke("register_db_migration_window_hotkey", { hotkey: previousDbMigrationWindowHotkey }).catch(() => {});
      await invoke("register_quick_date_hotkey", { hotkey: previousQuickDateHotkey }).catch(() => {});
      await invoke("register_hotkey", { hotkey: previousHotkey }).catch(() => {});
      stopSettingsSave(`✗ 数据库迁移快捷键注册失败：${String(error)}`);
      return;
    }

    try {
      const registeredQuickPasteConfig = await invoke("save_quick_paste_config", {
        config: config.personal.quick_paste,
      });
      config.personal.quick_paste = {
        enabled: registeredQuickPasteConfig.enabled ?? true,
        open_hotkey: normalizeHotkeyDisplay(registeredQuickPasteConfig.open_hotkey ?? registeredQuickPasteConfig.openHotkey ?? config.personal.quick_paste.open_hotkey),
        output_hotkey: normalizeHotkeyDisplay(registeredQuickPasteConfig.output_hotkey ?? registeredQuickPasteConfig.outputHotkey ?? config.personal.quick_paste.output_hotkey),
        snippets: Array.isArray(registeredQuickPasteConfig.snippets)
          ? registeredQuickPasteConfig.snippets
          : config.personal.quick_paste.snippets,
      };
    } catch (error) {
      config.personal.quick_paste = previousQuickPasteConfig;
      config.personal.sync_window_hotkey = previousSyncWindowHotkey;
      config.personal.db_migration_window_hotkey = previousDbMigrationWindowHotkey;
      config.personal.quick_date_hotkey = previousQuickDateHotkey;
      config.personal.hotkey = previousHotkey;
      await invoke("register_sync_window_hotkey", { hotkey: previousSyncWindowHotkey }).catch(() => {});
      await invoke("register_db_migration_window_hotkey", { hotkey: previousDbMigrationWindowHotkey }).catch(() => {});
      await invoke("register_quick_date_hotkey", { hotkey: previousQuickDateHotkey }).catch(() => {});
      await invoke("register_hotkey", { hotkey: previousHotkey }).catch(() => {});
      await invoke("save_quick_paste_config", { config: previousQuickPasteConfig }).catch(() => {});
      stopSettingsSave(`✗ 快捷粘贴快捷键注册失败：${String(error)}`);
      return;
    }
  }

  config.personal.auto_start = !!settingsDraft.autoStart;
  config.personal.always_on_top = !!settingsDraft.alwaysOnTop;
  if (isTauriWindow) {
    await invoke("set_panel_always_on_top", { alwaysOnTop: config.personal.always_on_top }).catch(() => {});
  }
  try {
    await persistConfig();
  } catch (error) {
    stopSettingsSave(`✗ 保存配置失败：${String(error)}`);
    return;
  }
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

  _opacityBeforeSettings = config.personal.background_opacity;
  _reduceTransparencyBeforeSettings = !!config.personal.reduce_transparency_mode;
  _weatherBeforeSettings = weatherEnabled.value;
  _weatherPreviewBeforeSettings = weatherPreviewCategory.value;
  _skyTimeOverrideBeforeSettings = skyTimeOverride.value;
  applyCustomFont();
  clearIdlePreview();
  settingsOpen.value = false;
  settingsSaving.value = false;

  if (String(config.shared.db.host || "").trim().toLowerCase() === "demo") {
    demoDbConnected.value = true;
    dbConnected.value = true;
    dbName.value = config.shared.db.database || "请选择数据库";
    await onDbConnectionChanged({ resetContext: true });
    return;
  }

  if (isTauriWindow && config.shared.db.host) {
    invoke("connect_db", {
      config: {
        host: config.shared.db.host,
        port: config.shared.db.port,
        username: config.shared.db.username,
        password: config.shared.db.password,
        database: config.shared.db.database,
      },
    })
      .then(() => onDbConnectionChanged())
      .catch(() => refreshConnectionStatus());
  }
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
  if (templateSwitching.value) return false;
  const tpl = config.shared.db_templates[idx];
  if (!tpl) return false;
  if (editMode.value && editDirty.value) {
    const blockedMsg = "当前有未保存编辑，请先保存或放弃后再切换模板";
    settingsMsg.value = `✗ ${blockedMsg}`;
    showCopyToast(blockedMsg, "error");
    return false;
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
    const detail = nextDb.database
      ? `${nextDb.host}:${nextDb.port}/${nextDb.database}`
      : `${nextDb.host}:${nextDb.port}`;
    const msg = `已切换到模板 ${tpl.name}（${detail}）`;
    summaryText.value = msg;
    settingsMsg.value = `✓ ${msg}`;
    showCopyToast(msg, "success");
    return true;
  } catch (e) {
    const errorMsg = `模板切换失败，已保持当前连接：${String(e)}`;
    settingsMsg.value = `✗ ${errorMsg}`;
    showCopyToast(errorMsg, "error");
    return false;
  } finally {
    templateSwitching.value = false;
    templateSwitchingIndex.value = -1;
  }
}

function closeTemplateMenu() {
  templateMenuOpen.value = false;
}

function updateTemplateMenuPosition(event) {
  const width = 280;
  const margin = 8;
  const target = event?.currentTarget;
  let left = Math.max(margin, window.innerWidth - width - 18);
  let bottom = 48;

  if (target instanceof HTMLElement) {
    const rect = target.getBoundingClientRect();
    left = Math.min(
      Math.max(margin, rect.right - width),
      Math.max(margin, window.innerWidth - width - margin),
    );
    bottom = Math.max(margin, window.innerHeight - rect.top + margin);
  }

  templateMenuPosition.left = Math.round(left);
  templateMenuPosition.bottom = Math.round(bottom);
}

function toggleTemplateMenu(event) {
  const list = Array.isArray(config.shared.db_templates) ? config.shared.db_templates : [];
  if (templateSwitching.value) return;
  if (list.length === 0) {
    showCopyToast("暂无可切换模板", "error");
    return;
  }
  if (templateMenuOpen.value) {
    closeTemplateMenu();
    return;
  }
  closeDatabaseMenu();
  updateTemplateMenuPosition(event);
  templateMenuOpen.value = true;
}

async function selectTemplateFromMenu(idx) {
  const switched = await switchToTemplate(idx);
  if (switched) closeTemplateMenu();
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
  const targetRow = document.querySelector(`[data-hit-row-index="${tableView.focusedHitLocalIndex}"]`);
  if (targetRow) {
    targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
    // Also scroll the first hit cell into view horizontally so the hit text is visible on the left.
    const hitCell = targetRow.querySelector("td.hit-cell");
    if (hitCell) {
      hitCell.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    }
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
  tableFindExact.value = false;
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
  tableFindExact.value = false;
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

  const visualScale = normalizeUiScale(config.personal.ui_scale);
  const headerRow = tableEl.querySelector("thead tr");
  const bodyRow = tableEl.querySelector("tbody tr");
  const headerHeight = Math.round(
    headerRow?.getBoundingClientRect?.().height || TABLE_HEADER_HEIGHT_FALLBACK * visualScale,
  );
  const rowHeight = Math.round(
    bodyRow?.getBoundingClientRect?.().height || TABLE_ROW_HEIGHT_FALLBACK * visualScale,
  );
  const visibleHeight = Math.round(wrap.getBoundingClientRect().height || 0);
  return resolveAdaptiveTablePageSize({
    visibleHeight,
    headerHeight,
    rowHeight,
    minRows: TABLE_PAGE_SIZE_MIN,
    maxRows: TABLE_PAGE_SIZE_MAX,
  });
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
    scheduleColumnOverflowMeasure();
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
  const query = tableFindKeyword.value.trim();
  if (!query) {
    tableFindMatches.value = [];
    tableFindCursor.value = -1;
    clearTableFindFocus();
    return;
  }

  await ensureTableFindIndex();
  const matches = tableFindIndex.value.filter((item) => matchTableFindEntry({
    query,
    exact: tableFindExact.value,
    entryType: item?.type || "data",
    text: item?.text || "",
  }));
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

  if (!ensureDatabaseSelectedForSearch()) {
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
  if (!ensureDatabaseSelectedForSearch()) {
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

function renderDataCell(row, columnName, rowIndex = null) {
  const value = Number.isInteger(rowIndex)
    ? resolvePageCellValue(rowIndex, columnName)
    : String(row?.[columnName] ?? "");
  return renderDetailHighlighted(value);
}

function getActiveDataGridColumns() {
  if (!tableOpen.value || dataCollapsed.value) return [];
  if (tableDetailView.value === "hits") return [...hitOnlyDisplayColumns.value];
  return tableView.columns.map((column) => column.column_name);
}

function clearOverflowingColumns() {
  Object.keys(overflowingColumnMap).forEach((key) => { delete overflowingColumnMap[key]; });
}

function getRenderedHeaderCell(columnName) {
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(columnName)
    : String(columnName || "").replace(/"/g, '\\"');
  return tableModalRef.value?.querySelector?.(`th[data-column-name="${escaped}"]`) || null;
}

function getRenderedColumnWidth(columnName) {
  const th = getRenderedHeaderCell(columnName);
  const rect = th?.getBoundingClientRect?.();
  return Math.round(Number(rect?.width) || 0);
}

function getHeaderContentWidth(columnName) {
  const th = getRenderedHeaderCell(columnName);
  const content = th?.querySelector?.(".th-content");
  const styles = content ? window.getComputedStyle(content) : null;
  if (!columnHeaderMeasureCanvas && typeof document !== "undefined") {
    columnHeaderMeasureCanvas = document.createElement("canvas");
  }
  const context = columnHeaderMeasureCanvas?.getContext?.("2d");
  const font = styles
    ? [
        styles.fontStyle,
        styles.fontVariant,
        styles.fontWeight,
        styles.fontSize,
        styles.fontFamily,
      ].filter(Boolean).join(" ")
    : "";
  if (context && font) {
    context.font = font;
  }
  return measureColumnHeaderTextWidth({
    text: columnName,
    measureText: context ? (text) => context.measureText(text).width : null,
  });
}

function replaceColumnCollapseState(nextCollapsedColumns = {}, nextRestoreWidths = {}) {
  applyCollapsedColumnState(nextCollapsedColumns, nextRestoreWidths);
}

function clearColumnCollapseState(columnName) {
  const next = clearCollapsedColumnState({
    columnName,
    collapsedColumns: collapsedColumnMap,
    restoreWidths: collapsedColumnRestoreWidthMap,
  });
  replaceColumnCollapseState(next.nextCollapsedColumns, next.nextRestoreWidths);
}

function handleColumnCollapseToggle(columnName) {
  if (!columnName) return;
  const headerTextWidth = getHeaderContentWidth(columnName);
  if (headerTextWidth <= 0) return;
  const currentWidth = Number(columnWidthMap[columnName] || getRenderedColumnWidth(columnName) || 120);
  const collapsedWidth = computeAutoCollapsedWidth({
    headerTextWidth,
    horizontalPadding: COLUMN_COLLAPSE_HORIZONTAL_PADDING,
    badgeAllowance: COLUMN_COLLAPSE_BADGE_ALLOWANCE,
    resizeHandleAllowance: COLUMN_COLLAPSE_RESIZE_ALLOWANCE,
  });
  const next = toggleColumnCollapsedState({
    columnName,
    currentWidth,
    collapsedWidth,
    collapsedColumns: collapsedColumnMap,
    restoreWidths: collapsedColumnRestoreWidthMap,
    fallbackWidth: currentWidth,
  });
  replaceColumnCollapseState(next.nextCollapsedColumns, next.nextRestoreWidths);
  columnWidthMap[columnName] = next.nextWidth;
  scheduleColumnOverflowMeasure();
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

function getSchemaColumnStyle(columnName) {
  const width = Number(schemaColumnWidthMap[columnName] || 0);
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

function clearSchemaColumnWidths() {
  Object.keys(schemaColumnWidthMap).forEach((key) => { delete schemaColumnWidthMap[key]; });
}

function measureOverflowingColumns() {
  clearOverflowingColumns();
  if (!tableOpen.value || dataCollapsed.value) return;
  const columns = getActiveDataGridColumns();
  if (columns.length === 0) return;
  columns.forEach((columnName) => {
    const headerTextWidth = getHeaderContentWidth(columnName);
    if (headerTextWidth <= 0) return;
    const currentWidth = Number(columnWidthMap[columnName] || getRenderedColumnWidth(columnName) || 0);
    const targetWidth = computeAutoCollapsedWidth({
      headerTextWidth,
      horizontalPadding: COLUMN_COLLAPSE_HORIZONTAL_PADDING,
      badgeAllowance: COLUMN_COLLAPSE_BADGE_ALLOWANCE,
      resizeHandleAllowance: COLUMN_COLLAPSE_RESIZE_ALLOWANCE,
    });
    const visible = shouldShowColumnCollapseBadge({
      currentWidth,
      targetWidth,
      isCollapsed: !!collapsedColumnMap[columnName],
    });
    if (visible) overflowingColumnMap[columnName] = true;
  });
}

function scheduleColumnOverflowMeasure() {
  if (columnOverflowMeasureRaf) {
    cancelAnimationFrame(columnOverflowMeasureRaf);
    columnOverflowMeasureRaf = 0;
  }
  columnOverflowMeasureRaf = requestAnimationFrame(async () => {
    columnOverflowMeasureRaf = 0;
    await nextTick();
    measureOverflowingColumns();
  });
}

function onColumnResizeMove(event) {
  if (!columnResizeState) return;
  const delta = event.clientX - columnResizeState.startX;
  const width = Math.max(80, Math.round(columnResizeState.startWidth + delta));
  columnWidthMap[columnResizeState.columnName] = width;
  scheduleColumnOverflowMeasure();
}

function onSchemaColumnResizeMove(event) {
  if (!schemaColumnResizeState) return;
  const delta = event.clientX - schemaColumnResizeState.startX;
  const width = Math.max(
    SCHEMA_COLUMN_WIDTH_MIN,
    Math.round(schemaColumnResizeState.startWidth + delta),
  );
  schemaColumnWidthMap[schemaColumnResizeState.columnName] = width;
}

function stopColumnResize() {
  window.removeEventListener("pointermove", onColumnResizeMove);
  window.removeEventListener("pointerup", stopColumnResize);
  columnResizeState = null;
}

function stopSchemaColumnResize() {
  window.removeEventListener("pointermove", onSchemaColumnResizeMove);
  window.removeEventListener("pointerup", stopSchemaColumnResize);
  schemaColumnResizeState = null;
}

function startColumnResize(event, columnName) {
  event.preventDefault();
  event.stopPropagation();
  clearColumnCollapseState(columnName);
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

function startSchemaColumnResize(event, columnName) {
  event.preventDefault();
  event.stopPropagation();
  const th = event.currentTarget?.closest?.("th");
  const rect = th?.getBoundingClientRect?.();
  const startWidth = Number(schemaColumnWidthMap[columnName] || rect?.width || 120);
  schemaColumnResizeState = {
    columnName,
    startX: event.clientX,
    startWidth,
  };
  window.addEventListener("pointermove", onSchemaColumnResizeMove);
  window.addEventListener("pointerup", stopSchemaColumnResize);
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
    syncEditSelectionToCurrentPage();
    ensureGridFocusInBounds();
    if (resetFocus) {
      tableView.focusedHitLocalIndex = null;
    }
    if (clearHitCache) {
      hitCollectToken += 1;
      allHitRows.value = [];
      allHitRowsLoading.value = false;
      tableView.hitNavCursor = -1;
    }
    scheduleColumnOverflowMeasure();
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
  clearSchemaColumnWidths();
  clearTableTabDragState();
  stopTableTabsCompressionMeasure();
  tableTabsCompressed.value = false;
  stopTableLayoutObserver();
  stopSchemaColumnResize();
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
  forceCloseCellViewer();
}

// ── 编辑模式：工具函数 ──
function forceCloseCellViewer() {
  cellViewerOpen.value = false
  cellViewerDiscardDialogOpen.value = false
  Object.assign(cellViewer, {
    rowIndex: -1,
    page: tableView.page,
    globalIndex: null,
    columnName: "",
    isInsert: false,
    sourceKind: "page",
    originalText: "",
    draftText: "",
    mode: "preview",
    manualLanguage: "auto",
  })
}

function closeCellViewer() {
  if (cellViewerDirty.value) {
    cellViewerDiscardDialogOpen.value = true
    return
  }
  forceCloseCellViewer()
}

function discardCellViewerChanges() {
  cellViewerDiscardDialogOpen.value = false
  forceCloseCellViewer()
}

function resolvePageCellValue(rowIndex, columnName) {
  const row = tableView.rows[rowIndex]
  if (!row) return ""
  return resolvePendingCellValue({
    row,
    rowKey: computeRowKey(row, rowIndex),
    columnName,
    updates: editChanges.updates,
  })
}

function resolveInsertCellValue(insertIndex, columnName) {
  return String(editChanges.inserts[insertIndex]?.[columnName] ?? "")
}

function openCellViewer({
  rowIndex,
  columnName,
  value,
  page = tableView.page,
  globalIndex = null,
  isInsert = false,
  sourceKind = "page",
} = {}) {
  confirmCellEdit()
  Object.assign(cellViewer, {
    rowIndex,
    page,
    globalIndex,
    columnName,
    isInsert,
    sourceKind,
    originalText: String(value ?? ""),
    draftText: String(value ?? ""),
    mode: "preview",
    manualLanguage: "auto",
  })
  cellViewerDiscardDialogOpen.value = false
  cellViewerOpen.value = true
}

function openPageCellViewer(rowIndex, columnName) {
  openCellViewer({
    rowIndex,
    columnName,
    value: resolvePageCellValue(rowIndex, columnName),
    globalIndex: (tableView.page - 1) * tableView.pageSize + rowIndex + 1,
    sourceKind: "page",
  })
}

function openInsertCellViewer(insertIndex, columnName) {
  openCellViewer({
    rowIndex: insertIndex,
    columnName,
    value: resolveInsertCellValue(insertIndex, columnName),
    isInsert: true,
    sourceKind: "insert",
  })
}

function openHitCellViewer(item, columnName) {
  openCellViewer({
    rowIndex: Number(item?.localIndex ?? -1),
    columnName,
    value: String(item?.row?.[columnName] ?? ""),
    page: Number(item?.page || tableView.page),
    globalIndex: Number.isFinite(Number(item?.globalIndex)) ? Number(item.globalIndex) : null,
    sourceKind: "hit",
  })
}

function resetGridClickEditState() {
  gridPointerDownStartedFocused = false
  gridPointerMovedDuringClick = false
  gridPointerDownTargetIsInput = false
}

function onPageCellClick(event, rowIndex, columnName) {
  // Focus and range are already handled by onGridCellMouseDown.
  // Only commit typing if needed.
  if (!editMode.value) return
  if (shouldStartCellTextEdit({
    editMode: editMode.value,
    startedFocused: gridPointerDownStartedFocused,
    movedDuringPointer: gridPointerMovedDuringClick,
    shiftKey: !!event?.shiftKey,
    targetIsInput: gridPointerDownTargetIsInput,
  })) {
    resetGridClickEditState()
    startCellEdit(rowIndex, columnName)
    return
  }
  resetGridClickEditState()
  commitGridTyping()
}

function onPageCellDoubleClick(rowIndex, columnName) {
  if (editMode.value) {
    startCellEdit(rowIndex, columnName)
    return
  }
  openPageCellViewer(rowIndex, columnName)
}

function onInsertCellClick(event, insertIndex, columnName) {
  if (!editMode.value) return
  if (shouldStartCellTextEdit({
    editMode: editMode.value,
    startedFocused: gridPointerDownStartedFocused,
    movedDuringPointer: gridPointerMovedDuringClick,
    shiftKey: !!event?.shiftKey,
    targetIsInput: gridPointerDownTargetIsInput,
  })) {
    resetGridClickEditState()
    startNewRowCellEdit(insertIndex, columnName)
    return
  }
  resetGridClickEditState()
  commitGridTyping()
}

function onInsertCellDoubleClick(insertIndex, columnName) {
  if (editMode.value) {
    startNewRowCellEdit(insertIndex, columnName)
    return
  }
  openInsertCellViewer(insertIndex, columnName)
}

function onGridCellMouseDown(event, rowKind, rowIndex, columnName) {
  if (!editMode.value) return
  if (event.button !== 0) return
  // Click on inline edit <input> should not start a drag range.
  const target = event.target
  const targetIsInput = target && typeof target.tagName === "string" && target.tagName.toUpperCase() === "INPUT"
  gridPointerDownStartedFocused = isGridFocused(rowKind, rowIndex, columnName)
  gridPointerMovedDuringClick = false
  gridPointerDownTargetIsInput = !!targetIsInput
  if (targetIsInput) return
  if (editingCell.active) confirmCellEdit()
  commitGridTyping()
  // Extend selection on Shift+click.
  if (event.shiftKey && hasActiveGridFocus()) {
    gridRange.anchor = gridRange.anchor || {
      rowKind: gridFocus.rowKind,
      rowIndex: gridFocus.rowIndex,
      columnName: gridFocus.columnName,
    }
    gridRange.head = { rowKind, rowIndex, columnName }
    setGridFocus(rowKind, rowIndex, columnName)
    return
  }
  // Start a new rectangular drag.
  clearGridRange()
  setGridFocus(rowKind, rowIndex, columnName)
  gridRange.anchor = { rowKind, rowIndex, columnName }
  gridRange.head = { rowKind, rowIndex, columnName }
  setEditSelectedRowKeys([])
  gridRangeDragging = true
  // Release the drag on mouseup anywhere.
  const onUp = () => {
    gridRangeDragging = false
    window.removeEventListener("mouseup", onUp, true)
  }
  window.addEventListener("mouseup", onUp, true)
}

function onGridCellMouseEnter(event, rowKind, rowIndex, columnName) {
  if (!editMode.value) return
  if (!gridRangeDragging) return
  if (!gridRange.anchor) return
  gridPointerMovedDuringClick = true
  gridRange.head = { rowKind, rowIndex, columnName }
  setGridFocus(rowKind, rowIndex, columnName)
}

function onHitCellDoubleClick(item, columnName) {
  openHitCellViewer(item, columnName)
}

function focusCellViewerEditor() {
  nextTick(() => {
    const el = document.getElementById("cell-viewer-editor")
    if (el) el.focus()
  })
}

function enterCellViewerEditMode() {
  if (!cellViewerEditSupported.value) return
  cellViewer.mode = "edit"
  focusCellViewerEditor()
}

function requestEditModeAccess(onSuccess) {
  if (editMode.value) {
    onSuccess()
    return
  }
  if (offlineDemoMode.value) {
    onSuccess()
    return
  }
  editDateSuccessCallback.value = onSuccess
  editDateInput.value = ""
  editDateError.value = false
  editDateDialogOpen.value = true
  nextTick(() => document.getElementById("edit-date-input")?.focus())
}

function closeEditDateDialog() {
  editDateDialogOpen.value = false
  editDateSuccessCallback.value = null
}

function startCellViewerEditing() {
  if (!cellViewerEditSupported.value) return
  requestEditModeAccess(() => {
    enterCellViewerEditMode()
  })
}

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

function applyRowCellChange(rowIndex, columnName, nextValue) {
  const row = tableView.rows[rowIndex]
  if (!row) return false
  const key = computeRowKey(row, rowIndex)
  if (editChanges.deletes.has(key)) return false
  setPendingCellChange({
    updates: editChanges.updates,
    rowKey: key,
    row,
    columns: tableView.columns,
    primaryKeys: getTablePrimaryKeys(),
    columnName,
    nextValue,
  })
  recomputeEditDirty()
  return true
}

function applyInsertCellChange(insertIndex, columnName, nextValue) {
  if (!editChanges.inserts[insertIndex]) return false
  editChanges.inserts[insertIndex][columnName] = nextValue
  recomputeEditDirty()
  return true
}

function saveCellViewerChanges() {
  if (!editMode.value) return
  const nextValue = cellViewer.draftText
  let changed = false
  if (cellViewer.isInsert) {
    changed = applyInsertCellChange(cellViewer.rowIndex, cellViewer.columnName, nextValue)
  } else if (cellViewer.sourceKind === "page" || (cellViewer.sourceKind === "hit" && cellViewer.page === tableView.page)) {
    changed = applyRowCellChange(cellViewer.rowIndex, cellViewer.columnName, nextValue)
  }
  if (!changed) return
  cellViewer.originalText = nextValue
  showCopyToast("单元格内容已更新，记得保存更改", "success")
  forceCloseCellViewer()
}

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
    requestEditModeAccess(() => {
      enterEditMode()
    })
  }
}
function validateEditDate() {
  const today = new Date()
  const expected = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
  if (editDateInput.value === expected) {
    editDateDialogOpen.value = false
    const callback = editDateSuccessCallback.value
    editDateSuccessCallback.value = null
    if (callback) callback()
    else enterEditMode()
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
  editSelectedRows.value = new Set()
  editSelectionAnchorIndex.value = -1
  editBatchColumn.value = ""
  editBatchValue.value = ""
  editDirty.value = false
  clearGridFocus()
  clearGridRange()
  gridTypingBuffer.value = ""
  gridTypingActive.value = false
  editUndoStack.value = []
  editRedoStack.value = []
  textPanelDirty.value = false
  textPanelDraft.value = ""
  textPanelOriginal.value = ""
  textPanelFocusKey.value = ""
  Object.assign(editingCell, { active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
}
function enterEditMode() {
  resetEditChanges()
  tableDetailView.value = "full"
  dataCollapsed.value = false
  editMode.value = true
  editNoPkWarningShown.value = !hasTablePrimaryKey()
  triggerEditGlow()
  nextTick(() => {
    startTableLayoutObserver().catch(() => {})
    scheduleAdaptiveTablePageSize()
    initGridFocusIfNeeded()
  })
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
  const original = resolvePageCellValue(rowIndex, columnName)
  Object.assign(editingCell, { active: true, rowIndex, columnName, originalValue: original, currentValue: original })
  editMirrorSelection.start = original.length
  editMirrorSelection.end = original.length
  nextTick(() => {
    if (textPanelOpen.value) {
      const ta = tableModalRef.value && tableModalRef.value.querySelector(".edit-text-panel__textarea")
      if (ta) { ta.focus(); const len = original.length; ta.setSelectionRange(len, len) }
    } else {
      const el = document.getElementById('edit-cell-input')
      if (el) { el.focus(); el.select() }
    }
  })
}
function confirmCellEdit() {
  if (!editingCell.active) return
  // Safety net: read the raw DOM value in case v-model is still awaiting a
  // compositionend / IME flush. Covers bug scan #1 (blur-before-keydown race).
  const inputEl = document.getElementById("edit-cell-input")
  if (inputEl && typeof inputEl.value === "string" && inputEl.value !== editingCell.currentValue) {
    editingCell.currentValue = inputEl.value
  }
  const { rowIndex, columnName, originalValue, currentValue } = editingCell
  if (currentValue !== originalValue) {
    pushUndoSnapshot({
      kind: "cells",
      entries: [{
        rowKind: "page",
        rowIndex,
        columnName,
        prevValue: String(originalValue ?? ""),
      }],
    })
    applyRowCellChange(rowIndex, columnName, currentValue)
  }
  Object.assign(editingCell, { active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
}
function cancelCellEdit() {
  Object.assign(editingCell, { active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
}
function getEditColumnNames() {
  return tableView.columns.map(c => c.column_name).filter(Boolean)
}
function navigatePageCellAfterConfirm(action) {
  const target = resolveEditNavigation({
    rowIndex: editingCell.rowIndex,
    columnName: editingCell.columnName,
    columns: getEditColumnNames(),
    rowCount: tableView.rows.length,
    action,
  })
  confirmCellEdit()
  if (target) {
    nextTick(() => startCellEdit(target.rowIndex, target.columnName))
  }
}
function navigateInsertCellAfterConfirm(insertIdx, action) {
  const target = resolveEditNavigation({
    rowIndex: insertIdx,
    columnName: editingCell.columnName,
    columns: getEditColumnNames(),
    rowCount: editChanges.inserts.length,
    action,
  })
  confirmNewRowCellEdit(insertIdx)
  if (target) {
    nextTick(() => startNewRowCellEdit(target.rowIndex, target.columnName))
  }
}
function openActivePageCellViewer() {
  if (!editingCell.active) return
  const rowIndex = editingCell.rowIndex
  const columnName = editingCell.columnName
  confirmCellEdit()
  openPageCellViewer(rowIndex, columnName)
}
function openActiveInsertCellViewer(insertIdx) {
  if (!editingCell.active) return
  const columnName = editingCell.columnName
  confirmNewRowCellEdit(insertIdx)
  openInsertCellViewer(insertIdx, columnName)
}
function requestSaveFromCellEdit(confirmActiveEdit) {
  confirmActiveEdit()
  if (editDirty.value) {
    openSaveDialog()
  }
}
function onCellEditKeydown(e) {
  const lower = String(e.key || "").toLowerCase()
  const withPrimary = e.ctrlKey || e.metaKey
  if (withPrimary && !e.altKey && lower === "enter") {
    e.preventDefault()
    e.stopPropagation()
    openActivePageCellViewer()
    return
  }
  if (withPrimary && !e.altKey && lower === "s") {
    e.preventDefault()
    e.stopPropagation()
    requestSaveFromCellEdit(confirmCellEdit)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    navigatePageCellAfterConfirm(e.shiftKey ? "shift-enter" : "enter")
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    cancelCellEdit()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    navigatePageCellAfterConfirm(e.shiftKey ? "shift-tab" : "tab")
  }
}
function startNewRowCellEdit(insertIdx, columnName) {
  if (!editMode.value) return
  const original = String(editChanges.inserts[insertIdx]?.[columnName] ?? '')
  // Use a special index for new rows: offset by existing rows count
  const specialIdx = tableView.rows.length + insertIdx
  Object.assign(editingCell, { active: true, rowIndex: specialIdx, columnName, originalValue: original, currentValue: original })
  editMirrorSelection.start = original.length
  editMirrorSelection.end = original.length
  nextTick(() => {
    if (textPanelOpen.value) {
      const ta = tableModalRef.value && tableModalRef.value.querySelector(".edit-text-panel__textarea")
      if (ta) { ta.focus(); const len = original.length; ta.setSelectionRange(len, len) }
    } else {
      const el = document.getElementById('edit-cell-input')
      if (el) { el.focus(); el.select() }
    }
  })
}
function confirmNewRowCellEdit(insertIdx) {
  if (!editingCell.active) return
  // Mirror confirmCellEdit: capture the DOM value as a safety net for IME
  // compositionend races (bug scan #1).
  const inputEl = document.getElementById("edit-cell-input")
  if (inputEl && typeof inputEl.value === "string" && inputEl.value !== editingCell.currentValue) {
    editingCell.currentValue = inputEl.value
  }
  const { columnName, originalValue, currentValue } = editingCell
  if (currentValue !== originalValue) {
    pushUndoSnapshot({
      kind: "cells",
      entries: [{
        rowKind: "insert",
        rowIndex: insertIdx,
        columnName,
        prevValue: String(originalValue ?? ""),
      }],
    })
  }
  applyInsertCellChange(insertIdx, columnName, currentValue)
  Object.assign(editingCell, { active: false, rowIndex: -1, columnName: '', originalValue: '', currentValue: '' })
}
function onNewRowCellEditKeydown(e, insertIdx) {
  const lower = String(e.key || "").toLowerCase()
  const withPrimary = e.ctrlKey || e.metaKey
  if (withPrimary && !e.altKey && lower === "enter") {
    e.preventDefault()
    e.stopPropagation()
    openActiveInsertCellViewer(insertIdx)
    return
  }
  if (withPrimary && !e.altKey && lower === "s") {
    e.preventDefault()
    e.stopPropagation()
    requestSaveFromCellEdit(() => confirmNewRowCellEdit(insertIdx))
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    navigateInsertCellAfterConfirm(insertIdx, e.shiftKey ? "shift-enter" : "enter")
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    cancelCellEdit()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    navigateInsertCellAfterConfirm(insertIdx, e.shiftKey ? "shift-tab" : "tab")
  }
}

// ── 编辑模式：行操作 ──
function setEditSelectedRowKeys(keys = []) {
  // Whole-Set replacement: assign a new Set so the ref triggers template
  // dependents in one step. Avoids the `.clear()` + `.add()` race that caused
  // checkbox :checked bindings to miss updates.
  const next = new Set()
  for (const key of (Array.isArray(keys) ? keys : [])) {
    if (key) next.add(key)
  }
  editSelectedRows.value = next
}
function syncEditSelectionToCurrentPage() {
  const current = new Set(editPageRowKeys.value)
  const deleted = new Set(editDeletedRowKeys.value)
  const next = [...editSelectedRows.value].filter((key) => current.has(key) && !deleted.has(key))
  if (next.length !== editSelectedRows.value.size) {
    setEditSelectedRowKeys(next)
  }
  // Always clear the Shift-click anchor when page data changes. The anchor
  // stores a row *index* from the previous page; if we keep it across a page
  // switch a subsequent Shift-click can select a contiguous range centred on
  // the wrong row. See docs/plans/实现计划 — Navicat 风格编辑模式升级.md
  // (bug scan #2: pagination anchor drift).
  editSelectionAnchorIndex.value = -1
}
function toggleRowSelection(idx, event = {}) {
  confirmCellEdit()
  const result = resolveRowSelection({
    rowKeys: editPageRowKeys.value,
    selectedKeys: [...editSelectedRows.value],
    deletedKeys: editDeletedRowKeys.value,
    rowIndex: idx,
    anchorIndex: editSelectionAnchorIndex.value,
    shiftKey: !!event.shiftKey,
    additiveKey: !event.shiftKey || !!event.ctrlKey || !!event.metaKey,
  })
  setEditSelectedRowKeys(result.selectedKeys)
  editSelectionAnchorIndex.value = result.anchorIndex
}

function selectWholeRow(idx, event = {}) {
  commitGridTyping()
  const columns = getEditColumnNames()
  if (columns.length === 0) return
  // Shift+click: extend range from existing anchor row to this row.
  if (event.shiftKey && gridRange.anchor && gridRange.anchor.rowKind === "page") {
    gridRange.head = { rowKind: "page", rowIndex: idx, columnName: columns[columns.length - 1] }
    setGridFocus("page", idx, columns[0])
  } else if (event.ctrlKey || event.metaKey) {
    // Ctrl+click: keep existing range, just toggle row selection.
    setGridFocus("page", idx, columns[0])
    gridRange.anchor = { rowKind: "page", rowIndex: idx, columnName: columns[0] }
    gridRange.head = { rowKind: "page", rowIndex: idx, columnName: columns[columns.length - 1] }
  } else {
    setGridFocus("page", idx, columns[0])
    gridRange.anchor = { rowKind: "page", rowIndex: idx, columnName: columns[0] }
    gridRange.head = { rowKind: "page", rowIndex: idx, columnName: columns[columns.length - 1] }
  }
  // Also add to row selection for Ctrl+C / batch operations.
  const row = tableView.rows[idx]
  const rowKey = row ? computeRowKey(row, idx) : ""
  if (rowKey && !editChanges.deletes.has(rowKey)) {
    if (event.shiftKey && editSelectionAnchorIndex.value >= 0) {
      const result = resolveRowSelection({
        rowKeys: editPageRowKeys.value,
        selectedKeys: [...editSelectedRows.value],
        deletedKeys: editDeletedRowKeys.value,
        rowIndex: idx,
        anchorIndex: editSelectionAnchorIndex.value,
        shiftKey: true,
        additiveKey: !!event.ctrlKey || !!event.metaKey,
      })
      setEditSelectedRowKeys(result.selectedKeys)
      editSelectionAnchorIndex.value = result.anchorIndex
    } else if (event.ctrlKey || event.metaKey) {
      const result = resolveRowSelection({
        rowKeys: editPageRowKeys.value,
        selectedKeys: [...editSelectedRows.value],
        deletedKeys: editDeletedRowKeys.value,
        rowIndex: idx,
        anchorIndex: editSelectionAnchorIndex.value,
        shiftKey: false,
        additiveKey: true,
      })
      setEditSelectedRowKeys(result.selectedKeys)
      editSelectionAnchorIndex.value = result.anchorIndex
    } else {
      setEditSelectedRowKeys([rowKey])
      editSelectionAnchorIndex.value = idx
    }
  }
}

function selectWholeInsertRow(nIdx, event = {}) {
  commitGridTyping()
  const columns = getEditColumnNames()
  if (columns.length === 0) return
  if (event.shiftKey && gridRange.anchor && gridRange.anchor.rowKind === "insert") {
    gridRange.head = { rowKind: "insert", rowIndex: nIdx, columnName: columns[columns.length - 1] }
    setGridFocus("insert", nIdx, columns[0])
  } else {
    setGridFocus("insert", nIdx, columns[0])
    gridRange.anchor = { rowKind: "insert", rowIndex: nIdx, columnName: columns[0] }
    gridRange.head = { rowKind: "insert", rowIndex: nIdx, columnName: columns[columns.length - 1] }
  }
}

let rowHandleDragging = false

function onRowHandleMouseDown(idx, rowKind) {
  commitGridTyping()
  const columns = getEditColumnNames()
  if (columns.length === 0) return
  setGridFocus(rowKind, idx, columns[0])
  gridRange.anchor = { rowKind, rowIndex: idx, columnName: columns[0] }
  gridRange.head = { rowKind, rowIndex: idx, columnName: columns[columns.length - 1] }
  if (rowKind === "page") {
    const row = tableView.rows[idx]
    const rowKey = row ? computeRowKey(row, idx) : ""
    if (rowKey && !editChanges.deletes.has(rowKey)) {
      setEditSelectedRowKeys([rowKey])
      editSelectionAnchorIndex.value = idx
    }
  }
  rowHandleDragging = true
  const onUp = () => {
    rowHandleDragging = false
    window.removeEventListener("mouseup", onUp, true)
  }
  window.addEventListener("mouseup", onUp, true)
}

function onRowHandleMouseEnter(idx, rowKind) {
  if (!rowHandleDragging) return
  if (!gridRange.anchor || gridRange.anchor.rowKind !== rowKind) return
  const columns = getEditColumnNames()
  if (columns.length === 0) return
  gridRange.head = { rowKind, rowIndex: idx, columnName: columns[columns.length - 1] }
  setGridFocus(rowKind, idx, columns[0])
  // Update row selection for page rows.
  if (rowKind === "page") {
    const startRow = Math.min(gridRange.anchor.rowIndex, idx)
    const endRow = Math.max(gridRange.anchor.rowIndex, idx)
    const keys = []
    for (let r = startRow; r <= endRow; r++) {
      const row = tableView.rows[r]
      const rowKey = row ? computeRowKey(row, r) : ""
      if (rowKey && !editChanges.deletes.has(rowKey)) keys.push(rowKey)
    }
    setEditSelectedRowKeys(keys)
  }
}

function toggleSelectAll() {
  confirmCellEdit()
  setEditSelectedRowKeys(resolveSelectAllRowKeys({
    rowKeys: editPageRowKeys.value,
    selectedKeys: [...editSelectedRows.value],
    deletedKeys: editDeletedRowKeys.value,
  }))
  editSelectionAnchorIndex.value = editSelectedRows.value.size > 0 ? 0 : -1
}
function selectAllPageRows() {
  confirmCellEdit()
  setEditSelectedRowKeys(resolveSelectAllRowKeys({
    rowKeys: editPageRowKeys.value,
    selectedKeys: [],
    deletedKeys: editDeletedRowKeys.value,
  }))
  editSelectionAnchorIndex.value = editSelectedRows.value.size > 0 ? 0 : -1
}
async function copySelectedRows() {
  confirmCellEdit()
  const text = buildSelectedRowsTsv({
    rows: tableView.rows,
    columns: getEditColumnNames(),
    rowKeys: editPageRowKeys.value,
    selectedKeys: [...editSelectedRows.value],
  })
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    showCopyToast(`已复制 ${editCurrentPageSelectedCount.value} 行`, "success")
  } catch {
    showCopyToast("复制失败", "error")
  }
}
function applyBatchEditToSelectedRows() {
  confirmCellEdit()
  const changes = buildBatchCellChanges({
    rowKeys: editPageRowKeys.value,
    selectedKeys: [...editSelectedRows.value],
    deletedKeys: editDeletedRowKeys.value,
    columnName: editBatchColumn.value,
    value: editBatchValue.value,
  })
  if (changes.length === 0) return
  changes.forEach(({ rowKey, columnName, value }) => {
    const rowIndex = tableView.rows.findIndex((row, idx) => computeRowKey(row, idx) === rowKey)
    if (rowIndex >= 0) applyRowCellChange(rowIndex, columnName, value)
  })
  showCopyToast(`已批量修改 ${changes.length} 行`, "success")
}
function hasNonEmptyInserts() {
  return editChanges.inserts.some(r => Object.values(r).some(v => v !== ''))
}
function recomputeEditDirty() {
  editDirty.value = editChanges.updates.size > 0 || hasNonEmptyInserts() || editChanges.deletes.size > 0
}
function addNewRow() {
  const newRow = {}
  tableView.columns.forEach(c => { newRow[c.column_name] = '' })
  editChanges.inserts.push(newRow)
  recomputeEditDirty()
}
function removeNewRow(insertIdx) {
  editChanges.inserts.splice(insertIdx, 1)
  recomputeEditDirty()
}
function deleteSelectedRows() {
  confirmCellEdit()
  const pageKeys = []
  const prevUpdates = {}
  for (const key of [...editSelectedRows.value]) {
    if (editChanges.deletes.has(key)) continue
    pageKeys.push(key)
    if (editChanges.updates.has(key)) {
      const prev = editChanges.updates.get(key)
      prevUpdates[key] = {
        whereKeys: { ...(prev.whereKeys || {}) },
        changes: { ...(prev.changes || {}) },
      }
    }
    editChanges.deletes.add(key)
    // Remove any pending updates for deleted rows
    editChanges.updates.delete(key)
  }
  if (pageKeys.length > 0) {
    pushDeleteUndoSnapshot({ pageKeys, insertEntries: [], prevUpdates })
  }
  editSelectedRows.value = new Set()
  editSelectionAnchorIndex.value = -1
  editDirty.value = true
}
function isRowDeleted(row, idx) {
  return editChanges.deletes.has(computeRowKey(row, idx))
}
function isRowSelected(row, idx) {
  return editSelectedRows.value.has(computeRowKey(row, idx))
}
function isRowModified(row, idx) {
  return editChanges.updates.has(computeRowKey(row, idx))
}
function isCellModified(row, idx, columnName) {
  const key = computeRowKey(row, idx)
  const upd = editChanges.updates.get(key)
  return upd ? columnName in upd.changes : false
}

// ── 编辑模式：网格焦点 + 矩形选区 ──

function getEditGridCounts() {
  return {
    pageCount: Array.isArray(tableView.rows) ? tableView.rows.length : 0,
    insertCount: Array.isArray(editChanges.inserts) ? editChanges.inserts.length : 0,
  }
}

function hasActiveGridFocus() {
  return gridFocus.rowKind === "page" || gridFocus.rowKind === "insert"
}

function setGridFocus(rowKind, rowIndex, columnName) {
  gridFocus.rowKind = rowKind
  gridFocus.rowIndex = rowIndex
  gridFocus.columnName = columnName
}

function clearGridFocus() {
  gridFocus.rowKind = null
  gridFocus.rowIndex = -1
  gridFocus.columnName = ""
}

function clearGridRange() {
  gridRange.anchor = null
  gridRange.head = null
  gridRangeDragging = false
}

function isGridFocused(rowKind, rowIndex, columnName) {
  return editMode.value
    && gridFocus.rowKind === rowKind
    && gridFocus.rowIndex === rowIndex
    && gridFocus.columnName === columnName
}

function isCellInGridRange(rowKind, rowIndex, columnName) {
  if (!editMode.value) return false
  if (!gridRange.anchor || !gridRange.head) return false
  const anchor = gridRange.anchor
  const head = gridRange.head
  // Cross-kind range: anchor in page, head in insert (or vice versa).
  if (anchor.rowKind !== head.rowKind) {
    const columns = getEditColumnNames()
    const colIdx = columns.indexOf(String(columnName || ""))
    if (colIdx < 0) return false
    const colA = columns.indexOf(String(anchor.columnName || ""))
    const colB = columns.indexOf(String(head.columnName || ""))
    const colStart = Math.min(colA >= 0 ? colA : 0, colB >= 0 ? colB : 0)
    const colEnd = Math.max(colA >= 0 ? colA : 0, colB >= 0 ? colB : 0)
    if (colIdx < colStart || colIdx > colEnd) return false
    if (anchor.rowKind === "page" && head.rowKind === "insert") {
      if (rowKind === "page") return rowIndex >= anchor.rowIndex
      if (rowKind === "insert") return rowIndex <= head.rowIndex
    }
    if (anchor.rowKind === "insert" && head.rowKind === "page") {
      if (rowKind === "page") return rowIndex >= head.rowIndex
      if (rowKind === "insert") return rowIndex <= anchor.rowIndex
    }
    return false
  }
  const range = getNormalizedGridRange()
  if (!range) return false
  if (range.rowKind !== rowKind) return false
  if (rowIndex < range.rowStart || rowIndex > range.rowEnd) return false
  const colIdx = range.columns.indexOf(String(columnName || ""))
  if (colIdx < 0) return false
  return colIdx >= range.colStart && colIdx <= range.colEnd
}

function getNormalizedGridRange() {
  if (!gridRange.anchor) return null
  const { pageCount, insertCount } = getEditGridCounts()
  return normalizeRange({
    anchor: gridRange.anchor,
    head: gridRange.head || gridRange.anchor,
    columns: getEditColumnNames(),
    pageCount,
    insertCount,
  })
}

function getEffectiveGridRange() {
  // Range used by batch operations. Falls back to the focus cell alone when
  // no multi-cell selection is active.
  const range = getNormalizedGridRange()
  if (range) return range
  if (!hasActiveGridFocus()) return null
  const { pageCount, insertCount } = getEditGridCounts()
  return normalizeRange({
    anchor: { rowKind: gridFocus.rowKind, rowIndex: gridFocus.rowIndex, columnName: gridFocus.columnName },
    head: { rowKind: gridFocus.rowKind, rowIndex: gridFocus.rowIndex, columnName: gridFocus.columnName },
    columns: getEditColumnNames(),
    pageCount,
    insertCount,
  })
}

function ensureGridFocusInBounds() {
  const { pageCount, insertCount } = getEditGridCounts()
  const columns = getEditColumnNames()
  if (columns.length === 0 || (pageCount === 0 && insertCount === 0)) {
    clearGridFocus()
    clearGridRange()
    return
  }
  if (!hasActiveGridFocus()) return
  const clamped = clampFocus({
    rowKind: gridFocus.rowKind,
    rowIndex: gridFocus.rowIndex,
    columnName: gridFocus.columnName,
    columns,
    pageRowCount: pageCount,
    insertRowCount: insertCount,
  })
  if (!clamped) {
    clearGridFocus()
    clearGridRange()
    return
  }
  setGridFocus(clamped.rowKind, clamped.rowIndex, clamped.columnName)
}

function initGridFocusIfNeeded() {
  if (hasActiveGridFocus()) return
  const columns = getEditColumnNames()
  const { pageCount, insertCount } = getEditGridCounts()
  if (columns.length === 0) return
  if (pageCount > 0) setGridFocus("page", 0, columns[0])
  else if (insertCount > 0) setGridFocus("insert", 0, columns[0])
}

// ── 编辑模式：撤销栈（Ctrl+Z） ──

function pushUndoSnapshot(snapshot) {
  if (!snapshot) return
  const stack = editUndoStack.value.slice()
  stack.push(snapshot)
  while (stack.length > EDIT_UNDO_LIMIT) stack.shift()
  editUndoStack.value = stack
  editRedoStack.value = []
}

function captureCellsUndoEntries(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return []
  return changes
    .filter(Boolean)
    .map(({ rowKind, rowIndex, columnName }) => ({
      rowKind,
      rowIndex,
      columnName,
      prevValue: readGridCellValue(rowKind, rowIndex, columnName),
    }))
}

function pushCellsUndoSnapshot(changes) {
  const entries = captureCellsUndoEntries(changes)
  if (entries.length === 0) return
  pushUndoSnapshot({ kind: "cells", entries })
}

function pushInsertUndoSnapshot(insertIndex) {
  if (!Number.isInteger(insertIndex)) return
  pushUndoSnapshot({ kind: "insert", insertIndex })
}

function pushDeleteUndoSnapshot({ pageKeys = [], insertEntries = [], prevUpdates = {} } = {}) {
  const pagesArr = Array.from(pageKeys || [])
  const insertsArr = Array.isArray(insertEntries) ? insertEntries.slice() : []
  if (pagesArr.length === 0 && insertsArr.length === 0) return
  pushUndoSnapshot({
    kind: "delete",
    pageKeys: pagesArr,
    insertEntries: insertsArr,
    prevUpdates,
  })
}

function undoLastEditChange() {
  if (!editMode.value) return false
  commitGridTyping({ cancel: true })
  const stack = editUndoStack.value.slice()
  if (stack.length === 0) {
    showCopyToast("没有可撤销的操作", "info")
    return false
  }
  const snap = stack.pop()
  editUndoStack.value = stack
  try {
    if (snap.kind === "cells") {
      // Capture current values for redo before restoring.
      const redoEntries = snap.entries.map(entry => ({
        rowKind: entry.rowKind,
        rowIndex: entry.rowIndex,
        columnName: entry.columnName,
        prevValue: readGridCellValue(entry.rowKind, entry.rowIndex, entry.columnName),
      }))
      for (const entry of snap.entries) {
        if (entry.rowKind === "page") {
          applyRowCellChange(entry.rowIndex, entry.columnName, entry.prevValue)
        } else if (entry.rowKind === "insert") {
          applyInsertCellChange(entry.rowIndex, entry.columnName, entry.prevValue)
        }
      }
      editRedoStack.value = [...editRedoStack.value, { kind: "cells", entries: redoEntries }]
      syncTextPanelAfterGridMutation()
      showCopyToast(`已撤销 ${snap.entries.length} 格修改`, "success")
      return true
    }
    if (snap.kind === "insert") {
      if (snap.insertIndex >= 0 && snap.insertIndex < editChanges.inserts.length) {
        const removedRow = { ...editChanges.inserts[snap.insertIndex] }
        editChanges.inserts.splice(snap.insertIndex, 1)
        editDirty.value = editChanges.updates.size > 0
          || hasNonEmptyInserts()
          || editChanges.deletes.size > 0
        ensureGridFocusInBounds()
        editRedoStack.value = [...editRedoStack.value, { kind: "insert", insertIndex: snap.insertIndex, row: removedRow }]
        syncTextPanelAfterGridMutation()
        showCopyToast("已撤销新增行", "success")
      }
      return true
    }
    if (snap.kind === "delete") {
      // Page-row deletes live in editChanges.deletes — just remove keys.
      for (const key of snap.pageKeys) {
        editChanges.deletes.delete(key)
        if (snap.prevUpdates && Object.prototype.hasOwnProperty.call(snap.prevUpdates, key)) {
          const prev = snap.prevUpdates[key]
          editChanges.updates.set(key, {
            whereKeys: { ...(prev.whereKeys || {}) },
            changes: { ...(prev.changes || {}) },
          })
        }
      }
      // Insert-row deletes were spliced — restore them at their original
      // indices, lowest index first so later ones don't shift.
      const sortedInserts = snap.insertEntries
        .slice()
        .sort((a, b) => a.index - b.index)
      for (const entry of sortedInserts) {
        const idx = Math.min(entry.index, editChanges.inserts.length)
        editChanges.inserts.splice(idx, 0, { ...entry.row })
      }
      editDirty.value = editChanges.updates.size > 0
        || hasNonEmptyInserts()
        || editChanges.deletes.size > 0
      editRedoStack.value = [...editRedoStack.value, { kind: "delete", pageKeys: snap.pageKeys, insertEntries: snap.insertEntries, prevUpdates: snap.prevUpdates }]
      const total = snap.pageKeys.length + snap.insertEntries.length
      syncTextPanelAfterGridMutation()
      showCopyToast(`已撤销删除 ${total} 行`, "success")
      return true
    }
  } catch (err) {
    showCopyToast(`撤销失败: ${String(err)}`, "error")
    return false
  }
  return false
}

function redoLastEditChange() {
  if (!editMode.value) return false
  commitGridTyping({ cancel: true })
  const stack = editRedoStack.value.slice()
  if (stack.length === 0) {
    showCopyToast("没有可重做的操作", "info")
    return false
  }
  const snap = stack.pop()
  editRedoStack.value = stack
  try {
    if (snap.kind === "cells") {
      // Capture current values for undo before re-applying.
      const undoEntries = snap.entries.map(entry => ({
        rowKind: entry.rowKind,
        rowIndex: entry.rowIndex,
        columnName: entry.columnName,
        prevValue: readGridCellValue(entry.rowKind, entry.rowIndex, entry.columnName),
      }))
      for (const entry of snap.entries) {
        if (entry.rowKind === "page") {
          applyRowCellChange(entry.rowIndex, entry.columnName, entry.prevValue)
        } else if (entry.rowKind === "insert") {
          applyInsertCellChange(entry.rowIndex, entry.columnName, entry.prevValue)
        }
      }
      editUndoStack.value = [...editUndoStack.value, { kind: "cells", entries: undoEntries }]
      syncTextPanelAfterGridMutation()
      showCopyToast(`已重做 ${snap.entries.length} 格修改`, "success")
      return true
    }
    if (snap.kind === "insert") {
      // Re-insert the row at the original index.
      const idx = Math.min(snap.insertIndex, editChanges.inserts.length)
      editChanges.inserts.splice(idx, 0, { ...(snap.row || {}) })
      editDirty.value = editChanges.updates.size > 0
        || hasNonEmptyInserts()
        || editChanges.deletes.size > 0
      editUndoStack.value = [...editUndoStack.value, { kind: "insert", insertIndex: idx }]
      syncTextPanelAfterGridMutation()
      showCopyToast("已重做新增行", "success")
      return true
    }
    if (snap.kind === "delete") {
      // Re-delete the rows.
      for (const key of snap.pageKeys) {
        editChanges.deletes.add(key)
        if (snap.prevUpdates && Object.prototype.hasOwnProperty.call(snap.prevUpdates, key)) {
          editChanges.updates.delete(key)
        }
      }
      // Remove insert rows (highest index first to avoid shifting).
      const sortedInserts = snap.insertEntries
        .slice()
        .sort((a, b) => b.index - a.index)
      for (const entry of sortedInserts) {
        if (entry.index >= 0 && entry.index < editChanges.inserts.length) {
          editChanges.inserts.splice(entry.index, 1)
        }
      }
      editDirty.value = editChanges.updates.size > 0
        || hasNonEmptyInserts()
        || editChanges.deletes.size > 0
      ensureGridFocusInBounds()
      editUndoStack.value = [...editUndoStack.value, { kind: "delete", pageKeys: snap.pageKeys, insertEntries: snap.insertEntries, prevUpdates: snap.prevUpdates }]
      const total = snap.pageKeys.length + snap.insertEntries.length
      syncTextPanelAfterGridMutation()
      showCopyToast(`已重做删除 ${total} 行`, "success")
      return true
    }
  } catch (err) {
    showCopyToast(`重做失败: ${String(err)}`, "error")
    return false
  }
  return false
}

// ── 编辑模式：多单元格打字缓冲（支持 77、Backspace 修剪） ──

function isMultiCellRangeActive() {
  const range = getNormalizedGridRange()
  if (!range) return false
  const size = rangeSize(range)
  return size.rows * size.cols > 1
}

function startOrAppendGridTyping(delta) {
  const range = getNormalizedGridRange()
  if (!range) return 0
  if (!gridTypingActive.value) {
    // Snapshot current values so Ctrl+Z restores them atomically.
    pushCellsUndoSnapshot(enumerateRangeCells(range))
    gridTypingActive.value = true
    gridTypingBuffer.value = ""
  }
  gridTypingBuffer.value = String(gridTypingBuffer.value || "") + String(delta || "")
  const changes = fillRangeValue(range, gridTypingBuffer.value)
  return writeGridCellChanges(changes, { suppressUndo: true })
}

function backspaceGridTyping() {
  if (!gridTypingActive.value) return 0
  const range = getNormalizedGridRange()
  if (!range) {
    gridTypingActive.value = false
    gridTypingBuffer.value = ""
    return 0
  }
  gridTypingBuffer.value = String(gridTypingBuffer.value || "").slice(0, -1)
  const changes = fillRangeValue(range, gridTypingBuffer.value)
  return writeGridCellChanges(changes, { suppressUndo: true })
}

function commitGridTyping({ cancel = false } = {}) {
  if (!gridTypingActive.value) return
  gridTypingActive.value = false
  gridTypingBuffer.value = ""
  // The cell values are already committed to editChanges; nothing further
  // unless the caller wanted to cancel (we don't support cancel — fill is
  // destructive, use Ctrl+Z to undo).
  void cancel
}

function moveGridFocus(action, { withShift = false } = {}) {
  if (!hasActiveGridFocus()) {
    initGridFocusIfNeeded()
    if (!hasActiveGridFocus()) return false
  }
  const columns = getEditColumnNames()
  const { pageCount, insertCount } = getEditGridCounts()

  if (withShift) {
    // Shift+arrow extends the rectangular selection.
    const anchor = gridRange.anchor || {
      rowKind: gridFocus.rowKind,
      rowIndex: gridFocus.rowIndex,
      columnName: gridFocus.columnName,
    }
    const head = gridRange.head || {
      rowKind: gridFocus.rowKind,
      rowIndex: gridFocus.rowIndex,
      columnName: gridFocus.columnName,
    }
    const next = expandRange({
      anchor,
      head,
      columns,
      pageCount,
      insertCount,
      direction: action,
    })
    if (!next) {
      // At the last row pressing Shift+Down → append a new row and expand into it.
      if (action === "down") {
        const curHead = head
        const isLastInsert = curHead.rowKind === "insert" && curHead.rowIndex === insertCount - 1
        const isLastPageNoInserts = curHead.rowKind === "page" && curHead.rowIndex === pageCount - 1 && insertCount === 0
        if (isLastInsert || isLastPageNoInserts) {
          addNewRow()
          const newInsertCount = editChanges.inserts.length
          gridRange.anchor = { ...anchor }
          gridRange.head = { rowKind: "insert", rowIndex: newInsertCount - 1, columnName: curHead.columnName }
          setGridFocus("insert", newInsertCount - 1, curHead.columnName)
          scrollFocusedCellIntoView()
          return true
        }
        // Cross-kind: head is in page, try to expand into insert region.
        if (curHead.rowKind === "page" && curHead.rowIndex === pageCount - 1 && insertCount > 0) {
          gridRange.anchor = { ...anchor }
          gridRange.head = { rowKind: "insert", rowIndex: 0, columnName: curHead.columnName }
          setGridFocus("insert", 0, curHead.columnName)
          scrollFocusedCellIntoView()
          return true
        }
      }
      // Shift+Up from first insert row → cross back to last page row.
      if (action === "up" && head.rowKind === "insert" && head.rowIndex === 0 && pageCount > 0) {
        gridRange.anchor = { ...anchor }
        gridRange.head = { rowKind: "page", rowIndex: pageCount - 1, columnName: head.columnName }
        setGridFocus("page", pageCount - 1, head.columnName)
        scrollFocusedCellIntoView()
        return true
      }
      return false
    }
    gridRange.anchor = { ...next.anchor }
    gridRange.head = { ...next.head }
    setGridFocus(next.head.rowKind, next.head.rowIndex, next.head.columnName)
    scrollFocusedCellIntoView()
    return true
  }

  const target = resolveFocusMove({
    rowKind: gridFocus.rowKind,
    rowIndex: gridFocus.rowIndex,
    columnName: gridFocus.columnName,
    columns,
    pageRowCount: pageCount,
    insertRowCount: insertCount,
    action,
  })
  if (!target) {
    // At the last row pressing down → append a new row and focus it.
    if (action === "down") {
      const isLastInsert = gridFocus.rowKind === "insert" && gridFocus.rowIndex === insertCount - 1
      const isLastPageNoInserts = gridFocus.rowKind === "page" && gridFocus.rowIndex === pageCount - 1 && insertCount === 0
      if (isLastInsert || isLastPageNoInserts) {
        addRowAndFocus()
        return true
      }
    }
    return false
  }
  clearGridRange()
  setGridFocus(target.rowKind, target.rowIndex, target.columnName)
  scrollFocusedCellIntoView()
  return true
}

function scrollFocusedCellIntoView() {
  if (!hasActiveGridFocus()) return
  nextTick(() => {
    const selector = gridFocus.rowKind === "insert"
      ? `tr.edit-new-row:nth-of-type(${gridFocus.rowIndex + 1}) td[data-column-name="${cssEscape(gridFocus.columnName)}"]`
      : `tbody tr[data-hit-row-index="${gridFocus.rowIndex}"] td[data-column-name="${cssEscape(gridFocus.columnName)}"]`
    try {
      const el = tableModalRef.value && tableModalRef.value.querySelector(selector)
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest", inline: "nearest" })
      }
    } catch { /* noop */ }
  })
}

function cssEscape(value) {
  const text = String(value ?? "")
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(text)
  }
  return text.replace(/["\\]/g, "\\$&")
}

function enterCellEditFromFocus({ prefill = null } = {}) {
  if (!hasActiveGridFocus()) return false
  if (gridFocus.rowKind === "page") {
    if (editChanges.deletes.has(computeRowKey(tableView.rows[gridFocus.rowIndex], gridFocus.rowIndex))) return false
    startCellEdit(gridFocus.rowIndex, gridFocus.columnName)
    if (prefill !== null) {
      editingCell.currentValue = String(prefill)
      nextTick(() => {
        if (textPanelOpen.value) {
          const ta = tableModalRef.value && tableModalRef.value.querySelector(".edit-text-panel__textarea")
          if (ta) { const len = editingCell.currentValue.length; ta.focus(); ta.setSelectionRange(len, len) }
        } else {
          const el = document.getElementById("edit-cell-input")
          if (el) { el.focus(); const len = editingCell.currentValue.length; try { el.setSelectionRange(len, len) } catch { /* noop */ } }
        }
      })
    }
    return true
  }
  if (gridFocus.rowKind === "insert") {
    startNewRowCellEdit(gridFocus.rowIndex, gridFocus.columnName)
    if (prefill !== null) {
      editingCell.currentValue = String(prefill)
      nextTick(() => {
        if (textPanelOpen.value) {
          const ta = tableModalRef.value && tableModalRef.value.querySelector(".edit-text-panel__textarea")
          if (ta) { const len = editingCell.currentValue.length; ta.focus(); ta.setSelectionRange(len, len) }
        } else {
          const el = document.getElementById("edit-cell-input")
          if (el) { el.focus(); const len = editingCell.currentValue.length; try { el.setSelectionRange(len, len) } catch { /* noop */ } }
        }
      })
    }
    return true
  }
  return false
}

function isPrintableChar(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  const key = String(event.key || "")
  if (key.length !== 1) return false
  // Exclude whitespace-only keys such as raw space — but we DO want space to
  // enter edit mode with a leading space. Allow everything with length 1.
  const code = key.charCodeAt(0)
  return code >= 0x20 && code !== 0x7f
}

function readGridCellValue(rowKind, rowIndex, columnName) {
  if (rowKind === "page") return resolvePageCellValue(rowIndex, columnName)
  if (rowKind === "insert") return resolveInsertCellValue(rowIndex, columnName)
  return ""
}

function writeGridCellChanges(changes, { suppressUndo = false } = {}) {
  if (!Array.isArray(changes) || changes.length === 0) return 0
  // Capture undo state BEFORE applying. Typing buffer / batch ops that want
  // to coalesce multiple writes into one snapshot pass suppressUndo=true and
  // own the snapshot push themselves.
  if (!suppressUndo) {
    pushCellsUndoSnapshot(changes)
  }
  let applied = 0
  for (const change of changes) {
    if (!change) continue
    const { rowKind, rowIndex, columnName, value } = change
    const v = String(value ?? "")
    if (rowKind === "page") {
      if (applyRowCellChange(rowIndex, columnName, v)) applied += 1
    } else if (rowKind === "insert") {
      if (applyInsertCellChange(rowIndex, columnName, v)) applied += 1
    }
  }
  return applied
}

async function copyGridRangeToClipboard() {
  const range = getEffectiveGridRange()
  if (!range) return 0
  const tsv = buildRangeTsv(range, readGridCellValue)
  try {
    await navigator.clipboard.writeText(tsv)
    const size = rangeSize(range)
    showCopyToast(`已复制 ${size.rows}×${size.cols} 单元格`, "success")
    return size.rows * size.cols
  } catch {
    showCopyToast("复制失败", "error")
    return 0
  }
}

async function pasteTsvIntoGridRange() {
  const range = getEffectiveGridRange()
  if (!range) return 0
  let text = ""
  try {
    text = await navigator.clipboard.readText()
  } catch {
    showCopyToast("读取剪贴板失败", "error")
    return 0
  }
  const tsv = parseClipboardTsv(text)
  if (tsv.length === 0) return 0

  // Auto-expand: if TSV is larger than selection, expand the range to fit.
  const { rows: selRows, cols: selCols } = rangeSize(range)
  const tsvRows = tsv.length
  const tsvCols = Math.max(...tsv.map(r => r.length), 0)
  const needRows = Math.max(selRows, tsvRows)
  const needCols = Math.max(selCols, tsvCols)

  // Expand range to needed dimensions.
  let pasteRange = range
  if (needRows > selRows || needCols > selCols) {
    const newRowEnd = Math.min(range.rowStart + needRows - 1, range.rowKind === "page" ? getEditGridCounts().pageCount - 1 : getEditGridCounts().insertCount - 1)
    const newColEnd = Math.min(range.colStart + needCols - 1, range.columns.length - 1)
    pasteRange = { ...range, rowEnd: newRowEnd, colEnd: newColEnd }
  }

  // Auto-append insert rows if paste needs more space.
  const pasteNeededRows = range.rowStart + needRows
  if (range.rowKind === "insert") {
    const { insertCount } = getEditGridCounts()
    for (let i = insertCount; i < pasteNeededRows; i++) addNewRow()
  } else if (range.rowKind === "page") {
    const { pageCount, insertCount } = getEditGridCounts()
    const overflow = pasteNeededRows - pageCount
    if (overflow > 0) {
      for (let i = insertCount; i < overflow; i++) addNewRow()
    }
  }

  const { pageCount, insertCount } = getEditGridCounts()
  // Re-expand rowEnd after adding rows.
  if (needRows > selRows) {
    const maxRow = pasteRange.rowKind === "page" ? pageCount - 1 : insertCount - 1
    pasteRange = { ...pasteRange, rowEnd: Math.min(range.rowStart + needRows - 1, maxRow) }
  }
  const { changes, newRange } = applyTsvToRange({
    tsv,
    range: pasteRange,
    pageCount,
    insertCount,
  })

  // If pasting from a page row overflows, paste the overflow into insert rows.
  let extraChanges = []
  if (range.rowKind === "page" && selRows === 1 && tsv.length > 1) {
    const pastedPageRows = Math.min(tsv.length, pageCount - range.rowStart)
    const overflowTsv = tsv.slice(pastedPageRows)
    if (overflowTsv.length > 0) {
      const { insertCount: ic2 } = getEditGridCounts()
      for (let i = ic2; i < overflowTsv.length; i++) addNewRow()
      const { insertCount: ic3 } = getEditGridCounts()
      const overflowRange = normalizeRange({
        anchor: { rowKind: "insert", rowIndex: 0, columnName: range.columns[range.colStart] },
        head: { rowKind: "insert", rowIndex: 0, columnName: range.columns[range.colStart] },
        columns: range.columns,
        pageCount,
        insertCount: ic3,
      })
      if (overflowRange) {
        const { changes: oc } = applyTsvToRange({ tsv: overflowTsv, range: overflowRange, pageCount, insertCount: ic3 })
        extraChanges = oc
      }
    }
  }
  const applied = writeGridCellChanges(changes) + writeGridCellChanges(extraChanges)
  if (newRange) {
    gridRange.anchor = {
      rowKind: newRange.rowKind,
      rowIndex: newRange.rowStart,
      columnName: newRange.columns[newRange.colStart],
    }
    gridRange.head = {
      rowKind: newRange.rowKind,
      rowIndex: newRange.rowEnd,
      columnName: newRange.columns[newRange.colEnd],
    }
  }
  if (applied > 0) {
    showCopyToast(`已粘贴 ${applied} 格`, "success")
  }
  return applied
}

function fillDownFromRange() {
  const anchor = gridRange.anchor
  const head = gridRange.head
  // Cross-kind fill: page→insert
  if (anchor && head && anchor.rowKind !== head.rowKind) {
    const columns = getEditColumnNames()
    const { pageCount, insertCount } = getEditGridCounts()
    const colA = columns.indexOf(String(anchor.columnName || ""))
    const colB = columns.indexOf(String(head.columnName || ""))
    const colStart = Math.min(colA >= 0 ? colA : 0, colB >= 0 ? colB : 0)
    const colEnd = Math.max(colA >= 0 ? colA : 0, colB >= 0 ? colB : 0)
    // Source row is the first row (anchor for page→insert)
    const srcKind = anchor.rowKind === "page" ? "page" : "insert"
    const srcRow = anchor.rowIndex
    const changes = []
    for (let c = colStart; c <= colEnd; c++) {
      const col = columns[c]
      const srcVal = String(readGridCellValue(srcKind, srcRow, col) ?? "")
      // Fill remaining page rows
      if (srcKind === "page") {
        for (let r = srcRow + 1; r < pageCount; r++) {
          changes.push({ rowKind: "page", rowIndex: r, columnName: col, value: srcVal })
        }
        // Fill insert rows up to head
        const insertEnd = head.rowKind === "insert" ? head.rowIndex : insertCount - 1
        for (let r = 0; r <= insertEnd; r++) {
          changes.push({ rowKind: "insert", rowIndex: r, columnName: col, value: srcVal })
        }
      }
    }
    const applied = writeGridCellChanges(changes)
    if (applied > 0) showCopyToast(`向下填充 ${applied} 格`, "success")
    return applied
  }
  const range = getEffectiveGridRange()
  if (!range) return 0
  const size = rangeSize(range)
  if (size.rows <= 1) return 0
  const changes = buildFillDownChanges(range, readGridCellValue)
  const applied = writeGridCellChanges(changes)
  if (applied > 0) {
    showCopyToast(`向下填充 ${size.rows - 1} 行`, "success")
  }
  return applied
}

function clearRangeCells() {
  const range = getEffectiveGridRange()
  if (!range) return 0
  return writeGridCellChanges(fillRangeValue(range, ""))
}

function addRowAndFocus() {
  addNewRow()
  const newIdx = editChanges.inserts.length - 1
  pushInsertUndoSnapshot(newIdx)
  const columns = getEditColumnNames()
  if (columns.length === 0) return false
  nextTick(() => {
    setGridFocus("insert", newIdx, columns[0])
    clearGridRange()
    scrollFocusedCellIntoView()
  })
  return true
}

function deleteFocusedOrRangeRows() {
  // Determine which rows the operation should cover.
  const range = getNormalizedGridRange()
  const { pageCount, insertCount } = getEditGridCounts()
  const pageRowsToDelete = new Set()
  const insertRowsToDelete = []

  if (range) {
    if (range.rowKind === "page") {
      for (let r = range.rowStart; r <= range.rowEnd; r++) pageRowsToDelete.add(r)
    } else if (range.rowKind === "insert") {
      for (let r = range.rowStart; r <= range.rowEnd; r++) insertRowsToDelete.push(r)
    }
  } else if (hasActiveGridFocus()) {
    if (gridFocus.rowKind === "page") pageRowsToDelete.add(gridFocus.rowIndex)
    else if (gridFocus.rowKind === "insert") insertRowsToDelete.push(gridFocus.rowIndex)
  }

  // Capture undo state before mutating.
  const undoPageKeys = []
  const undoInsertEntries = []
  const undoPrevUpdates = {}

  let deleted = 0
  if (pageRowsToDelete.size > 0) {
    for (const rowIdx of pageRowsToDelete) {
      const row = tableView.rows[rowIdx]
      if (!row) continue
      const key = computeRowKey(row, rowIdx)
      if (editChanges.deletes.has(key)) continue
      undoPageKeys.push(key)
      if (editChanges.updates.has(key)) {
        const prev = editChanges.updates.get(key)
        undoPrevUpdates[key] = {
          whereKeys: { ...(prev.whereKeys || {}) },
          changes: { ...(prev.changes || {}) },
        }
      }
      editChanges.deletes.add(key)
      editChanges.updates.delete(key)
      deleted += 1
    }
  }
  if (insertRowsToDelete.length > 0) {
    // Snapshot full row content before splicing, so undo can restore it.
    const snapshotIndices = [...new Set(insertRowsToDelete)].sort((a, b) => a - b)
    for (const idx of snapshotIndices) {
      const row = editChanges.inserts[idx]
      if (row) undoInsertEntries.push({ index: idx, row: { ...row } })
    }
    // Delete from bottom to top so indices stay valid.
    const toRemove = snapshotIndices.slice().reverse()
    for (const idx of toRemove) {
      editChanges.inserts.splice(idx, 1)
      deleted += 1
    }
  }
  if (deleted > 0) {
    pushDeleteUndoSnapshot({
      pageKeys: undoPageKeys,
      insertEntries: undoInsertEntries,
      prevUpdates: undoPrevUpdates,
    })
    editDirty.value = true
    clearGridRange()
    ensureGridFocusInBounds()
    showCopyToast(`已删除 ${deleted} 行`, "success")
    // Discard row references in the row-selection set as well.
    const stillValid = [...editSelectedRows.value].filter(
      (key) => !editChanges.deletes.has(key),
    )
    if (stillValid.length !== editSelectedRows.value.size) {
      setEditSelectedRowKeys(stillValid)
    }
  }
  return deleted
}

// ── 编辑模式：📝 文本选项 面板 ──

function textPanelFocusTitle() {
  if (!hasActiveGridFocus()) return "未选中单元格"
  const globalRow = gridFocus.rowKind === "insert"
    ? `新增行 #${gridFocus.rowIndex + 1}`
    : `第 ${((tableView.page - 1) * tableView.pageSize) + gridFocus.rowIndex + 1} 行`
  return `${gridFocus.columnName} · ${globalRow}`
}

const textPanelHighlightedHtml = computed(() => {
  const text = textPanelDraft.value || ""
  if (!text.trim()) return ""
  const lang = detectCellViewerLanguage(text)
  if (lang === "plaintext") return escapeHtmlForHighlight(text)
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  } catch {
    return escapeHtmlForHighlight(text)
  }
})

function escapeHtmlForHighlight(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function onTextPanelScroll(event) {
  const pre = event.target.parentElement && event.target.parentElement.querySelector(".edit-text-panel__highlight")
  if (pre) {
    pre.scrollTop = event.target.scrollTop
    pre.scrollLeft = event.target.scrollLeft
  }
}

function isEditMirrorElement(target) {
  return target instanceof Element
    && (target.id === "edit-cell-input" || target.classList.contains("edit-text-panel__textarea"))
}

function onCellEditBlur(event, confirmActiveEdit) {
  if (isEditMirrorElement(event.relatedTarget)) return
  confirmActiveEdit()
}

function onTextPanelBlur(event) {
  if (isEditMirrorElement(event.relatedTarget)) return
  // When textarea loses focus while cell edit is active via text panel, confirm the edit.
  if (editingCell.active && textPanelOpen.value) {
    if (editingCell.rowIndex >= tableView.rows.length) {
      confirmNewRowCellEdit(editingCell.rowIndex - tableView.rows.length)
    } else {
      confirmCellEdit()
    }
  }
}

function toggleTextPanel() {
  if (!editMode.value) {
    showCopyToast("请先进入编辑模式", "error")
    return
  }
  textPanelOpen.value = !textPanelOpen.value
  if (textPanelOpen.value) {
    loadTextPanelFromFocus({ force: true })
  }
}

function loadTextPanelFromFocus({ force = false } = {}) {
  if (!textPanelOpen.value && !force) return
  const focus = hasActiveGridFocus()
    ? { rowKind: gridFocus.rowKind, rowIndex: gridFocus.rowIndex, columnName: gridFocus.columnName }
    : null
  const editingInsertIndex = editingCell.rowIndex - tableView.rows.length
  const focusMatchesActiveEdit = editingCell.active && focus
    && editingCell.columnName === focus.columnName
    && (
      (focus.rowKind === "page" && editingCell.rowIndex === focus.rowIndex)
      || (focus.rowKind === "insert" && editingInsertIndex === focus.rowIndex)
    )
  const originalText = focusMatchesActiveEdit
    ? editingCell.currentValue
    : (focus ? readGridCellValue(focus.rowKind, focus.rowIndex, focus.columnName) : "")
  const decision = force && focus
    ? {
      action: "load",
      draft: String(originalText ?? ""),
      focusKey: buildFocusKey(focus),
      dirty: false,
    }
    : resolveTextPanelLoad({
      focus,
      panelDirty: false,
      lastFocusKey: textPanelFocusKey.value,
      originalText,
    })
  if (decision.action === "load" || decision.action === "warn") {
    textPanelDraft.value = String(originalText ?? "")
    textPanelOriginal.value = String(originalText ?? "")
    textPanelFocusKey.value = buildFocusKey(focus)
    textPanelDirty.value = false
  } else if (decision.action === "clear") {
    textPanelDraft.value = ""
    textPanelOriginal.value = ""
    textPanelFocusKey.value = ""
    textPanelDirty.value = false
  }
}

function syncTextPanelAfterGridMutation() {
  if (!textPanelOpen.value) return
  loadTextPanelFromFocus({ force: true })
}

function onTextPanelInput(event) {
  textPanelDraft.value = String(event.target.value ?? "")
  textPanelDirty.value = textPanelDraft.value !== textPanelOriginal.value
  syncEditMirrorSelectionFrom(event.target, "cell")
  // Real-time sync: immediately write back to the cell.
  if (hasActiveGridFocus()) {
    const { rowKind, rowIndex, columnName } = gridFocus
    if (editingCell.active) {
      // If cell is being edited inline, update the inline value too.
      editingCell.currentValue = textPanelDraft.value
    } else {
      writeGridCellChanges([{ rowKind, rowIndex, columnName, value: textPanelDraft.value }])
    }
  }
}

function onCellEditInput(event) {
  editingCell.currentValue = String(event.target.value ?? "")
  syncEditMirrorSelectionFrom(event.target, "cell")
  if (textPanelOpen.value) {
    textPanelDraft.value = editingCell.currentValue
    textPanelDirty.value = textPanelDraft.value !== textPanelOriginal.value
    syncEditMirrorSelectionTo("text-panel")
  }
}

function syncEditMirrorSelectionFrom(source, target) {
  if (editMirrorApplyingSelection || !source) return
  const start = Number.isInteger(source.selectionStart) ? source.selectionStart : 0
  const end = Number.isInteger(source.selectionEnd) ? source.selectionEnd : start
  editMirrorSelection.start = Math.max(0, start)
  editMirrorSelection.end = Math.max(editMirrorSelection.start, end)
  syncEditMirrorSelectionTo(target)
}

function syncEditMirrorSelectionTo(target) {
  if (!textPanelOpen.value && target === "text-panel") return
  nextTick(() => {
    const valueLength = String(editingCell.active ? editingCell.currentValue : textPanelDraft.value || "").length
    const start = Math.min(editMirrorSelection.start, valueLength)
    const end = Math.min(editMirrorSelection.end, valueLength)
    const input = document.getElementById("edit-cell-input")
    const ta = tableModalRef.value && tableModalRef.value.querySelector(".edit-text-panel__textarea")
    const el = target === "cell" ? input : ta
    if (el && typeof el.setSelectionRange === "function") {
      editMirrorApplyingSelection = true
      try {
        el.setSelectionRange(start, end)
      } finally {
        editMirrorApplyingSelection = false
      }
    }
  })
}

function syncCursorToTextPanel(event) {
  if (!textPanelOpen.value || !editingCell.active) return
  syncEditMirrorSelectionFrom(event?.target || document.getElementById("edit-cell-input"), "text-panel")
}

function syncCursorToCellInput(event) {
  syncEditMirrorSelectionFrom(event?.target || tableModalRef.value?.querySelector(".edit-text-panel__textarea"), "cell")
}

function resetTextPanel() {
  textPanelDraft.value = textPanelOriginal.value
  textPanelDirty.value = false
}

function writeTextPanelBack() {
  if (!hasActiveGridFocus()) return
  const { rowKind, rowIndex, columnName } = gridFocus
  const applied = writeGridCellChanges([
    { rowKind, rowIndex, columnName, value: textPanelDraft.value },
  ])
  if (applied > 0) {
    textPanelOriginal.value = textPanelDraft.value
    textPanelDirty.value = false
    showCopyToast("已写回单元格", "success")
  }
}

async function copyTextPanelDraft() {
  try {
    await navigator.clipboard.writeText(textPanelDraft.value || "")
    showCopyToast("已复制文本", "success")
  } catch {
    showCopyToast("复制失败", "error")
  }
}

function onTextPanelResizeStart(event) {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = textPanelHeight.value
  const container = tableModalRef.value
  const containerHeight = container && typeof container.getBoundingClientRect === "function"
    ? container.getBoundingClientRect().height
    : window.innerHeight
  const onMove = (moveEvent) => {
    // Dragging the handle upwards increases the panel height.
    const delta = startY - moveEvent.clientY
    textPanelHeight.value = clampTextPanelHeight(startHeight + delta, containerHeight)
  }
  const onUp = () => {
    window.removeEventListener("pointermove", onMove, true)
    window.removeEventListener("pointerup", onUp, true)
  }
  window.addEventListener("pointermove", onMove, true)
  window.addEventListener("pointerup", onUp, true)
}

watch(
  () => buildFocusKey({ rowKind: gridFocus.rowKind, rowIndex: gridFocus.rowIndex, columnName: gridFocus.columnName }),
  () => {
    if (!textPanelOpen.value) return
    loadTextPanelFromFocus()
  },
)

// Sync cell edit value + cursor to text panel in real-time.
watch(
  () => editingCell.currentValue,
  (val) => {
    if (!editingCell.active || !textPanelOpen.value) return
    textPanelDraft.value = val
  },
)

function handleGridFocusKeydown(event) {
  if (!editMode.value) return false
  if (editingCell.active) return false
  if (editingCell.rowIndex >= 0 && editingCell.active) return false
  if (!tableOpen.value) return false
  if (cellViewerOpen.value) return false
  if (editSaveDialogOpen.value || editUnsavedDialogOpen.value || editDateDialogOpen.value) return false
  const isTextPanelTextarea = event.target && event.target.classList && event.target.classList.contains("edit-text-panel__textarea")
  if (isTextPanelTextarea && !shouldRouteTextPanelKeyToGrid(event)) return false
  if (!isTextPanelTextarea && isEditableTarget(event.target)) return false

  const key = String(event.key || "")
  const primary = event.ctrlKey || event.metaKey

  // Arrow/Home/End/PageUp/PageDown.
  const moveAction = classifyFocusKey(event)
  if (moveAction) {
    initGridFocusIfNeeded()
    if (!hasActiveGridFocus()) return false
    if (!event.shiftKey) commitGridTyping()
    const moved = moveGridFocus(moveAction, { withShift: event.shiftKey })
    if (moved) {
      event.preventDefault()
      event.stopPropagation()
    }
    return moved
  }

  // Shift+Space — select the whole focus row as a grid range (Excel parity).
  if (event.shiftKey && !primary && !event.altKey && (key === " " || key === "Spacebar")) {
    if (!hasActiveGridFocus()) return false
    commitGridTyping()
    const columns = getEditColumnNames()
    if (columns.length === 0) return false
    // If there's already a row-level anchor, extend the range to cover multiple rows.
    const anchorRow = (gridRange.anchor && gridRange.anchor.rowKind === gridFocus.rowKind)
      ? gridRange.anchor.rowIndex
      : gridFocus.rowIndex
    gridRange.anchor = {
      rowKind: gridFocus.rowKind,
      rowIndex: anchorRow,
      columnName: columns[0],
    }
    gridRange.head = {
      rowKind: gridFocus.rowKind,
      rowIndex: gridFocus.rowIndex,
      columnName: columns[columns.length - 1],
    }
    // Select all rows in the range for batch tools / Ctrl+C.
    if (gridFocus.rowKind === "page") {
      const startRow = Math.min(anchorRow, gridFocus.rowIndex)
      const endRow = Math.max(anchorRow, gridFocus.rowIndex)
      const newKeys = [...editSelectedRows.value]
      for (let r = startRow; r <= endRow; r++) {
        const row = tableView.rows[r]
        const rowKey = row ? computeRowKey(row, r) : ""
        if (rowKey && !editChanges.deletes.has(rowKey) && !newKeys.includes(rowKey)) {
          newKeys.push(rowKey)
        }
      }
      setEditSelectedRowKeys(newKeys)
      editSelectionAnchorIndex.value = anchorRow
    }
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  // Ctrl/Cmd+Z — undo the last edit change.
  if (primary && !event.altKey && !event.shiftKey && key.toLowerCase() === "z") {
    undoLastEditChange()
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  // Ctrl/Cmd+Shift+Z — redo the last undone change.
  if (primary && !event.altKey && event.shiftKey && key.toLowerCase() === "z") {
    redoLastEditChange()
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  // Ctrl/Cmd+Enter — insert a new row and jump focus to it.
  if (primary && !event.altKey && key === "Enter") {
    commitGridTyping()
    addRowAndFocus()
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  // Ctrl/Cmd+Delete / Ctrl/Cmd+Minus — delete focused row (or range's rows).
  if (
    primary
    && !event.altKey
    && !event.shiftKey
    && (key === "Delete" || key === "-" || key === "_")
  ) {
    if (!hasActiveGridFocus()) return false
    commitGridTyping()
    const deleted = deleteFocusedOrRangeRows()
    event.preventDefault()
    event.stopPropagation()
    return deleted > 0
  }

  // F4 — toggle the 📝 文本选项 panel.
  if (!primary && !event.shiftKey && !event.altKey && key === "F4") {
    commitGridTyping()
    toggleTextPanel()
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  // Enter / F2 — enter edit on the focus cell.
  if (!primary && !event.shiftKey && !event.altKey && (key === "Enter" || key === "F2")) {
    commitGridTyping()
    if (!hasActiveGridFocus()) initGridFocusIfNeeded()
    if (enterCellEditFromFocus()) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    return false
  }

  // Esc — clear the multi-cell selection while keeping focus.
  if (!primary && !event.shiftKey && key === "Escape") {
    const wasTyping = gridTypingActive.value
    commitGridTyping()
    if (getNormalizedGridRange()) {
      clearGridRange()
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    if (wasTyping) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    return false
  }

  // Backspace inside the multi-cell typing buffer — trim by one character.
  if (!primary && !event.shiftKey && key === "Backspace" && gridTypingActive.value) {
    backspaceGridTyping()
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  // Delete / Backspace — clear the range (or the focus cell) to empty string.
  if (!primary && !event.shiftKey && (key === "Delete" || key === "Backspace")) {
    if (!hasActiveGridFocus()) return false
    commitGridTyping()
    const cleared = clearRangeCells()
    if (cleared > 0) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    return false
  }

  // Ctrl/Cmd+D — fill-down.
  if (primary && !event.altKey && !event.shiftKey && key.toLowerCase() === "d") {
    commitGridTyping()
    const applied = fillDownFromRange()
    event.preventDefault()
    event.stopPropagation()
    return applied > 0
  }

  // Ctrl/Cmd+C — copy the range as TSV.
  if (primary && !event.altKey && !event.shiftKey && key.toLowerCase() === "c") {
    // Only hijack when there is an explicit multi-cell range or a focus cell.
    // Fall back to the existing "editCopySelected" path when no grid focus is
    // active so row-level copy still works.
    if (!hasActiveGridFocus()) return false
    const explicit = getNormalizedGridRange()
    if (!explicit) return false
    copyGridRangeToClipboard().catch(() => {})
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  // Ctrl/Cmd+V — paste TSV into the range.
  if (primary && !event.altKey && !event.shiftKey && key.toLowerCase() === "v") {
    if (!hasActiveGridFocus()) return false
    commitGridTyping()
    pasteTsvIntoGridRange().catch(() => {})
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  // Printable char — if the selection covers multiple cells we accumulate
  // into a typing buffer so "77" types as "77" (not "7", "7"), and Backspace
  // trims the buffer; otherwise enter edit mode with the typed char as prefill.
  if (isPrintableChar(event)) {
    if (!hasActiveGridFocus()) initGridFocusIfNeeded()
    if (!hasActiveGridFocus()) return false
    if (isMultiCellRangeActive()) {
      startOrAppendGridTyping(key)
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    commitGridTyping()
    if (enterCellEditFromFocus({ prefill: key })) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    return false
  }

  return false
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
    const msg = String(err || "")
    let hint = msg
    // Try to extract column name from error for specific location.
    const colMatch = msg.match(/column\s+['"`]?(\w+)['"`]?/i)
      || msg.match(/field\s+['"`]?(\w+)['"`]?/i)
      || msg.match(/['"`](\w+)['"`]\s+cannot/i)
      || msg.match(/for\s+key\s+['"`]?(\w+)['"`]?/i)
    const errorCol = colMatch ? colMatch[1] : ""
    const colHint = errorCol ? `（字段：${errorCol}）` : ""

    if (/duplicate/i.test(msg) || /unique/i.test(msg)) {
      hint = `有重复的数据${colHint}，主键或唯一字段的值已经存在了`
    } else if (/foreign key/i.test(msg) || /constraint/i.test(msg)) {
      hint = `数据关联约束不满足${colHint}，引用的记录可能不存在`
    } else if (/null/i.test(msg) && /not null/i.test(msg)) {
      hint = `必填字段不能为空${colHint}，请补充内容`
    } else if (/data too long/i.test(msg) || /truncat/i.test(msg)) {
      hint = `内容太长${colHint}，超出了字段允许的长度`
    } else if (/incorrect.*value/i.test(msg) || /type/i.test(msg) && /mismatch/i.test(msg)) {
      hint = `数据类型不对${colHint}，比如数字字段填了文字`
    } else if (/connect/i.test(msg) || /timeout/i.test(msg)) {
      hint = "数据库连接失败或超时，请检查网络和数据库状态"
    } else if (/permission/i.test(msg) || /denied/i.test(msg) || /access/i.test(msg)) {
      hint = "没有权限执行这个操作，请联系管理员"
    } else if (/deadlock/i.test(msg)) {
      hint = "数据库繁忙（死锁），请稍后重试"
    }
    showCopyToast(`保存失败：${hint}`, 'error')
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
  config.personal.sync_window_hotkey = normalizeSyncWindowHotkey(config.personal.sync_window_hotkey);
  config.personal.quick_paste = {
    enabled: config.personal.quick_paste?.enabled ?? true,
    open_hotkey: normalizeHotkeyDisplay(config.personal.quick_paste?.open_hotkey || config.personal.quick_paste?.openHotkey || "F7"),
    output_hotkey: normalizeHotkeyDisplay(config.personal.quick_paste?.output_hotkey || config.personal.quick_paste?.outputHotkey || "F8"),
    snippets: Array.isArray(config.personal.quick_paste?.snippets) ? config.personal.quick_paste.snippets : [],
  };
  config.personal.template_prev_hotkey = normalizeTemplateSwitchHotkey(
    config.personal.template_prev_hotkey,
    "Ctrl+Alt+Left",
  );
  config.personal.template_next_hotkey = normalizeTemplateSwitchHotkey(
    config.personal.template_next_hotkey,
    "Ctrl+Alt+Right",
  );
  config.personal.panel_shortcuts = normalizePanelShortcuts(config.personal.panel_shortcuts);
  config.personal.reset_on_open_to_all_tables = config.personal.reset_on_open_to_all_tables !== false;
  {
    const updateSettings = normalizeUpdateSettings(config.personal);
    config.personal.auto_check_updates = updateSettings.autoCheckUpdates;
    config.personal.last_update_check_at = updateSettings.lastUpdateCheckAt;
    const pendingAnnouncement = normalizeUpdateAnnouncement(config.personal.pending_update_announcement);
    config.personal.pending_update_announcement = pendingAnnouncement
      ? {
          version: pendingAnnouncement.version,
          notes: pendingAnnouncement.notes,
          pub_date: pendingAnnouncement.pubDate,
        }
      : null;
    config.personal.last_update_announcement_version =
      normalizeUpdateVersion(config.personal.last_update_announcement_version) || null;
  }
  config.personal.background_opacity = normalizeBackgroundOpacity(config.personal.background_opacity);
  config.personal.reduce_transparency_mode = !!config.personal.reduce_transparency_mode;
  config.personal.startup_welcome_text = normalizeStartupWelcomeText(config.personal.startup_welcome_text);
  config.personal.startup_welcome_mode = normalizeStartupWelcomeMode(config.personal.startup_welcome_mode);
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
  if (demoDbConnected.value) {
    dbConnected.value = true;
    dbName.value = config.shared.db.database || settingsDraft.database || "请选择数据库";
    return;
  }
  try {
    const status = await invoke("get_connection_status");
    dbConnected.value = !!status.connected;
    dbName.value = status.connected ? (status.database || "请选择数据库") : "未连接";
  } catch {
    dbConnected.value = false;
    dbName.value = "未连接";
  }
}

function closeDatabaseMenu() {
  databaseMenuOpen.value = false;
  databaseMenuError.value = "";
}

async function toggleDatabaseMenu() {
  if (!isTauriWindow) return;
  if (!dbConnected.value) {
    showCopyToast("请先连接 MySQL", "error");
    return;
  }
  if (databaseMenuOpen.value) {
    closeDatabaseMenu();
    return;
  }
  closeTemplateMenu();
  databaseMenuOpen.value = true;
  databaseMenuLoading.value = true;
  databaseMenuError.value = "";
  if (demoDbConnected.value) {
    availableDatabases.value = ["demo_feature_test", "demo_shop", "demo_ops"];
    databaseMenuLoading.value = false;
    return;
  }
  try {
    const list = await invoke("list_databases");
    availableDatabases.value = Array.isArray(list) ? list : [];
    if (availableDatabases.value.length === 0) {
      databaseMenuError.value = "当前连接没有可选数据库";
    }
  } catch (error) {
    availableDatabases.value = [];
    databaseMenuError.value = String(error);
  } finally {
    databaseMenuLoading.value = false;
  }
}

async function selectDatabase(database) {
  const nextDatabase = String(database || "").trim();
  if (!nextDatabase || templateSwitching.value) return;
  templateSwitching.value = true;
  try {
    if (!demoDbConnected.value) {
      await invoke("select_database", { database: nextDatabase });
    }
    config.shared.db.database = nextDatabase;
    settingsDraft.database = nextDatabase;
    closeDatabaseMenu();
    await onDbConnectionChanged({ resetContext: true });
    summaryText.value = `已切换到数据库 ${nextDatabase}`;
    showCopyToast(`已切换到数据库 ${nextDatabase}`, "success");
  } catch (error) {
    databaseMenuError.value = String(error);
    showCopyToast(`切换数据库失败：${String(error)}`, "error");
  } finally {
    templateSwitching.value = false;
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
const batchImportSummary = computed(() => summarizeBatchImportSelection(batchImportFiles.value));

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

function resetBatchImportState() {
  batchImportFiles.value = [];
  batchImportStep.value = "select";
  batchImportLoading.value = false;
  batchImportError.value = "";
  batchImportResult.value = null;
  batchImportProgress.percent = 0;
  batchImportProgress.text = "";
}

function openBatchImport() {
  resetBatchImportState();
  batchImportDialogOpen.value = true;
}

function closeBatchImport() {
  if (batchImportLoading.value && batchImportStep.value === "running") return;
  batchImportDialogOpen.value = false;
}

async function chooseBatchImportFiles() {
  const paths = await open({
    multiple: true,
    title: "选择要批量导入的 Excel 文件",
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  const selectedPaths = Array.isArray(paths) ? paths : (paths ? [paths] : []);
  if (selectedPaths.length === 0) return;
  batchImportFiles.value = buildBatchImportFileItems(selectedPaths);
  batchImportStep.value = "select";
  batchImportError.value = "";
  batchImportResult.value = null;
}

function toggleBatchImportFile(path) {
  batchImportFiles.value = batchImportFiles.value.map((item) =>
    item.path === path ? { ...item, selected: !item.selected } : item
  );
}

function toggleBatchImportSelectAll() {
  const allSelected = batchImportFiles.value.length > 0 && batchImportFiles.value.every((item) => item.selected);
  batchImportFiles.value = batchImportFiles.value.map((item) => ({ ...item, selected: !allSelected }));
}

function mergeBatchImportPreview(preview) {
  const byPath = new Map((preview?.files || []).map((item) => [item.path, item]));
  batchImportFiles.value = batchImportFiles.value.map((item) => {
    const next = byPath.get(item.path);
    if (!next) return item;
    return {
      ...item,
      ...next,
      selected: item.selected,
      status: next.status || (Array.isArray(next.errors) && next.errors.length > 0 ? "error" : "ready"),
      errors: Array.isArray(next.errors) ? next.errors : [],
      rowCount: Number(next.rowCount) || 0,
      existingRows: next.existingRows ?? null,
      sheetName: next.sheetName || "",
    };
  });
}

async function previewBatchImportFiles() {
  const paths = batchImportFiles.value.filter((item) => item.selected).map((item) => item.path);
  if (paths.length === 0 || batchImportLoading.value) return;
  batchImportLoading.value = true;
  batchImportError.value = "";
  batchImportResult.value = null;
  batchImportStep.value = "preview";
  try {
    const preview = await invoke("preview_batch_import_xlsx", { paths });
    mergeBatchImportPreview(preview);
    if (preview?.canImport) {
      showCopyToast(`检测通过：${preview.tableCount} 张表，${preview.totalRows} 行`, "success");
    } else {
      showCopyToast("检测发现问题，请检查文件列表", "error");
    }
  } catch (error) {
    batchImportError.value = String(error);
    showCopyToast(`导入检测失败：${error}`, "error");
  } finally {
    batchImportLoading.value = false;
  }
}

function handleBatchImportProgress(payload = {}) {
  const percent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
  batchImportProgress.percent = percent;
  if (payload.status === "done") {
    batchImportProgress.text = "导入完成";
    batchImportProgress.percent = 100;
    return;
  }
  batchImportProgress.text = `正在导入 ${payload.tableName || "..."} (${payload.current || 0}/${payload.total || 0})`;
}

async function refreshImportedTableTabs(tableNames = []) {
  const imported = new Set(tableNames.map((name) => String(name || "").toLowerCase()).filter(Boolean));
  if (imported.size === 0) return;
  let activeNeedsReload = false;
  tableTabs.value = tableTabs.value.map((tab) => {
    const matches = imported.has(String(tab.tableName || "").toLowerCase());
    if (!matches) return tab;
    if (tab.id === activeTableTabId.value) {
      activeNeedsReload = true;
      return tab;
    }
    return { ...tab, needsReload: true };
  });
  if (activeNeedsReload && tableOpen.value) {
    resetEditChanges();
    tableView.page = 1;
    await loadTablePage({ resetFocus: true, clearHitCache: true });
  }
}

async function runBatchImport() {
  if (!batchImportSummary.value.canImport || batchImportLoading.value) return;
  const paths = batchImportFiles.value.filter((item) => item.selected).map((item) => item.path);
  batchImportLoading.value = true;
  batchImportStep.value = "running";
  batchImportError.value = "";
  batchImportProgress.percent = 0;
  batchImportProgress.text = "准备导入...";
  try {
    const result = await invoke("run_batch_import_xlsx", { request: { paths } });
    batchImportResult.value = result;
    batchImportStep.value = "result";
    await refreshImportedTableTabs((result?.files || []).map((item) => item.tableName));
    showCopyToast(`导入完成：${result.tableCount} 张表，${result.totalRows} 行`, "success");
  } catch (error) {
    batchImportStep.value = "preview";
    batchImportError.value = String(error);
    showCopyToast(`导入失败：${error}`, "error");
  } finally {
    batchImportLoading.value = false;
  }
}

async function togglePanelAlwaysOnTop() {
  config.personal.always_on_top = !config.personal.always_on_top;
  if (isTauriWindow) {
    await invoke("set_panel_always_on_top", { alwaysOnTop: config.personal.always_on_top }).catch(() => {});
  }
  showCopyToast(config.personal.always_on_top ? "已置顶" : "已取消置顶", "success");
}

async function toggleDefaultTableViewFromPanel() {
  config.personal.table_default_view = toggleTableDefaultView(config.personal.table_default_view);
  tableDetailView.value = normalizeTableDefaultView(config.personal.table_default_view);
  await persistConfig().catch(() => {});
  showCopyToast(
    `默认视图：${describeTableDefaultViewLabel(config.personal.table_default_view)}`,
    "success",
  );
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
  if (!host) return false;

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
    settingsMsg.value = applied ? "✓ 配置已填入，请测试连接" : "✗ JSON 解析失败或缺少主机字段";
  } catch {
    settingsMsg.value = "✗ JSON 解析失败或缺少主机字段";
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

function resetUpdateProgress() {
  Object.assign(updateProgress, {
    status: "idle",
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  });
}

function disposeAvailableUpdate() {
  const current = availableUpdateRef.value;
  availableUpdateRef.value = null;
  if (current?.close) {
    current.close().catch(() => {});
  }
}

function applyUpdateSettingsSnapshot(snapshot = {}) {
  const normalized = normalizeUpdateSettings({
    auto_check_updates: snapshot?.autoCheckUpdates ?? config.personal.auto_check_updates,
    last_update_check_at: snapshot?.lastUpdateCheckAt ?? config.personal.last_update_check_at,
  });
  config.personal.auto_check_updates = normalized.autoCheckUpdates;
  config.personal.last_update_check_at = normalized.lastUpdateCheckAt;
  if (snapshot?.currentVersion) {
    updateCurrentVersion.value = String(snapshot.currentVersion);
  }
}

function formatUpdateTimestamp(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatByteCount(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setPostUpdateAnnouncement(announcement) {
  postUpdateAnnouncement.version = announcement?.version || "";
  postUpdateAnnouncement.notes = announcement?.notes || "";
  postUpdateAnnouncement.notesLines = Array.isArray(announcement?.notesLines)
    ? [...announcement.notesLines]
    : [];
  postUpdateAnnouncement.pubDate = announcement?.pubDate || null;
}

function refreshPostUpdateAnnouncementFromConfig() {
  setPostUpdateAnnouncement(resolvePostUpdateAnnouncement({
    currentVersion: updateCurrentVersion.value || APP_VERSION,
    pendingAnnouncement: config.personal.pending_update_announcement,
    acknowledgedVersion: config.personal.last_update_announcement_version,
  }));
}

async function rememberPendingUpdateAnnouncementForInstall(update) {
  const announcement = buildPendingUpdateAnnouncement(update, updateNotesSummary.value);
  if (!announcement) return;

  const payload = {
    version: announcement.version,
    notes: announcement.notes,
    pub_date: announcement.pubDate,
  };
  config.personal.pending_update_announcement = payload;

  if (isTauriWindow) {
    try {
      await invoke("remember_pending_update_announcement", { announcement: payload });
      return;
    } catch (error) {
      console.error("Failed to remember pending update announcement:", error);
    }
  }

  await persistConfig().catch((error) => {
    console.error("Failed to persist pending update announcement:", error);
  });
}

async function acknowledgePostUpdateAnnouncement() {
  const version = postUpdateAnnouncement.version || updateCurrentVersion.value || APP_VERSION;
  if (!version) return;

  try {
    await invoke("acknowledge_update_announcement", { version });
  } catch (error) {
    console.error("Failed to acknowledge update announcement:", error);
    try {
      await getCurrentWindow().close();
    } catch {}
  }
}

function closeUpdateDialog() {
  if (updateInstalling.value) return;
  updateDialogOpen.value = false;
  updateError.value = "";
  updateLatestVersion.value = "";
  updateReleaseDate.value = "";
  updateNotesSummary.value = "";
  resetUpdateProgress();
  disposeAvailableUpdate();
}

async function openGiteeReleasePage() {
  try {
    await invoke("open_gitee_release_page");
  } catch {
    window.open("https://gitee.com/shelbylouis/dbsearch-release/releases", "_blank");
  }
}

async function refreshUpdateSettings() {
  if (!isTauriWindow) {
    updateCurrentVersion.value = APP_VERSION;
    return;
  }

  const snapshot = await invoke("get_update_settings").catch(() => null);
  if (snapshot) {
    applyUpdateSettingsSnapshot(snapshot);
    return;
  }

  updateCurrentVersion.value = APP_VERSION;
}

async function runAppUpdateCheck({ manual = false } = {}) {
  if (!isTauriWindow) {
    if (manual) {
      showCopyToast("仅桌面端支持自动更新", "error");
    }
    return;
  }
  if (updateChecking.value || updateInstalling.value) return;

  updateChecking.value = true;
  updateError.value = "";

  try {
    const gate = await invoke(manual ? "check_for_updates_now" : "prepare_startup_update_check");
    if (!gate) return;

    applyUpdateSettingsSnapshot({
      currentVersion: gate.currentVersion,
      autoCheckUpdates: config.personal.auto_check_updates,
      lastUpdateCheckAt: gate.checkedAt ?? config.personal.last_update_check_at,
    });

    if (!gate.shouldCheck) {
      return;
    }

    const update = await checkForUpdateWithRetry(checkForAppUpdate, {
      timeout: UPDATE_CHECK_TIMEOUT_MS,
    });
    if (!update) {
      if (manual) {
        showCopyToast("当前已是最新版本", "success");
      }
      return;
    }

    disposeAvailableUpdate();
    availableUpdateRef.value = preserveOpaqueInstance(update);
    updateLatestVersion.value = String(update.version || "");
    updateReleaseDate.value = String(update.date || "");
    updateNotesSummary.value = summarizeReleaseNotes(update.body || update.rawJson?.notes || "");

    if (manual || isPanelWindow.value) {
      updateDialogOpen.value = true;
      resetUpdateProgress();
      return;
    }

    const shouldInstallNow = await ask(
      `发现新版本 v${updateLatestVersion.value}。\n是否现在下载并安装？`,
      {
        title: "发现新版本",
        kind: "info",
        okLabel: "立即更新",
        cancelLabel: "稍后",
      },
    );

    if (shouldInstallNow) {
      if (shouldOpenUpdateDialogForInstall({
        manual,
        isPanelWindow: isPanelWindow.value,
        userConfirmedInstall: shouldInstallNow,
      })) {
        updateDialogOpen.value = true;
        resetUpdateProgress();
      }
      await installAvailableUpdate();
      return;
    }

    closeUpdateDialog();
  } catch (error) {
    if (manual) {
      showCopyToast(`检查更新失败：${String(error)}`, "error");
    }
    console.error("Failed to check for updates:", error);
  } finally {
    updateChecking.value = false;
  }
}

function startPeriodicUpdateCheck() {
  if (updateCheckTimer) return;
  updateCheckTimer = setInterval(() => {
    runAppUpdateCheck({ manual: false }).catch(() => {});
  }, 3600000);
}

function stopPeriodicUpdateCheck() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

async function installAvailableUpdate() {
  const update = availableUpdateRef.value;
  if (!update || updateInstalling.value) return;

  updateInstalling.value = true;
  updateError.value = "";
  resetUpdateProgress();

  try {
    await rememberPendingUpdateAnnouncementForInstall(update);
    await update.downloadAndInstall((event) => {
      Object.assign(updateProgress, reduceUpdateDownloadProgress(updateProgress, event));
    }, { timeout: 10 * 60 * 1000 });
    updateDialogOpen.value = false;
    showCopyToast("更新包已下载完成，即将重启应用...", "success");
    await new Promise((r) => setTimeout(r, 1200));
    await relaunch();
  } catch (error) {
    updateError.value = String(error);
    updateInstalling.value = false;
    if (String(error).includes("network") || String(error).includes("fetch") || String(error).includes("timeout") || String(error).includes("connect")) {
      showCopyToast("下载失败，网络连接异常，请检查网络后重试", "error");
    } else {
      showCopyToast(`更新失败：${String(error)}`, "error");
    }
  }
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
  <div v-if="isWelcomeWindow" class="welcome-root" @contextmenu.prevent>
    <section
      class="welcome-stage"
      :style="{ '--welcome-font-size': `${startupWelcomeFontSize}px` }"
      :aria-label="startupWelcomeText"
    >
      <svg
        v-if="startupWelcomeMode === 'stroke_order'"
        class="welcome-word welcome-word--stroke-order"
        viewBox="0 0 720 260"
        role="img"
      >
        <defs>
          <linearGradient id="startupWelcomeStrokeOrderGradient" x1="70" y1="52" x2="650" y2="205" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#ff5f57" />
            <stop offset="24%" stop-color="#ffbd2e" />
            <stop offset="48%" stop-color="#28c840" />
            <stop offset="72%" stop-color="#0a84ff" />
            <stop offset="100%" stop-color="#bf5af2" />
          </linearGradient>
        </defs>
        <g
          v-for="glyph in startupWelcomeStrokeOrderGlyphs"
          :key="glyph.id"
          class="welcome-glyph"
          :style="{ '--welcome-delay': `${glyph.delayMs}ms` }"
        >
          <text class="welcome-glyph-stroke welcome-glyph-glow" :x="glyph.x" y="158">{{ glyph.char }}</text>
          <text class="welcome-glyph-stroke" :x="glyph.x" y="158">{{ glyph.char }}</text>
          <text class="welcome-glyph-fill" :x="glyph.x" y="158">{{ glyph.char }}</text>
        </g>
      </svg>
      <svg v-else class="welcome-word" viewBox="0 0 720 260" role="img">
        <defs>
          <linearGradient id="startupWelcomeGradient" x1="70" y1="52" x2="650" y2="205" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#ff5f57" />
            <stop offset="24%" stop-color="#ffbd2e" />
            <stop offset="48%" stop-color="#28c840" />
            <stop offset="72%" stop-color="#0a84ff" />
            <stop offset="100%" stop-color="#bf5af2" />
          </linearGradient>
        </defs>
        <text class="welcome-word-stroke welcome-word-glow" x="360" y="158">{{ startupWelcomeText }}</text>
        <text class="welcome-word-stroke" x="360" y="158">{{ startupWelcomeText }}</text>
        <text class="welcome-word-fill" x="360" y="158">{{ startupWelcomeText }}</text>
      </svg>
    </section>
  </div>

  <div v-else-if="isUpdateAnnouncementWindow" class="update-announcement-root" @contextmenu.prevent>
    <section class="update-announcement-shell" role="dialog" aria-modal="true" aria-labelledby="updateAnnouncementTitle">
      <header class="update-announcement-header" data-tauri-drag-region>
        <div>
          <span class="update-announcement-kicker">更新公告</span>
          <h1 id="updateAnnouncementTitle">鹰捷已更新到 v{{ postUpdateAnnouncement.version || updateCurrentVersion }}</h1>
        </div>
        <button class="update-announcement-close" type="button" aria-label="关闭更新公告" @click="acknowledgePostUpdateAnnouncement">×</button>
      </header>

      <div class="update-announcement-meta">
        <div>
          <span>当前版本</span>
          <strong>v{{ postUpdateAnnouncement.version || updateCurrentVersion }}</strong>
        </div>
        <div v-if="postUpdateAnnouncement.pubDate">
          <span>发布时间</span>
          <strong>{{ formatUpdateTimestamp(postUpdateAnnouncement.pubDate) }}</strong>
        </div>
      </div>

      <div class="update-announcement-notes">
        <div class="update-announcement-notes-title">本次更新内容</div>
        <ul>
          <li v-for="line in postUpdateAnnouncement.notesLines" :key="line">{{ line }}</li>
        </ul>
      </div>

      <footer class="update-announcement-footer">
        <button class="primary-btn" type="button" @click="acknowledgePostUpdateAnnouncement">知道了</button>
      </footer>
    </section>
  </div>

  <section
    v-else-if="isQuickPasteWindow"
    class="quick-paste-shell"
    tabindex="0"
    @keydown="handleQuickPasteKeydown"
    @paste="handleQuickPastePaste"
    @contextmenu="handleQuickPasteContextMenu"
  >
    <header class="quick-paste-header" data-tauri-drag-region>
      <div class="quick-paste-traffic-lights" @pointerdown.stop>
        <button
          type="button"
          class="quick-paste-traffic quick-paste-traffic--close"
          aria-label="关闭快捷粘贴"
          title="关闭"
          @click="closeQuickPasteWindow"
        ></button>
        <button
          type="button"
          class="quick-paste-traffic quick-paste-traffic--minimize"
          aria-label="最小化快捷粘贴"
          title="最小化"
          @click="minimizeQuickPasteWindow"
        ></button>
        <button
          type="button"
          class="quick-paste-traffic quick-paste-traffic--zoom"
          aria-label="最大化或还原快捷粘贴"
          title="最大化/还原"
          @click="toggleQuickPasteZoom"
        ></button>
      </div>
      <div class="quick-paste-header-actions">
        <button type="button" class="quick-paste-ghost-button" @click="openQuickPasteCreate">新建</button>
      </div>
    </header>

    <main class="quick-paste-body" :style="quickPasteBodyStyle">
      <aside class="quick-paste-sidebar">
        <div class="quick-paste-sidebar-brand" data-tauri-drag-region>
          <img class="quick-paste-logo-mark" src="/quick-paste-logo.png" alt="" draggable="false" />
          <span class="quick-paste-wordmark" aria-label="快捷粘贴 Quick Paste">
            <strong>快捷粘贴</strong>
            <small>QUICK PASTE</small>
          </span>
        </div>
        <input v-model="quickPaste.query" class="quick-paste-search" placeholder="搜索标题或内容" />
        <nav class="quick-paste-categories" aria-label="快捷粘贴分类">
          <button
            v-for="category in quickPasteCategories"
            :key="category.key"
            type="button"
            :class="['quick-paste-category', { active: quickPaste.activeCategory === category.key }]"
            @click="quickPaste.activeCategory = category.key"
          >
            <span class="quick-paste-category-label">
              <span class="quick-paste-category-icon" aria-hidden="true">{{ category.icon }}</span>
              <span>{{ category.label }}</span>
            </span>
            <small>{{ getQuickPasteCategoryCount(category.key) }}</small>
          </button>
        </nav>
      </aside>

      <div
        class="quick-paste-pane-resizer"
        role="separator"
        aria-label="调整分类栏宽度"
        @pointerdown="startQuickPastePaneResize($event, 'sidebar')"
      ></div>

      <section class="quick-paste-list-pane">
        <div
          v-for="snippet in filteredQuickPasteSnippets"
          :key="snippet.id"
          :class="['quick-paste-list-item', { active: quickPaste.selectedId === snippet.id }]"
          role="button"
          tabindex="0"
          @click="quickPaste.selectedId = snippet.id"
          @dblclick="outputOrCopyQuickPasteSnippet(snippet)"
          @keydown.enter.prevent="outputOrCopyQuickPasteSnippet(snippet)"
        >
          <button
            type="button"
            class="quick-paste-item-delete"
            aria-label="删除文本"
            title="删除"
            @click.stop="deleteQuickPasteSnippet(snippet)"
            @dblclick.stop
            @keydown.enter.stop
          >×</button>
          <button
            type="button"
            :class="['quick-paste-item-star', { active: snippet.favorite }]"
            :aria-label="snippet.favorite ? '取消常用' : '设为常用'"
            :title="snippet.favorite ? '取消常用' : '设为常用'"
            @click.stop="toggleQuickPasteFavorite(snippet)"
            @dblclick.stop
            @keydown.enter.stop
          >★</button>
          <span class="quick-paste-item-title">{{ snippet.title }}</span>
          <span class="quick-paste-item-preview">{{ isQuickPasteImageSnippet(snippet) ? '图片' : snippet.content }}</span>
          <span class="quick-paste-item-badges">
            <small>{{ getQuickPasteSnippetKindLabel(snippet) }}</small>
            <small v-if="snippet.favorite">常用</small>
            <small v-if="snippet.isDefault">默认</small>
          </span>
        </div>
        <div v-if="!filteredQuickPasteSnippets.length" class="quick-paste-empty-list">暂无匹配文本</div>
      </section>

      <div
        class="quick-paste-pane-resizer"
        role="separator"
        aria-label="调整列表栏宽度"
        @pointerdown="startQuickPastePaneResize($event, 'list')"
      ></div>

      <section class="quick-paste-preview">
        <template v-if="selectedQuickPasteSnippet">
          <div class="quick-paste-preview-header">
            <div class="quick-paste-preview-title-wrap">
              <input
                v-model="selectedQuickPasteSnippet.title"
                class="quick-paste-title-input"
                aria-label="标题"
                @change="saveQuickPasteInlineSnippet(selectedQuickPasteSnippet)"
                @blur="saveQuickPasteInlineSnippet(selectedQuickPasteSnippet)"
              />
              <p>{{ getQuickPasteSnippetKindLabel(selectedQuickPasteSnippet) }}</p>
            </div>
          </div>
          <div
            :key="selectedQuickPasteSnippet.id"
            ref="quickPasteEditorRef"
            class="quick-paste-note-editor"
            contenteditable="true"
            role="textbox"
            aria-label="内容"
            v-html="quickPasteEditorHtml"
            @input="updateQuickPasteEditorHtml(selectedQuickPasteSnippet)"
            @paste="handleQuickPasteEditorPaste"
            @blur="saveQuickPasteEditorHtml(selectedQuickPasteSnippet)"
            @contextmenu.capture="handleQuickPasteEditorContextMenu"
            @dblclick.capture="handleQuickPasteEditorDoubleClick"
          ></div>
          <div class="quick-paste-preview-actions">
            <button type="button" @click="setQuickPasteDefault(selectedQuickPasteSnippet)">设为默认</button>
            <button type="button" @click="copyQuickPasteSnippet(selectedQuickPasteSnippet)">复制内容</button>
          </div>
        </template>
        <div v-else class="quick-paste-empty">
          <h2>暂无内容</h2>
          <p>新建文本，或复制图片后按 Ctrl+V 快速保存。</p>
          <button type="button" @click="openQuickPasteCreate">新建</button>
        </div>
      </section>
    </main>

    <div v-if="quickPaste.toast.visible" :class="['quick-paste-toast', quickPaste.toast.tone]">
      {{ quickPaste.toast.text }}
    </div>

    <div
      v-if="quickPaste.imagePreview.visible"
      class="quick-paste-image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="quickPaste.imagePreview.title"
      @click.self="closeQuickPasteImagePreview"
    >
      <div class="quick-paste-image-preview">
        <header>
          <strong>{{ quickPaste.imagePreview.title }}</strong>
          <button type="button" aria-label="关闭图片预览" title="关闭" @click="closeQuickPasteImagePreview">×</button>
        </header>
        <img :src="quickPaste.imagePreview.src" :alt="quickPaste.imagePreview.title" />
      </div>
    </div>
  </section>

  <main
    v-else-if="isPanelWindow"
    :class="['app-shell', 'open', 'panel-shell', { 'reduced-transparency': reducedTransparencyEnabled }]"
    id="appShell"
    tabindex="-1"
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
      :data-time-phase="weatherPresentation.timePhase"
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
        <div v-if="showHeaderShelf" class="titlebar-shelf-wrap" @click.self="closeAllOrgMenus">
          <div class="titlebar-shelf-controls">
            <div class="titlebar-popover-wrap">
              <button
                :class="['titlebar-shelf-btn', { active: recentTabsDropdownOpen }]"
                :title="'最近打开'"
                aria-label="最近打开"
                @pointerdown.stop
                @click.stop="toggleRecentTabsDropdown"
              >
                <svg class="titlebar-shelf-icon titlebar-shelf-icon--search" viewBox="0 0 1024 1024" aria-hidden="true">
                  <path d="M713.088 582.826667l49.152-40.96 106.538667 127.829333-49.194667 40.96zM162.986667 207.786667h170.666666v64h-170.666666zM162.986667 506.026667h170.666666v64h-170.666666zM178.346667 804.266667h682.666666v64h-682.666666z" fill="currentColor"></path>
                  <path d="M614.826667 646.4c-135.253333 0-245.333333-110.08-245.333334-245.333333s110.08-245.333333 245.333334-245.333334 245.333333 110.08 245.333333 245.333334-110.08 245.333333-245.333333 245.333333z m0-426.666667c-99.84 0-181.333333 81.493333-181.333334 181.333334s81.493333 181.333333 181.333334 181.333333 181.333333-81.493333 181.333333-181.333333c0-100.266667-81.493333-181.333333-181.333333-181.333334z" fill="currentColor"></path>
                </svg>
              </button>
              <Transition name="recent-dropdown">
                <div v-if="recentTabsDropdownOpen" class="recent-tabs-dropdown titlebar-dropdown-panel" @click.stop>
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

            <div class="titlebar-popover-wrap">
              <button
                :class="['titlebar-shelf-btn', { active: favoritesDropdownOpen || activeFolder !== 'all', 'is-filtered': activeFolder !== 'all' }]"
                :title="activeFolder === 'all' ? '收藏夹' : `收藏夹：${activeFolderName}`"
                aria-label="收藏夹"
                @pointerdown.stop
                @click.stop="toggleFavoritesDropdown"
              >
                <svg class="titlebar-shelf-icon" viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M6.5 13.5a3 3 0 0 1 3-3h8l3 3h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3h-25a3 3 0 0 1-3-3z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"></path>
                </svg>
                <span v-if="activeFolder !== 'all'" class="titlebar-shelf-indicator"></span>
              </button>
              <Transition name="recent-dropdown">
                <div v-if="favoritesDropdownOpen" class="favorites-dropdown titlebar-dropdown-panel" @click.stop>
                  <div class="recent-tabs-header">
                    <span>收藏夹</span>
                    <button class="recent-tabs-close" @click="favoritesDropdownOpen = false">✕</button>
                  </div>
                  <div class="favorites-dropdown-list">
                    <button
                      v-for="item in favoritesMenuItems.filter((entry) => entry.kind === 'starred')"
                      :key="item.key"
                      :class="['favorites-item', { active: item.active }]"
                      @click="selectFavoriteFilter(item.id)"
                    >
                      <span class="favorites-item-icon favorites-item-icon--star">★</span>
                      <span class="favorites-item-label">{{ item.label }}</span>
                      <span class="favorites-item-count">{{ item.tableCount }}</span>
                    </button>
                    <div class="favorites-divider"></div>
                    <div v-if="tableFolders.length === 0" class="favorites-empty">暂无文件夹，点击下方加号创建</div>
                    <template v-for="folder in tableFolders" :key="folder.id">
                      <button
                        v-if="folderRenameId !== folder.id"
                        :class="['favorites-item', { active: activeFolder === folder.id }]"
                        @click="selectFavoriteFilter(folder.id)"
                        @contextmenu.prevent.stop="openFolderCtxMenu($event, folder.id)"
                      >
                        <span class="favorites-item-label">{{ folder.name }}</span>
                        <span class="favorites-item-count">{{ folder.tables.length }}</span>
                      </button>
                      <input
                        v-else
                        class="favorites-rename-input"
                        v-model="folderRenameValue"
                        @blur="commitFolderRename"
                        @keydown.enter="commitFolderRename"
                        @keydown.escape="folderRenameId = null"
                        @vue:mounted="({ el }) => nextTick(() => el.focus())"
                      />
                    </template>
                  </div>
                  <div class="favorites-footer">
                    <button class="favorites-add-btn" title="新建文件夹" @click="handleNewFolderFromFavorites">＋</button>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <section
            v-if="showPanelTabStrip"
            ref="panelTabsRef"
            :class="['panel-tab-strip', 'panel-tab-strip--titlebar', { 'is-compressed': panelTabsCompressed }]"
            @click.self="closeAllOrgMenus"
            @wheel="onTableTabsWheel"
          >
            <button
              v-for="tab in panelTabs"
              :key="tab.key"
              :id="tab.tabId ? `panel-tab-${tab.tabId}` : undefined"
              :data-tab-id="tab.tabId || undefined"
              :data-tab-kind="tab.kind"
              :data-tab-draggable="tab.draggable ? 'true' : 'false'"
              :class="[
                'panel-tab-chip',
                {
                  active: tab.active,
                  opened: tab.opened,
                  starred: tab.starred,
                  dragging: tab.tabId === panelTabDrag.tabId && panelTabDrag.dragging,
                  'drag-over-before': panelTabDrag.overTabId === tab.tabId && !panelTabDrag.insertAfter,
                  'drag-over-after': panelTabDrag.overTabId === tab.tabId && panelTabDrag.insertAfter,
                },
              ]"
              :title="tab.tableName"
              @click="activatePanelChromeTab(tab)"
              @pointerdown="onPanelTabPointerDown($event, tab)"
            >
              <span v-if="tab.starred" class="panel-tab-chip-star">★</span>
              <span class="panel-tab-chip-label">{{ tab.tableName }}</span>
              <span
                v-if="tab.opened"
                class="panel-tab-chip-close"
                title="关闭标签"
                @pointerdown.stop
                @click.stop="closePanelChromeTab(tab)"
              >✕</span>
            </button>
            <button
              class="panel-tab-chip-add"
              :title="`打开表 (${getPanelShortcut('openTableCommand')})`"
              aria-label="打开表"
              @click.stop="openTableCommandPalette()"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M8 3.25v9.5M3.25 8h9.5" />
              </svg>
            </button>
          </section>

        </div>
      </header>
      <div v-if="recentTabsDropdownOpen || favoritesDropdownOpen" class="recent-tabs-backdrop" @click="closeAllOrgMenus"></div>

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

        <div class="results-layout" id="resultsWrap">
        <aside :class="['result-sidebar', { 'kb-zone': navZone === 'sidebar' }]">
          <div class="demo-sidebar-heading">Data Explorer</div>
          <div class="result-sidebar-tabs">
            <button
              v-for="tab in resultTabs" :key="tab.key"
              :class="['sidebar-item sidebar-item--demo', { active: activeResultTab === tab.key }]"
              @click="activeResultTab = tab.key; navZone = 'sidebar'"
            >
              <span class="sidebar-item-main">
                <span class="sidebar-item-icon" :data-icon="tab.icon" aria-hidden="true"></span>
                <span class="sidebar-item-label">{{ tab.label }}</span>
              </span>
              <span class="sidebar-count" v-if="tab.count > 0">{{ tab.count }}</span>
            </button>
          </div>
          <div class="sidebar-tool-grid" aria-label="批量工具">
            <button class="sidebar-tool-btn" type="button" title="批量导出" @click="openBatchExport">
              <svg class="sidebar-tool-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7 20h10a2 2 0 0 0 2-2v-5" />
                <path d="M5 13v5a2 2 0 0 0 2 2" />
                <path d="M12 4v10" />
                <path d="M8 8l4-4 4 4" />
                <path d="M8 14h8" />
              </svg>
              <span class="sidebar-tool-label">批量导出</span>
            </button>
            <button class="sidebar-tool-btn" type="button" title="批量导入" @click="openBatchImport">
              <svg class="sidebar-tool-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7 4h10a2 2 0 0 1 2 2v5" />
                <path d="M5 11V6a2 2 0 0 1 2-2" />
                <path d="M12 20V10" />
                <path d="M8 16l4 4 4-4" />
                <path d="M8 10h8" />
              </svg>
              <span class="sidebar-tool-label">批量导入</span>
            </button>
            <button class="sidebar-tool-btn" type="button" :title="panelTableDefaultViewTitle" @click="toggleDefaultTableViewFromPanel">
              <svg class="sidebar-tool-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 5h16v14H4z" />
                <path d="M4 10h16" />
                <path d="M9 10v9" />
                <path d="M14 10v9" />
              </svg>
              <span class="sidebar-tool-label">{{ panelTableDefaultViewLabel }}</span>
            </button>
            <button
              :class="['sidebar-tool-btn', 'sidebar-tool-btn--pin', { active: config.personal.always_on_top }]"
              type="button"
              :title="config.personal.always_on_top ? '取消置顶' : '钉住窗口'"
              @click="togglePanelAlwaysOnTop"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M14 3l7 7-3 1-4 4v4l-2 2-3-6-6-3 2-2h4l4-4 1-3z" />
              </svg>
              <span class="sidebar-tool-label">{{ config.personal.always_on_top ? '已钉住' : '钉住' }}</span>
            </button>
          </div>
        </aside>

        <section
          ref="resultsMainRef"
          :class="['results-main', { 'table-list-mode': showTableResultHeader }]"
          :style="tableListLayoutStyle"
        >
          <div v-if="showTableScopeBar" class="table-scope-bar">
            <button class="table-scope-reset" @click="selectFavoriteFilter('all')">全部</button>
            <span class="table-scope-current">当前筛选：{{ activeFolderName }}</span>
          </div>
          <div v-if="showTableResultHeader" class="table-results-header">
            <button
              :class="['table-results-header-btn', { flash: tableSortFlashColumn === 'name' }]"
              @click="toggleTableSort('name')"
            >
              <span class="table-results-header-label">表名</span>
              <span
                v-if="tableSortMeta.column === 'name'"
                class="table-results-header-indicator"
                :data-direction="tableSortMeta.direction"
                aria-hidden="true"
              >
                <svg viewBox="0 0 12 8" focusable="false" aria-hidden="true">
                  <path d="M2 5.5L6 2L10 5.5" />
                </svg>
              </span>
            </button>
            <button
              :class="['table-results-header-btn', { flash: tableSortFlashColumn === 'comment' }]"
              @click="toggleTableSort('comment')"
            >
              <span class="table-results-header-label">备注</span>
              <span
                v-if="tableSortMeta.column === 'comment'"
                class="table-results-header-indicator"
                :data-direction="tableSortMeta.direction"
                aria-hidden="true"
              >
                <svg viewBox="0 0 12 8" focusable="false" aria-hidden="true">
                  <path d="M2 5.5L6 2L10 5.5" />
                </svg>
              </span>
            </button>
            <div class="table-results-header-spacer">操作</div>
          </div>
          <div class="list list-main">
            <template v-for="(item, idx) in filteredResults" :key="getResultKey(item)">
              <button
                v-if="item._type === 'table'"
                :id="`result-item-${idx}`"
                :class="['list-item demo-result-card demo-result-card--table', { 'kb-active': navZone === 'results' && navResultIndex === idx }]"
                @click="navZone = 'results'; navResultIndex = idx; openFromMeta(item)"
                @contextmenu="openItemCtxMenu($event, item.table_name)"
              >
                <div class="table-result-name">
                  <span :class="['star-btn', { starred: starredTables.has(item.table_name) }]" @click.stop="toggleStar(item.table_name)" title="星标">{{ starredTables.has(item.table_name) ? '★' : '☆' }}</span>
                  <div class="main" v-html="renderHighlighted(item.table_name)"></div>
                </div>
                <div class="table-result-comment" v-html="renderHighlighted(getTableComment(item.table_name) || '-')"></div>
                <div class="table-result-tools">
                  <span
                    v-if="getTableFolderChip(item.table_name).visible"
                    :class="['badge', 'folder-badge', { 'is-uncategorized': getTableFolderChip(item.table_name).uncategorized }]"
                    :title="getTableFolderChip(item.table_name).title"
                  >
                    <span class="folder-badge-label">{{ getTableFolderChip(item.table_name).label }}</span>
                    <span v-if="getTableFolderChip(item.table_name).extraCount > 0" class="folder-badge-more">+{{ getTableFolderChip(item.table_name).extraCount }}</span>
                  </span>
                  <span class="copy-icon-btn" @click.stop="copyText(item.table_name)" title="复制">⎘</span>
                </div>
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
        <div v-if="databaseMenuOpen" class="database-menu-backdrop" @click="closeDatabaseMenu" @contextmenu.prevent="closeDatabaseMenu"></div>
        <div v-if="databaseMenuOpen" class="database-menu-popover">
          <div class="database-menu-title">选择数据库</div>
          <div v-if="databaseMenuLoading" class="database-menu-state">读取中...</div>
          <div v-else-if="databaseMenuError" class="database-menu-state error">{{ databaseMenuError }}</div>
          <div v-else class="database-menu-list">
            <button
              v-for="database in availableDatabases"
              :key="database"
              :class="['database-menu-item', { selected: database === dbName }]"
              @click="selectDatabase(database)"
            >
              <span>{{ database }}</span>
              <span v-if="database === dbName" class="database-menu-check">✓</span>
            </button>
          </div>
        </div>

        <div v-if="templateMenuOpen" class="database-menu-backdrop template-menu-backdrop" @click="closeTemplateMenu" @contextmenu.prevent="closeTemplateMenu"></div>
        <div
          v-if="templateMenuOpen" class="database-menu-popover template-menu-popover"
          :style="{ left: templateMenuPosition.left + 'px', bottom: templateMenuPosition.bottom + 'px' }"
        >
          <div class="database-menu-title">选择连接模板</div>
          <div class="database-menu-list template-menu-list">
            <button
              v-for="(tpl, idx) in config.shared.db_templates"
              :key="`${tpl.name || 'template'}-${idx}`"
              :class="['database-menu-item template-menu-item', { selected: idx === activeTemplateIndex }]"
              :disabled="templateSwitching"
              @click="selectTemplateFromMenu(idx)"
            >
              <span class="template-menu-copy">
                <span class="template-menu-main">{{ tpl.name || '未命名模板' }}</span>
                <span class="template-menu-sub">{{ tpl.db?.host || '-' }}:{{ tpl.db?.port || 3306 }}{{ tpl.db?.database ? `/${tpl.db.database}` : '' }}</span>
              </span>
              <span v-if="idx === activeTemplateIndex" class="database-menu-check">✓</span>
            </button>
          </div>
        </div>

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
      <div class="panel-footer panel-footer--demo panel-footer--controls">
        <div class="panel-footer-controls-left">
          <button class="header-connection footer-db-connection footer-db-selector" :title="dbConnected ? `${dbName}（点击选择数据库）` : '未连接数据库'" @click="toggleDatabaseMenu">
            <span :class="['db-status', { connected: dbConnected }]" id="dbStatusDot"></span>
            <span class="db-name" id="dbName">{{ dbConnected ? dbName : '未连接' }}</span>
          </button>
        </div>
        <div class="panel-footer-controls-right">
          <div v-if="showTitlebarDbSwitcher" class="footer-db-switcher">
            <div class="template-quick-switch footer-template-switch">
              <button
                class="small-btn template-switch-btn"
                :disabled="templateSwitching || config.shared.db_templates.length === 0"
                title="上一模板"
                @click="switchTemplateByStep(-1)"
              >
                ◀
              </button>
              <button
                class="template-current-name template-current-button"
                :title="config.shared.db_templates.length > 0 ? `${activeTemplateName}（点击切换模板）` : '暂无连接模板'"
                :disabled="templateSwitching || config.shared.db_templates.length === 0"
                @click="toggleTemplateMenu"
              >
                {{ activeTemplateName }}
              </button>
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
          <button
            class="header-weather header-weather--action footer-weather-action"
            :title="`${FIXED_WEATHER_CITY} ${weatherHeaderLabel} ${weatherTemp}°C`"
            @click="openSettings('appearance')"
          >
            <span class="header-weather-icon">{{ weatherHeaderIcon }}</span>
            <span class="header-weather-city">{{ FIXED_WEATHER_CITY }}</span>
            <span class="header-weather-temp">{{ weatherTemp }}°</span>
          </button>
          <div class="header-actions footer-actions">
            <button class="icon-btn icon-btn-subtle" title="设置" @click="openSettings()">⚙</button>
          </div>
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

  <main
    v-else-if="isSyncWorkspaceWindow"
    :class="['sw-root', 'sync-center-root', {
      'has-log-drawer': syncCenterLogDrawerVisible,
      'is-sidebar-collapsed': syncCenterSidebarCollapsed,
    }]"
    :style="{ '--sync-center-sidebar-width': `${syncCenterSidebarWidth}px` }"
    @contextmenu.prevent
  >
    <div class="sync-center-wallpaper" aria-hidden="true"></div>

    <div class="sync-center-drag-strip" aria-hidden="true" @pointerdown="syncWorkspaceHeaderPointerDown"></div>

    <Transition name="sync-center-top-button">
      <button
        v-if="syncCenterSidebarCollapsed"
        class="sync-center-sidebar-restore"
        type="button"
        title="展开侧栏"
        aria-label="展开同步中心侧栏"
        @pointerdown.stop
        @click="toggleSyncCenterSidebarCollapsed"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path d="M10 5v14" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path d="M7 9h.01M7 12h.01M7 15h.01" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        </svg>
      </button>
    </Transition>

    <div class="sync-center-top-actions" @pointerdown.stop>
      <button
        :class="['sw-toolbar-btn', 'sync-center-log-toggle', { selected: syncCenterLogOpen }]"
        type="button"
        title="日志"
        aria-label="打开或关闭同步日志"
        @click="toggleSyncCenterLogDrawer"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 6h10M7 10h10M7 14h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <rect x="4" y="3.5" width="16" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
      </button>
      <button
        class="sw-toolbar-btn"
        type="button"
        title="设置"
        aria-label="打开同步中心设置"
        @click="openSyncSettings"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M18.3 13.3c.05-.42.05-.72 0-1.14l1.55-1.18-1.65-2.86-1.83.74a7.2 7.2 0 0 0-1-.58L15.1 6.3H8.9l-.27 1.98c-.35.16-.69.36-1 .58L5.8 8.12l-1.65 2.86 1.55 1.18a6.4 6.4 0 0 0 0 1.14l-1.55 1.18 1.65 2.86 1.83-.74c.31.22.65.42 1 .58l.27 1.98h6.2l.27-1.98c.35-.16.69-.36 1-.58l1.83.74 1.65-2.86-1.55-1.18Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
        </svg>
      </button>
    </div>



    <div class="sync-center-resize-handles" aria-hidden="true">
      <div class="sync-center-resize-handle is-n" @pointerdown="startSyncCenterResize($event, 'North')"></div>
      <div class="sync-center-resize-handle is-e" @pointerdown="startSyncCenterResize($event, 'East')"></div>
      <div class="sync-center-resize-handle is-s" @pointerdown="startSyncCenterResize($event, 'South')"></div>
      <div class="sync-center-resize-handle is-w" @pointerdown="startSyncCenterResize($event, 'West')"></div>
      <div class="sync-center-resize-handle is-ne" @pointerdown="startSyncCenterResize($event, 'NorthEast')"></div>
      <div class="sync-center-resize-handle is-nw" @pointerdown="startSyncCenterResize($event, 'NorthWest')"></div>
      <div class="sync-center-resize-handle is-se" @pointerdown="startSyncCenterResize($event, 'SouthEast')"></div>
      <div class="sync-center-resize-handle is-sw" @pointerdown="startSyncCenterResize($event, 'SouthWest')"></div>
    </div>

    <div class="sync-center-layout">
      <nav class="sw-sidebar sync-center-sidebar sync-center-sidebar-shell">
        <div class="sync-center-sidebar-chrome" @pointerdown="syncWorkspaceHeaderPointerDown">
          <div class="traffic-lights" @dblclick.stop @pointerdown.stop>
            <button class="traffic-btn traffic-red" title="关闭" aria-label="关闭同步中心" @click="closeSyncWorkspaceWindow" />
            <button class="traffic-btn traffic-yellow" title="最小化" aria-label="最小化同步中心" @click="syncWorkspaceMinimize" />
            <button class="traffic-btn traffic-green" title="最大化/还原" aria-label="最大化或还原同步中心" @click="syncWorkspaceToggleMaximize" />
          </div>
          <button
            class="sync-center-sidebar-tool"
            type="button"
            title="收起侧栏"
            aria-label="收起同步中心侧栏"
            @pointerdown.stop
            @click="toggleSyncCenterSidebarCollapsed"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="5" width="16" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path d="M10 5v14" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path d="M7 9h.01M7 12h.01M7 15h.01" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        <div class="sync-center-sidebar-stack">
          <section
            :class="['sync-center-sidebar-section', 'is-database-sync', {
              selected: syncCenterMode === 'database',
              collapsed: syncCenterSectionCollapsed.database,
            }]"
          >
            <div class="sync-center-sidebar-section-row">
              <button
                class="sync-center-sidebar-section-head"
                type="button"
                @click="toggleSyncCenterSection('database')"
              >
                <span class="sync-center-sidebar-copy">
                  <span>数据库同步</span>
                  <small>{{ syncCenterDbStatusText }}</small>
                </span>
                <span class="sync-center-sidebar-stat">{{ syncCenterDbProfilesView.length }}项</span>
                <span class="sync-center-sidebar-chevron" aria-hidden="true">›</span>
              </button>
              <button
                class="sync-center-sidebar-add"
                type="button"
                title="新增同步配置"
                aria-label="新增数据库同步配置"
                :disabled="syncCenterDbSidebarState.running || syncCenterDbSidebarState.connecting"
                @click.stop="addDbMigrationProfileFromSyncCenter"
              >
                +
              </button>
            </div>
            <div v-show="!syncCenterSectionCollapsed.database" class="sync-center-sidebar-items">
              <button
                v-for="profile in syncCenterDbProfilesFiltered"
                :key="profile.id"
                :class="['sw-sidebar-item', { selected: syncCenterMode === 'database' && profile.id === syncCenterDbSidebarState.activeProfileId }]"
                :disabled="syncCenterDbSidebarState.running || syncCenterDbSidebarState.connecting"
                @click="selectDbMigrationProfileFromSyncCenter(profile.id)"
                @contextmenu.prevent="openSyncCenterCtxMenu($event, profile.id, 'database')"
              >
                <span :class="['sw-sidebar-status-dot', `is-${profile.statusTone || 'idle'}`]"></span>
                <span class="sw-sidebar-copy">
                  <span class="sw-sidebar-label">{{ profile.name }}</span>
                  <span class="sw-sidebar-time" :title="profile.summary">{{ profile.summary }}</span>
                </span>
              </button>
              <div v-if="syncCenterDbProfilesFiltered.length === 0" class="sync-center-sidebar-empty">
                {{ syncCenterDbProfilesView.length === 0 ? '暂无同步配置' : '没有匹配配置' }}
              </div>
            </div>
          </section>

          <section
            :class="['sync-center-sidebar-section', 'is-transfer', {
              selected: syncCenterMode === 'file',
              collapsed: syncCenterSectionCollapsed.file,
            }]"
          >
            <div class="sync-center-sidebar-section-row">
              <button
                class="sync-center-sidebar-section-head"
                type="button"
                @click="toggleSyncCenterSection('file')"
              >
                <span class="sync-center-sidebar-copy">
                  <span>转表并同步</span>
                  <small>{{ currentProfileStatusText }}</small>
                </span>
                <span class="sync-center-sidebar-stat">{{ syncWorkspaceProfilesView.length }}项</span>
                <span class="sync-center-sidebar-chevron" aria-hidden="true">›</span>
              </button>
              <button
                class="sync-center-sidebar-add"
                type="button"
                title="新增迁移模板"
                aria-label="新增迁移模板"
                :disabled="syncWorkspaceRunning"
                @click.stop="addSyncProfileFromSyncCenter"
              >
                +
              </button>
            </div>
            <div v-show="!syncCenterSectionCollapsed.file" class="sync-center-sidebar-items">
              <button
                v-for="profile in syncCenterFileProfilesFiltered"
                :key="profile.id"
                :class="['sw-sidebar-item', { selected: syncCenterMode === 'file' && profile.id === syncWorkspaceActiveProfileId }]"
                @click="selectSyncProfileFromSyncCenter(profile.id)"
                @contextmenu.prevent="openSyncCenterCtxMenu($event, profile.id, 'file')"
              >
                <span :class="['sw-sidebar-status-dot', `is-${syncWorkspaceRunning && syncWorkspaceRunProfileId === profile.id ? 'running' : (profile.last_run_status || 'idle')}`]"></span>
                <span class="sw-sidebar-copy">
                  <span class="sw-sidebar-label">{{ profile.name }}</span>
                  <span class="sw-sidebar-time">
                    {{ profile.last_run_at ? formatSyncWorkspaceTimestamp(profile.last_run_at) : (profile.last_run_summary || '未执行') }}
                  </span>
                </span>
              </button>
              <div v-if="syncCenterFileProfilesFiltered.length === 0" class="sync-center-sidebar-empty">
                {{ syncWorkspaceProfilesView.length === 0 ? '暂无迁移模板' : '没有匹配模板' }}
              </div>
            </div>
          </section>
        </div>
      </nav>

      <div
        class="sync-center-sidebar-resizer"
        title="拖拽调整左侧宽度"
        @pointerdown="startSyncCenterSidebarResize"
      ></div>

      <section v-show="syncCenterMode === 'file'" class="sync-center-view sync-center-file-view">
        <div class="sw-body sync-center-file-body">
          <section class="sw-content">
            <template v-if="activeSyncProfile">
              <div class="sw-content-header">
                <h1 class="sw-profile-name">{{ activeSyncProfile.name }}</h1>
                <div class="sw-status-line">
                  <span :class="['sw-status-badge', `is-${currentProfileStatusTone}`]">{{ currentProfileStatusText }}</span>
                  <span v-if="activeSyncProfile.last_run_at" class="sync-center-status-time">{{ formatSyncWorkspaceTimestamp(activeSyncProfile.last_run_at) }}</span>
                </div>
                <div class="sync-center-hero-metrics" aria-label="同步摘要">
                  <span><strong>4</strong><small>执行步骤</small></span>
                  <span><strong>{{ syncWorkspaceTimelineView.length }}</strong><small>日志条目</small></span>
                </div>
              </div>

              <div class="sw-action-row">
                <button
                  class="sw-run-btn"
                  :disabled="!canRunSyncProfile(activeSyncProfile) || syncWorkspaceRunning"
                  @click="runActiveSyncProfile"
                >
                  {{ syncWorkspaceRunning && syncWorkspaceRunProfileId === activeSyncProfile.id ? '同步中...' : '运行同步' }}
                </button>
                <button
                  v-if="activeSyncProfile.target_path"
                  class="sw-open-dir-btn"
                  @click="openSyncTargetDir"
                  title="在资源管理器中打开项目目标路径"
                >
                  打开目标目录
                </button>
              </div>

              <div v-if="syncWorkspaceMessage" :class="['sw-banner', `tone-${syncWorkspaceMessageTone}`]">
                {{ syncWorkspaceMessage }}
              </div>

              <div v-if="!canRunSyncProfile(activeSyncProfile) || syncContentEditing" class="sw-config-form">
                <div class="sw-config-form-title">连接配置</div>
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

            </template>

            <div v-else class="sw-empty">
              <div class="sw-empty-title">先创建一套配置</div>
              <div class="sw-empty-desc">一键将数据库转成本地表并同步到目标目录，同步前会自动更新目标目录</div>
              <button class="sw-empty-btn" @click="addSyncProfileFromSyncCenter">创建第一套配置</button>
            </div>
          </section>
        </div>
      </section>

      <DbMigrationWorkspace
        ref="dbMigrationWorkspaceRef"
        v-show="syncCenterMode === 'database'"
        embedded
        hide-sidebar
        :file-sync-summary="syncCenterFileSummary"
        class="sync-center-view sync-center-db-view"
        @log-state="handleDbMigrationLogState"
        @sidebar-state="handleDbMigrationSidebarState"
        @switch-mode="selectSyncCenterMode"
        @add-file-sync="addSyncProfileFromSyncCenter"
        @close-window="closeSyncWorkspaceWindow"
        @minimize-window="syncWorkspaceMinimize"
        @toggle-maximize="syncWorkspaceToggleMaximize"
      />

      <aside
        :class="['sync-center-log-drawer', { 'is-open': syncCenterLogDrawerVisible }]"
        :aria-hidden="!syncCenterLogDrawerVisible"
      >
        <header class="sync-center-log-header">
          <div>
            <h2>{{ syncCenterLogTitle }}</h2>
            <span>{{ syncCenterActiveLogEntries.length }} 条</span>
          </div>
          <button class="sw-toolbar-btn" title="关闭日志" type="button" @click="syncCenterLogOpen = false">✕</button>
        </header>

        <ol v-if="syncCenterActiveLogEntries.length > 0" class="sw-log-list-inner sync-center-log-list">
          <li v-for="entry in syncCenterActiveLogEntries" :key="entry.key" class="sw-log-entry">
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
        <div v-else class="sync-center-log-empty">
          <div class="sync-center-log-empty-title">{{ syncCenterActiveLogEmptyText }}</div>
          <ol class="sync-center-log-steps">
            <li v-for="step in syncCenterActiveFallbackSteps" :key="step.key" class="sync-center-log-step">
              <span :class="['sw-step-icon', `is-${step.status}`]">{{ step.icon }}</span>
              <span class="sw-step-label">{{ step.label }}</span>
            </li>
          </ol>
        </div>
      </aside>
    </div>

    <!-- Settings Sheet -->
    <Transition name="sync-center-settings">
      <div v-if="syncSettingsOpen" class="sw-settings-overlay sync-center-settings-overlay" @click.self="closeSyncSettings">
        <section class="sw-settings-sheet sync-center-settings-sheet">
          <header class="sw-settings-header sync-center-settings-header">
            <div>
              <h2>同步中心设置</h2>
              <p>分别管理数据库同步与转表并同步模板</p>
            </div>
            <button class="sw-toolbar-btn" type="button" title="关闭设置" @click="closeSyncSettings">✕</button>
          </header>

          <div class="sw-settings-body sync-center-settings-body">
            <section class="sw-settings-section sync-center-settings-hotkey">
              <div class="sw-settings-section-title">快捷键</div>
              <div class="sw-settings-field">
                <span class="sw-settings-field-label">打开同步中心</span>
                <input
                  class="sw-settings-input"
                  :value="syncWorkspaceHotkey"
                  type="text"
                  readonly
                  :placeholder="syncWorkspaceHotkeyPlaceholder"
                  @keydown="onSyncWorkspaceHotkeyInputKeydown"
                />
              </div>
            </section>

            <div class="sync-center-settings-grid">
              <section class="sw-settings-section sync-center-settings-panel">
                <div class="sync-center-settings-section-head">
                  <div>
                    <div class="sw-settings-section-title">数据库同步模板</div>
                    <p>连接配置、源库与目标库选择</p>
                  </div>
                  <button
                    class="sw-settings-action-btn primary"
                    type="button"
                    :disabled="syncCenterDbSidebarState.running || syncCenterDbSidebarState.connecting"
                    @click="addDbMigrationProfileFromSyncSettings"
                  >
                    新增
                  </button>
                </div>

                <div v-if="syncCenterDbProfilesView.length === 0" class="sync-center-settings-empty">
                  暂无数据库同步模板。
                </div>

                <div class="sync-center-settings-list">
                  <article
                    v-for="profile in syncCenterDbProfilesView"
                    :key="profile.id"
                    class="sync-center-settings-card"
                  >
                    <button class="sync-center-settings-card-main" type="button" @click="editDbMigrationProfileFromSyncSettings(profile.id)">
                      <span class="sync-center-settings-card-copy">
                        <strong>{{ profile.name }}</strong>
                        <small>{{ profile.summary }}</small>
                      </span>
                      <span :class="['sync-center-settings-status', `is-${profile.statusTone || 'idle'}`]">
                        {{ profile.statusText || '未执行' }}
                      </span>
                    </button>
                    <div class="sync-center-settings-card-actions">
                      <button class="sw-settings-action-btn" type="button" @click="editDbMigrationProfileFromSyncSettings(profile.id)">
                        打开编辑
                      </button>
                      <button
                        class="sw-settings-action-btn danger"
                        type="button"
                        :disabled="syncCenterDbSidebarState.running || syncCenterDbSidebarState.connecting"
                        @click="removeDbMigrationProfileFromSyncSettings(profile.id)"
                      >
                        删除
                      </button>
                    </div>
                  </article>
                </div>
              </section>

              <section class="sw-settings-section sync-center-settings-panel">
                <div class="sync-center-settings-section-head">
                  <div>
                    <div class="sw-settings-section-title">转表并同步模板</div>
                    <p>脚本路径、输出目录与目标目录</p>
                  </div>
                  <button
                    class="sw-settings-action-btn primary"
                    type="button"
                    :disabled="syncWorkspaceRunning"
                    @click="addSyncProfileFromSettings"
                  >
                    新增
                  </button>
                </div>

                <div v-if="syncWorkspaceProfiles.length === 0" class="sync-center-settings-empty">
                  暂无转表并同步模板。
                </div>

                <div class="sync-center-settings-list">
                  <article
                    v-for="profile in syncWorkspaceProfiles"
                    :key="profile.id"
                    class="sync-center-settings-card"
                  >
                    <button class="sync-center-settings-card-main" type="button" @click="toggleSettingsProfileEdit(profile.id)">
                      <span class="sync-center-settings-card-copy">
                        <strong>
                          {{ profile.name }}
                          <span v-if="profile.id === syncWorkspaceDefaultProfileId" class="sw-default-pill">默认</span>
                        </strong>
                        <small>{{ profile.target_path || profile.output_root || '未完成配置' }}</small>
                      </span>
                      <span :class="['sw-settings-profile-chevron', { open: syncSettingsEditingProfileId === profile.id }]">▶</span>
                    </button>

                    <div v-if="syncSettingsEditingProfileId === profile.id" class="sync-center-settings-editor">
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

                      <div class="sync-center-settings-card-actions">
                        <button class="sw-settings-action-btn" type="button" :disabled="syncWorkspaceRunning" @click="editSyncProfileFromSettings(profile.id)">
                          打开编辑
                        </button>
                        <button class="sw-settings-action-btn" type="button" :disabled="syncWorkspaceRunning" @click="setDefaultSyncProfile(profile.id)">
                          {{ profile.id === syncWorkspaceDefaultProfileId ? '已是默认' : '设为默认' }}
                        </button>
                        <button class="sw-settings-action-btn danger" type="button" :disabled="syncWorkspaceRunning" @click="removeSyncProfile(profile.id)">删除</button>
                      </div>
                    </div>
                  </article>
                </div>
              </section>
            </div>
          </div>

          <footer class="sw-settings-footer sync-center-settings-footer">
            <button class="sw-settings-cancel-btn" type="button" @click="closeSyncSettings">取消</button>
            <button class="sw-settings-save-btn" type="button" :disabled="syncWorkspaceRunning" @click="saveSyncWorkspaceSettings(); closeSyncSettings()">保存</button>
          </footer>
        </section>
      </div>
    </Transition>
    <div v-if="syncCenterCtxMenu" class="sync-center-ctx-backdrop" @click="closeSyncCenterCtxMenu" @contextmenu.prevent="closeSyncCenterCtxMenu"></div>
    <div v-if="syncCenterCtxMenu" class="sync-center-ctx-menu" :style="{ left: syncCenterCtxMenu.x + 'px', top: syncCenterCtxMenu.y + 'px' }">
      <button class="sync-center-ctx-item" @click="deleteSyncCenterProfile">删除模板</button>
    </div>
  </main>

  <DbMigrationWorkspace v-else-if="isDbMigrationWorkspaceWindow" />

  <main v-else-if="isArtTextSearchWindow" class="ats-root" @contextmenu.prevent>
    <div class="ats-wallpaper" aria-hidden="true"></div>
    <div class="ats-drag-strip" aria-hidden="true" @pointerdown="artTextSearchHeaderPointerDown"></div>
    <div class="ats-chrome">
      <div class="traffic-lights" @dblclick.stop @pointerdown.stop>
        <button class="traffic-btn traffic-red" title="关闭" aria-label="关闭美术字搜索" @click="closeArtTextSearchWindow" />
        <button class="traffic-btn traffic-yellow" title="最小化" aria-label="最小化美术字搜索" @click="artTextSearchMinimize" />
        <button class="traffic-btn traffic-green" title="最大化/还原" aria-label="最大化或还原美术字搜索" @click="artTextSearchToggleMaximize" />
      </div>
      <span class="ats-title">美术字搜索</span>
    </div>
    <div class="ats-body">
      <div class="glass-card ats-card">
        <h4 class="glass-card-title">OCR 模型</h4>
        <div class="ats-ocr-row">
          <span :class="['ats-ocr-badge', artTextOcrReady ? 'ready' : 'missing']">
            {{ artTextOcrReady ? '已安装' : '未安装' }}
          </span>
          <span class="ats-ocr-path">{{ artTextOcrStatus?.path || '检测后显示安装目录' }}</span>
        </div>
        <div v-if="!artTextOcrReady && artTextOcrMissingText" class="ats-ocr-missing">
          缺少：{{ artTextOcrMissingText }}
        </div>
        <div class="ats-dir-actions">
          <button class="glass-btn-primary ats-btn-sm" :disabled="artTextOcrChecking || artTextOcrInstalling" @click="checkArtTextOcrStatus(true)">
            {{ artTextOcrChecking ? '检测中...' : '检测 OCR' }}
          </button>
          <button class="glass-btn-primary ats-btn-sm" :disabled="artTextOcrInstalling" @click="installArtTextOcrModels">
            {{ artTextOcrInstalling ? '安装中...' : '自动安装' }}
          </button>
          <button class="glass-btn-primary ats-btn-sm" :disabled="artTextOcrInstalling" @click="importArtTextOcrModels">
            选择本地模型目录
          </button>
        </div>
        <div v-if="artTextOcrInstalling && artTextOcrInstallTotal > 0" class="ats-progress-wrap">
          <div class="ats-progress-bar">
            <div class="ats-progress-fill" :style="{ width: artTextOcrInstallPercent + '%' }"></div>
          </div>
          <span class="ats-progress-text">
            {{ artTextOcrInstallPhase === 'download-bytes' ? `下载 ${artTextOcrInstallPercent}%` : '安装进度' }}
            {{ artTextOcrInstallFile }}
          </span>
        </div>
      </div>

      <div class="glass-card ats-card">
        <h4 class="glass-card-title">扫描目录</h4>
        <div class="ats-dirs">
          <span v-for="(dir, i) in artTextDirs" :key="dir" class="ats-dir-chip">
            {{ dir }}
            <button class="ats-dir-remove" @click="removeArtTextDir(i)" title="移除">×</button>
          </span>
          <span v-if="artTextDirs.length === 0" class="ats-dirs-empty">未配置扫描目录</span>
        </div>
        <div class="ats-dir-actions">
          <button class="glass-btn-primary ats-btn-sm" @click="addArtTextDir">+ 添加目录</button>
          <button class="glass-btn-primary ats-btn-sm" :disabled="artTextScanningDirs" @click="scanArtTextSubDirs">
            {{ artTextScanningDirs ? '扫描中...' : '扫描子目录' }}
          </button>
          <button class="glass-btn-primary" :disabled="artTextBuilding || artTextDirs.length === 0 || !artTextOcrReady" @click="buildArtTextIndex">
            {{ artTextBuilding ? '构建中...' : '开始构建索引' }}
          </button>
          <span v-if="artTextIndexBuiltAt" class="ats-built-at">上次更新: {{ artTextIndexBuiltAt }}</span>
        </div>
        <div v-if="artTextBuilding" class="ats-progress-wrap">
          <div class="ats-progress-bar">
            <div class="ats-progress-fill" :style="{ width: artTextProgressPercent + '%' }"></div>
          </div>
          <span class="ats-progress-text">
            <template v-if="artTextProgressPhase === 'collect'">{{ artTextProgressFile || `已扫描 ${artTextProgressCurrent} 个目录` }}</template>
            <template v-else-if="artTextProgressPhase === 'hash'">{{ artTextProgressFile || `扫描 ${artTextProgressCurrent}/${artTextProgressTotal}` }}</template>
            <template v-else>识别 {{ artTextProgressCurrent }}/{{ artTextProgressTotal }} {{ artTextProgressFile }}</template>
          </span>
        </div>
      </div>

      <!-- Subdirectory selection -->
      <div v-if="artTextSubDirs.length > 0" class="glass-card ats-card">
        <h4 class="glass-card-title">
          子目录（{{ artTextSubDirs.length }} 个含图片）
          <label class="ats-select-all">
            <input type="checkbox" :checked="artTextAllSubDirsSelected" @change="toggleAllSubDirs" /> 全选
          </label>
        </h4>
        <div class="ats-subdir-list">
          <label v-for="d in artTextSubDirs" :key="d.path" class="ats-subdir-item">
            <input type="checkbox" v-model="d.selected" />
            <span class="ats-subdir-name">{{ d.name }}</span>
            <span class="ats-subdir-count">{{ d.imageCount }} 张</span>
          </label>
        </div>
        <div class="ats-dir-actions">
          <button class="glass-btn-primary ats-btn-sm" :disabled="artTextSelectedSubDirCount === 0" @click="confirmSubDirSelection">
            确认选择（{{ artTextSelectedSubDirCount }} 个目录）
          </button>
        </div>
      </div>

      <div v-if="artTextMessage" class="ats-message" :class="{ 'ats-message-error': artTextMessage.startsWith('初始化') || artTextMessage.startsWith('请先') }">{{ artTextMessage }}</div>
      <input
        v-model="artTextQuery"
        type="text"
        class="glass-input ats-search-input"
        placeholder="输入搜索文本..."
        @input="onArtTextSearchInput"
      />
      <div v-if="artTextQuery.trim() && !artTextSearching" class="ats-results-header">
        结果 ({{ artTextResults.length }}):
      </div>
      <div v-if="artTextSearching" class="ats-searching">搜索中...</div>
      <div v-else-if="artTextQuery.trim() && artTextResults.length === 0" class="ats-no-results">无结果</div>
      <div v-else-if="artTextResults.length > 0" class="ats-results">
        <div v-for="r in artTextResults" :key="r.path" class="glass-card ats-result-card">
          <div class="ats-result-name">{{ r.fileName }}</div>
          <div class="ats-result-text">识别: "{{ r.text }}"</div>
          <div class="ats-result-path">{{ r.path }}</div>
          <button class="glass-btn-primary ats-btn-sm ats-result-open" @click="openArtTextFile(r.path)">打开</button>
        </div>
      </div>
    </div>
  </main>

  <div v-else-if="isMenuWindow" class="pet-menu-root">
    <section :class="['pet-menu-window', { 'reduced-transparency': reducedTransparencyEnabled }]">
      <button class="pet-menu-btn" @click="contextAction('open')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 0 4.031 11.604l4.433 4.433 1.414-1.414-4.433-4.433A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0-9Z" fill="currentColor"/></svg>
        <span>打开搜索</span>
      </button>
      <button class="pet-menu-btn" @click="contextAction('sync_center')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l1.5 1.7H18A2.5 2.5 0 0 1 20.5 9.2v6.3A2.5 2.5 0 0 1 18 18H6.5A2.5 2.5 0 0 1 4 15.5v-8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M8 12h8M12 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7.2 5.2c.8-1.3 3.2-2.2 5.8-2.2 3.6 0 6.5 1.2 6.5 2.7 0 .7-.6 1.3-1.6 1.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>同步中心</span>
      </button>
      <button class="pet-menu-btn" @click="contextAction('quick_paste')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 4.5h10A2.5 2.5 0 0 1 19.5 7v10A2.5 2.5 0 0 1 17 19.5H7A2.5 2.5 0 0 1 4.5 17V7A2.5 2.5 0 0 1 7 4.5Z" fill="none" stroke="currentColor" stroke-width="1.7"/>
          <path d="M8 8h8M8 12h5M8 16h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M16.5 3.5v3M7.5 3.5v3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
        <span>快捷粘贴</span>
      </button>
      <button class="pet-menu-btn" @click="contextAction('settings')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.036-.31.06-.62.06-.94s-.024-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.12 7.12 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 14.9 2h-3.8a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L3.7 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.046.31-.07.62-.07.94s.024.63.07.94L3.82 14.16a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.8a.5.5 0 0 0 .5-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" fill="currentColor"/></svg>
        <span>设置</span>
      </button>
      <button class="pet-menu-btn" @click="contextAction('art_text_search')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 0 4.031 11.604l4.433 4.433 1.414-1.414-4.433-4.433A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0-9Z" fill="currentColor"/><text x="8" y="15" font-size="8" font-weight="bold" fill="currentColor">字</text></svg>
        <span>美术字搜索</span>
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

  <div
    v-if="tableOpen"
    :class="[
      'dialog-mask',
      'table-dialog-root',
      'table-dialog-root--instant',
      { 'table-dialog-mask': tableDialogSurfaceMode.muteBackdrop },
    ]"
  >
    <section ref="tableModalRef" tabindex="-1" :class="[
      'modal-card', 'wide', 'table-modal', 'table-modal--instant',
      { 'table-modal--host-fill': tableDialogSurfaceMode.fillHostWindow },
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
          <button class="table-title-action-btn" :disabled="exportLoading" @click.stop="exportCurrentTable">
            {{ exportLoading ? '导出中...' : '导出Excel' }}
          </button>
        </div>
        <div class="table-header-actions">
          <button class="small-btn" @click="toggleTableDetailView">{{ tableDetailView === 'full' ? '只看命中(Tab)' : '返回原页(Tab)' }}</button>
          <button class="small-btn" @click="toggleTableFullscreen">{{ tableFullscreen ? '退出全屏(W)' : '全屏查看(W)' }}</button>
          <button :class="['small-btn', 'edit-toggle-btn', { active: editMode }]"
            :disabled="!canEditCurrentTable" @click="onEditToggleClick"
            :title="editMode ? '退出编辑模式' : (offlineDemoMode ? '进入离线演示编辑模式' : '进入编辑模式')">
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
          :data-tab-id="tab.id"
          :class="[
            'table-tab',
            {
              active: tab.id === activeTableTabId,
              dragging: tab.id === tableTabDrag.tabId && tableTabDrag.dragging,
              'drag-over-before': tableTabDrag.overTabId === tab.id && !tableTabDrag.insertAfter,
              'drag-over-after': tableTabDrag.overTabId === tab.id && tableTabDrag.insertAfter,
            },
          ]"
          :title="tab.tableName"
          @click="handleTableTabClick(tab.id)"
          @pointerdown="onTableTabPointerDown($event, tab.id)"
        >
          <span class="table-tab-label">{{ tab.tableName }}</span>
          <span
            class="table-tab-close"
            title="关闭标签"
            @pointerdown.stop
            @click.stop="handleTableTabClose(tab.id)"
          >✕</span>
        </button>
        <button class="table-tab-add" :title="`打开表 (${getPanelShortcut('openTableCommand')})`" @click="openTableCommandPalette({ slash: true })">+</button>
      </section>
      <section v-if="tableFindOpen" class="table-find-bar">
        <input id="tableFindInput" v-model="tableFindKeyword" type="text" placeholder="检索当前表的全部分页文本..." @keydown="onTableFindInputKeydown" />
        <label
          :class="['table-find-exact-toggle', { active: tableFindExact }]"
          title="仅对表数据单元格使用完全相等匹配"
        >
          <input v-model="tableFindExact" class="table-find-exact-input" type="checkbox" />
          <span class="table-find-exact-pill">
            <span class="table-find-exact-dot" aria-hidden="true"></span>
            <span class="table-find-exact-text">精确</span>
          </span>
        </label>
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
            <div class="section-head-actions">
              <button class="section-action-btn" @click="openTableFind">搜索</button>
              <button class="section-toggle-btn" @click="toggleSchemaCollapsed">
                {{ schemaCollapsed ? "展开" : "收起" }}
              </button>
            </div>
          </div>
          <div v-show="!schemaCollapsed" class="section-body">
            <div
              v-if="tableView.tableComment"
              class="table-comment"
              data-schema-key="table_comment"
              :class="{ 'find-active-schema': tableFindFocus.type === 'schema' && tableFindFocus.schemaKey === 'table_comment' }"
              v-html="renderDetailHighlighted(tableView.tableComment)"
            ></div>
            <table class="schema-table schema-table--resizable">
              <colgroup>
                <col :style="getSchemaColumnStyle('column_name')" />
                <col :style="getSchemaColumnStyle('column_type')" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th data-schema-column="column_name" data-schema-resizable="true">
                    <div class="schema-th-content">
                      <span class="th-label">字段名</span>
                    </div>
                    <span class="schema-col-resize-handle" @pointerdown="startSchemaColumnResize($event, 'column_name')"></span>
                  </th>
                  <th data-schema-column="column_type" data-schema-resizable="true">
                    <div class="schema-th-content">
                      <span class="th-label">类型</span>
                    </div>
                    <span class="schema-col-resize-handle" @pointerdown="startSchemaColumnResize($event, 'column_type')"></span>
                  </th>
                  <th>备注</th>
                </tr>
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
            <div class="data-head" :class="{ 'actions-only': !editMode }">
              <div class="data-actions">
                <button class="small-btn" @click="jumpToNextHitRow">一键跳转命中(Q/E)</button>
                <div class="pager">
                  <button :disabled="tableView.page <= 1" @click="prevPage">上一页</button>
                  <span>{{ tableView.page }} / {{ totalPages }}</span>
                  <button :disabled="tableView.page >= totalPages" @click="nextPage">下一页</button>
                </div>
              </div>
              <div v-if="editMode" class="edit-shortcut-hint">
                Ctrl+Z 撤销 · Ctrl+Shift+Z 重做 · Ctrl+Enter 新行 · Ctrl+Delete 删行 · Ctrl+D 向下填充 · Shift+Space 选中整行 · F4 文本面板
              </div>
            </div>

            <div ref="tableGridWrapRef" class="grid-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th v-if="editMode" class="edit-row-handle-col"></th>
                    <th v-if="editMode" class="edit-checkbox-col">
                      <input type="checkbox" title="选择当前页" @click.stop.prevent="toggleSelectAll"
                        :checked="editAllPageRowsSelected" />
                    </th>
                    <th
                      v-for="col in tableView.columns"
                      :key="col.column_name"
                      :data-column-name="col.column_name"
                      :class="{ 'hit-col': isDataColumnHit(col.column_name) }"
                      :style="getColumnStyle(col.column_name)"
                    >
                      <div class="th-content">
                        <span class="th-label" v-html="renderTableColumnHeader(col.column_name)"></span>
                        <button
                          v-if="overflowingColumnMap[col.column_name] || collapsedColumnMap[col.column_name]"
                          class="column-collapse-badge"
                          :class="{ active: collapsedColumnMap[col.column_name] }"
                          :title="collapsedColumnMap[col.column_name] ? '双击恢复列宽' : '双击收窄到字段名宽度'"
                          @click.stop.prevent
                          @dblclick.stop.prevent="handleColumnCollapseToggle(col.column_name)"
                        >◢</button>
                      </div>
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
                      'edit-selected': editMode && isRowSelected(row, idx),
                    }"
                    @contextmenu.prevent="copyRow(row)"
                  >
                    <td v-if="editMode" class="edit-row-handle-col" @mousedown.stop.prevent="onRowHandleMouseDown(idx, 'page')" @mouseenter="onRowHandleMouseEnter(idx, 'page')" title="选中整行">
                      <span class="edit-row-handle">⠿</span>
                    </td>
                    <td v-if="editMode" class="edit-checkbox-col">
                      <input type="checkbox"
                        :checked="editSelectedRows.has(computeRowKey(row, idx))"
                        :disabled="isRowDeleted(row, idx)"
                        @click.stop="toggleRowSelection(idx, $event)" />
                    </td>
                    <td
                      v-for="col in tableView.columns"
                      :key="col.column_name"
                      :data-column-name="col.column_name"
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
                        'edit-cell-active': editingCell.active && editingCell.rowIndex === idx && editingCell.columnName === col.column_name,
                        'grid-focus': editMode && isGridFocused('page', idx, col.column_name),
                        'grid-range': editMode && isCellInGridRange('page', idx, col.column_name),
                      }"
                      @click="onPageCellClick($event, idx, col.column_name)"
                      @dblclick="onPageCellDoubleClick(idx, col.column_name)"
                      @mousedown="onGridCellMouseDown($event, 'page', idx, col.column_name)"
                      @mouseenter="onGridCellMouseEnter($event, 'page', idx, col.column_name)"
                    >
                      <input v-if="editingCell.active && editingCell.rowIndex === idx && editingCell.columnName === col.column_name"
                        id="edit-cell-input"
                        class="edit-cell-input"
                        v-model="editingCell.currentValue"
                        @input="onCellEditInput"
                        @blur="onCellEditBlur($event, confirmCellEdit)"
                        @keydown="onCellEditKeydown"
                        @select="syncCursorToTextPanel"
                        @click="syncCursorToTextPanel"
                        @keyup="syncCursorToTextPanel"
                      />
                      <div v-else class="td-clip" v-html="renderDataCell(row, col.column_name, idx)"></div>
                    </td>
                  </tr>
                  <!-- 新增行 -->
                  <tr v-for="(newRow, nIdx) in editChanges.inserts" :key="'new-'+nIdx" class="edit-new-row">
                    <td class="edit-row-handle-col" @mousedown.stop.prevent="onRowHandleMouseDown(nIdx, 'insert')" @mouseenter="onRowHandleMouseEnter(nIdx, 'insert')" title="选中整行">
                      <span class="edit-row-handle">⠿</span>
                    </td>
                    <td class="edit-checkbox-col">
                      <button class="edit-remove-insert-btn" @click="removeNewRow(nIdx)" title="移除">✕</button>
                    </td>
                    <td v-for="col in tableView.columns" :key="col.column_name"
                      :data-column-name="col.column_name"
                      :style="getColumnStyle(col.column_name)"
                      :class="{
                        'edit-cell-active': editingCell.active && editingCell.rowIndex === (tableView.rows.length + nIdx) && editingCell.columnName === col.column_name,
                        'grid-focus': editMode && isGridFocused('insert', nIdx, col.column_name),
                        'grid-range': editMode && isCellInGridRange('insert', nIdx, col.column_name),
                      }"
                      @click="onInsertCellClick($event, nIdx, col.column_name)"
                      @dblclick="onInsertCellDoubleClick(nIdx, col.column_name)"
                      @mousedown="onGridCellMouseDown($event, 'insert', nIdx, col.column_name)"
                      @mouseenter="onGridCellMouseEnter($event, 'insert', nIdx, col.column_name)"
                    >
                      <input v-if="editingCell.active && editingCell.rowIndex === (tableView.rows.length + nIdx) && editingCell.columnName === col.column_name"
                        id="edit-cell-input"
                        class="edit-cell-input"
                        v-model="editingCell.currentValue"
                        @input="onCellEditInput"
                        @blur="onCellEditBlur($event, () => confirmNewRowCellEdit(nIdx))"
                        @keydown="onNewRowCellEditKeydown($event, nIdx)"
                        @select="syncCursorToTextPanel"
                        @click="syncCursorToTextPanel"
                        @keyup="syncCursorToTextPanel"
                      />
                      <div v-else class="td-clip">{{ newRow[col.column_name] || '' }}</div>
                    </td>
                  </tr>
                  <!-- 快速追加新行的幽灵行（仅在编辑模式出现） -->
                  <tr v-if="editMode" class="edit-ghost-row" @click="addRowAndFocus">
                    <td class="edit-row-handle-col"></td>
                    <td class="edit-checkbox-col">＋</td>
                    <td :colspan="tableView.columns.length" class="edit-ghost-hint">
                      点击这里或按 Ctrl+Enter 追加新行
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- 编辑模式底部：工具栏 + 文本选项面板（作为一个整体 sticky 到底部） -->
            <div v-if="editMode" class="edit-bottom-stack">
              <div class="edit-toolbar">
                <div class="edit-toolbar-left">
                  <button class="small-btn" @click="addRowAndFocus" title="Ctrl+Enter">+ 添加行</button>
                  <button class="small-btn danger" :disabled="editCurrentPageSelectedCount === 0"
                    @click="deleteSelectedRows">删除选中 ({{ editCurrentPageSelectedCount }})</button>
                  <button
                    class="small-btn"
                    :class="{ active: textPanelOpen }"
                    @click="toggleTextPanel"
                    title="F4 切换文本面板"
                  >📝 文本选项</button>
                  <div class="edit-batch-tools">
                    <span class="edit-selection-count">{{ editCurrentPageSelectedCount }} 行</span>
                    <select v-model="editBatchColumn" class="edit-batch-select" :disabled="editCurrentPageSelectedCount === 0">
                      <option value="">选择字段</option>
                      <option v-for="col in tableView.columns" :key="col.column_name" :value="col.column_name">
                        {{ col.column_name }}
                      </option>
                    </select>
                    <input
                      v-model="editBatchValue"
                      class="edit-batch-input"
                      :disabled="editCurrentPageSelectedCount === 0"
                      placeholder="值"
                      @keydown.enter.prevent="applyBatchEditToSelectedRows"
                    />
                    <button class="small-btn" :disabled="!editBatchCanApply" @click="applyBatchEditToSelectedRows">应用</button>
                  </div>
                </div>
                <div class="edit-toolbar-right">
                  <span v-if="editDirty" class="edit-dirty-badge">
                    <span class="edit-dirty-dot"></span> {{ editSaveSummary.total }} 项未保存
                  </span>
                  <button class="primary-btn" :disabled="!editDirty" @click="openSaveDialog">保存更改</button>
                </div>
              </div>
              <!-- 📝 文本选项：底部可拉伸文本编辑面板（位于工具栏下方、贴到最底部） -->
              <div
                v-if="textPanelOpen"
                class="edit-text-panel"
                :style="{ height: textPanelHeight + 'px' }"
              >
                <div class="edit-text-panel__resize" @pointerdown="onTextPanelResizeStart"></div>
                <div class="edit-text-panel__header">
                  <div class="edit-text-panel__title">
                    {{ textPanelFocusTitle() }}
                  </div>
                  <div class="edit-text-panel__actions">
                    <button class="small-btn" @click="copyTextPanelDraft">复制</button>
                    <button class="small-btn" @click="toggleTextPanel" title="关闭 (F4)">✕</button>
                  </div>
                </div>
                <div class="edit-text-panel__body">
                  <div class="edit-text-panel__editor">
                    <pre class="edit-text-panel__highlight" aria-hidden="true"><code v-html="textPanelHighlightedHtml"></code>
</pre>
                    <textarea
                      class="edit-text-panel__textarea"
                      :value="textPanelDraft"
                      :disabled="!hasActiveGridFocus()"
                      spellcheck="false"
                      @input="onTextPanelInput"
                      @select="syncCursorToCellInput"
                      @click="syncCursorToCellInput"
                      @keyup="syncCursorToCellInput"
                      @scroll="onTextPanelScroll"
                      @blur="onTextPanelBlur"
                    ></textarea>
                  </div>
                </div>
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
            <table v-if="hitOnlySchemaColumns.length > 0" class="schema-table schema-table--resizable">
              <colgroup>
                <col :style="getSchemaColumnStyle('column_name')" />
                <col :style="getSchemaColumnStyle('column_type')" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th data-schema-column="column_name" data-schema-resizable="true">
                    <div class="schema-th-content">
                      <span class="th-label">字段名</span>
                    </div>
                    <span class="schema-col-resize-handle" @pointerdown="startSchemaColumnResize($event, 'column_name')"></span>
                  </th>
                  <th data-schema-column="column_type" data-schema-resizable="true">
                    <div class="schema-th-content">
                      <span class="th-label">类型</span>
                    </div>
                    <span class="schema-col-resize-handle" @pointerdown="startSchemaColumnResize($event, 'column_type')"></span>
                  </th>
                  <th>备注</th>
                </tr>
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
                      :data-column-name="columnName"
                      :style="getColumnStyle(columnName)"
                    >
                      <div class="th-content">
                        <span class="th-label" v-html="renderDetailHighlighted(columnName)"></span>
                        <button
                          v-if="overflowingColumnMap[columnName] || collapsedColumnMap[columnName]"
                          class="column-collapse-badge"
                          :class="{ active: collapsedColumnMap[columnName] }"
                          :title="collapsedColumnMap[columnName] ? '双击恢复列宽' : '双击收窄到字段名宽度'"
                          @click.stop.prevent
                          @dblclick.stop.prevent="handleColumnCollapseToggle(columnName)"
                        >◢</button>
                      </div>
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
                      :data-column-name="columnName"
                      :style="getColumnStyle(columnName)"
                      :class="{ 'hit-cell': isDataCellHit(item.row, columnName) }"
                      @dblclick="onHitCellDoubleClick(item, columnName)"
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

  <div v-if="cellViewerOpen" class="dialog-mask cell-viewer-mask" @click.self="closeCellViewer">
    <section class="modal-card wide cell-viewer-modal">
      <header class="modal-header cell-viewer-header">
        <div class="cell-viewer-title-wrap">
          <h3>{{ cellViewerTitle }}</h3>
          <p class="cell-viewer-subtitle">
            {{ tableView.tableName }} · {{ cellViewerPreview.isFormattedJson ? "JSON 已自动美化" : "完整单元格内容" }}
          </p>
        </div>
        <div class="cell-viewer-header-actions">
          <select v-model="cellViewer.manualLanguage" class="cell-viewer-language-select">
            <option v-for="option in CELL_VIEWER_LANGUAGE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <button class="small-btn" @click="copyText(cellViewer.draftText)">复制</button>
          <button
            v-if="cellViewer.mode === 'preview'"
            class="small-btn"
            :disabled="!cellViewerCanEnterEdit"
            :title="cellViewerEditHint || (editMode ? '在查看器中直接编辑当前单元格' : '通过日期校验后进入查看器编辑')"
            @click="startCellViewerEditing"
          >
            {{ editMode ? "编辑" : "进入编辑" }}
          </button>
          <button v-else class="small-btn" @click="cellViewer.mode = 'preview'">返回预览</button>
          <button class="icon-btn" @click="closeCellViewer">✕</button>
        </div>
      </header>
      <div class="cell-viewer-body">
        <div class="cell-viewer-meta">
          <span class="cell-viewer-pill">检测：{{ cellViewerPreview.detectedLanguage }}</span>
          <span class="cell-viewer-pill">显示：{{ cellViewerPreview.activeLanguage }}</span>
          <span v-if="cellViewerEditHint" class="cell-viewer-hint">{{ cellViewerEditHint }}</span>
        </div>
        <div v-if="cellViewer.mode === 'preview'" class="cell-viewer-preview-shell">
          <pre class="cell-viewer-preview"><code class="hljs" v-html="cellViewerPreview.html"></code></pre>
        </div>
        <div v-else class="cell-viewer-editor-shell">
          <textarea
            id="cell-viewer-editor"
            v-model="cellViewer.draftText"
            class="cell-viewer-editor"
            spellcheck="false"
          ></textarea>
        </div>
      </div>
      <footer class="modal-footer cell-viewer-footer">
        <span class="cell-viewer-footer-note">
          {{ cellViewer.mode === "edit"
            ? (cellViewerDirty ? "当前有未写回的修改" : "编辑器内容尚未变化")
            : "支持 JSON / JavaScript / TypeScript / Python 的格式化预览" }}
        </span>
        <div class="cell-viewer-footer-actions">
          <button v-if="cellViewer.mode === 'edit'" class="small-btn" :disabled="!cellViewerDirty" @click="cellViewer.draftText = cellViewer.originalText">重置</button>
          <button v-if="cellViewer.mode === 'edit'" class="primary-btn" :disabled="!cellViewerCanSave" @click="saveCellViewerChanges">写回单元格</button>
        </div>
      </footer>
    </section>
  </div>

  <div v-if="cellViewerDiscardDialogOpen" class="dialog-mask cell-viewer-discard-mask" @click.self="cellViewerDiscardDialogOpen = false">
    <section class="modal-card cell-viewer-discard-dialog">
      <header class="modal-header">
        <h3>放弃查看器修改？</h3>
        <button class="icon-btn" @click="cellViewerDiscardDialogOpen = false">✕</button>
      </header>
      <div class="edit-unsaved-body">
        <p>当前单元格还有未写回的修改，关闭后这些查看器内的内容会丢失。</p>
      </div>
      <footer class="modal-footer">
        <button class="small-btn" @click="cellViewerDiscardDialogOpen = false">继续编辑</button>
        <button class="primary-btn danger" @click="discardCellViewerChanges">放弃修改</button>
      </footer>
    </section>
  </div>

  <div v-if="tableCommandOpen && isPanelWindow" class="table-command-mask" @mousedown.self="closeTableCommandPalette">
    <section id="tableCommandPalette" class="table-command-palette">
      <header class="table-command-header">
        <span>{{ tableCommandHint }}</span>
        <button class="icon-btn" @click="closeTableCommandPalette">✕</button>
      </header>
      <div class="table-command-input-wrap">
        <span class="table-command-prefix">{{ getPanelShortcut("openTableCommand") }}</span>
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
        <div v-for="(tab, i) in SETTINGS_TABS" :key="tab.id" :class="['settings-entry-card', { 'settings-entry-card--version': tab.id === 'version' }]" @click="switchSettingsTab(i)">
          <span :class="['entry-icon', { 'entry-icon--version': tab.id === 'version' }]">{{ tab.icon }}</span>
          <span class="entry-title">{{ tab.label }}</span>
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
                <div class="glass-form-label full">
                  <span>当前数据库</span>
                  <div class="glass-input glass-input-static">{{ settingsDraft.database || '连接后在左下角选择' }}</div>
                </div>
              </div>
            </div>
            <div class="glass-card">
              <h4 class="glass-card-title">数据库模板</h4>
              <div v-if="config.shared.db_templates.length > 0" style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px">
                <div v-for="(tpl, idx) in config.shared.db_templates" :key="idx" class="glass-template-item">
                  <span class="template-name">{{ tpl.name }}</span>
                  <span class="template-info">{{ tpl.db.host }}:{{ tpl.db.port }}{{ tpl.db.database ? `/${tpl.db.database}` : '' }}</span>
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
              <h4 class="glass-card-title">全局打开</h4>
              <div class="glass-form-grid">
                <label class="glass-form-label">搜索面板<input v-model="settingsDraft.hotkey" type="text" class="glass-input" readonly :placeholder="hotkeyPlaceholder" @keydown="onHotkeyInputKeydown" /></label>
                <label class="glass-form-label">同步中心快捷键<input v-model="settingsDraft.syncWindowHotkey" type="text" class="glass-input" readonly placeholder="Shift+D" @keydown="onSyncWindowHotkeyInputKeydown" /></label>
                <label class="glass-form-label">数据库迁移快捷键<input v-model="settingsDraft.dbMigrationWindowHotkey" type="text" class="glass-input" readonly placeholder="Shift+S" @keydown="onDbMigrationWindowHotkeyInputKeydown" /></label>
                <label class="glass-form-label">快捷粘贴打开<input v-model="settingsDraft.quickPasteOpenHotkey" type="text" class="glass-input" readonly placeholder="F7" @keydown="onQuickPasteOpenHotkeyInputKeydown" /></label>
                <label class="glass-form-label">快捷粘贴输出<input v-model="settingsDraft.quickPasteOutputHotkey" type="text" class="glass-input" readonly placeholder="F8" @keydown="onQuickPasteOutputHotkeyInputKeydown" /></label>
                <label class="glass-form-label">日期输入<input v-model="settingsDraft.quickDateHotkey" type="text" class="glass-input" readonly :placeholder="quickDateHotkeyPlaceholder" @keydown="onQuickDateHotkeyInputKeydown" /></label>
              </div>
            </div>
            <div class="glass-card">
              <h4 class="glass-card-title">导出与模板</h4>
              <div class="glass-form-grid">
                <label class="glass-form-label">导出快捷键<input v-model="settingsDraft.exportHotkey" type="text" class="glass-input" readonly placeholder="Ctrl+E" @keydown="onDraftHotkeyInputKeydown($event, 'exportHotkey')" /></label>
                <label class="glass-form-label">批量导出快捷键<input v-model="settingsDraft.batchExportHotkey" type="text" class="glass-input" readonly placeholder="Ctrl+Shift+E" @keydown="onDraftHotkeyInputKeydown($event, 'batchExportHotkey')" /></label>
                <label class="glass-form-label">模板上一快捷键<input v-model="settingsDraft.templatePrevHotkey" type="text" class="glass-input" readonly placeholder="Ctrl+Alt+Left" @keydown="onDraftHotkeyInputKeydown($event, 'templatePrevHotkey')" /></label>
                <label class="glass-form-label">模板下一快捷键<input v-model="settingsDraft.templateNextHotkey" type="text" class="glass-input" readonly placeholder="Ctrl+Alt+Right" @keydown="onDraftHotkeyInputKeydown($event, 'templateNextHotkey')" /></label>
                <label class="glass-form-label">置顶快捷键<input v-model="settingsDraft.alwaysOnTopHotkey" type="text" class="glass-input" readonly placeholder="P" @keydown="onDraftHotkeyInputKeydown($event, 'alwaysOnTopHotkey')" /></label>
              </div>
            </div>
            <div v-for="group in PANEL_SHORTCUT_GROUPS" :key="group.id" class="glass-card">
              <h4 class="glass-card-title">{{ group.label }}</h4>
              <div class="glass-form-grid">
                <label v-for="item in group.items" :key="item.id" class="glass-form-label">
                  {{ item.label }}
                  <input
                    v-model="settingsDraft.panelShortcuts[item.id]"
                    type="text"
                    class="glass-input"
                    readonly
                    :placeholder="item.defaultValue"
                    @keydown="onPanelShortcutInputKeydown($event, item.id)"
                  />
                </label>
              </div>
            </div>
            <div class="glass-card">
              <h4 class="glass-card-title">系统</h4>
              <div class="glass-form-grid">
                <label class="glass-form-label">小窗口默认视图
                  <select v-model="settingsDraft.tableDefaultView" class="glass-select">
                    <option value="hits">Tab 页面（只看命中）</option>
                    <option value="full">正常页面</option>
                  </select>
                </label>
              </div>
            </div>
            <div class="glass-card">
              <h4 class="glass-card-title">启动与显示</h4>
              <div style="display:flex;flex-direction:column;gap:12px">
                <label class="glass-toggle"><input v-model="settingsDraft.autoStart" type="checkbox" /><span class="glass-toggle-track"></span>开机自启</label>
                <label class="glass-toggle"><input v-model="settingsDraft.alwaysOnTop" type="checkbox" /><span class="glass-toggle-track"></span>窗口置顶</label>
                <label class="glass-toggle"><input v-model="settingsDraft.resetOnOpenToAllTables" type="checkbox" /><span class="glass-toggle-track"></span>打开窗口重置为全表</label>
                <label class="glass-toggle"><input v-model="settingsDraft.autoCheckUpdates" type="checkbox" /><span class="glass-toggle-track"></span>启动时自动检查更新</label>
                <label class="glass-form-label">启动欢迎文字
                  <input
                    v-model="settingsDraft.startupWelcomeText"
                    type="text"
                    class="glass-input"
                    maxlength="12"
                    placeholder="Louis"
                  />
                </label>
                <label class="glass-form-label">启动欢迎动画
                  <select v-model="settingsDraft.startupWelcomeMode" class="glass-select">
                    <option value="handwriting">彩色手写</option>
                    <option value="stroke_order">按笔画顺序</option>
                  </select>
                </label>
                <div class="update-settings-actions">
                  <button
                    class="glass-btn-secondary"
                    :disabled="!isTauriWindow || updateChecking || updateInstalling"
                    @click="runAppUpdateCheck({ manual: true })"
                  >
                    {{ updateChecking ? "检查中..." : "立即检查更新" }}
                  </button>
                  <span class="muted">
                    上次检查：{{ formatUpdateTimestamp(config.personal.last_update_check_at) }}
                  </span>
                </div>
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
          <div v-else-if="settingsTab === 3" key="version" class="settings-tab-pane settings-tab-pane--version">
            <div class="glass-card glass-card-version">
              <h4 class="glass-card-title">版本号</h4>
              <div class="version-card-value">{{ VERSION_DISPLAY_LABEL }}</div>
            </div>
          </div>
      </div>

      <!-- Footer -->
      <footer v-if="settingsTab >= 0" class="settings-footer-v2">
        <span v-if="settingsMsg" class="settings-msg" :class="{ ok: settingsMsg.startsWith('✓'), err: settingsMsg.startsWith('✗') }">{{ settingsMsg }}</span>
        <button v-show="settingsTab === 0" class="glass-btn-secondary" @click="triggerImport">导入共享配置</button>
        <button v-show="settingsTab === 0" class="glass-btn-secondary" @click="connectDemoDatabase">使用测试库</button>
        <button v-show="settingsTab === 0" class="glass-btn-secondary" @click="testConnect">测试连接</button>
        <button v-show="settingsTab === 0" class="glass-btn-secondary" :disabled="!dbConnected" @click="disconnectDatabase">断开连接</button>
        <button class="glass-btn-primary" :disabled="settingsSaving" @click="saveSettings">{{ settingsSaving ? '保存中...' : '保存设置' }}</button>
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
  <div v-if="editDateDialogOpen" class="dialog-mask" @click.self="closeEditDateDialog">
    <section :class="['modal-card', 'edit-date-dialog', { shake: editDateError }]">
      <header class="modal-header">
        <h3>进入编辑模式</h3>
        <button class="icon-btn" @click="closeEditDateDialog">✕</button>
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
        <button class="small-btn" @click="closeEditDateDialog">取消</button>
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

  <!-- 批量导入弹窗 -->
  <div v-if="batchImportDialogOpen" class="dialog-mask" @click.self="closeBatchImport">
    <section class="modal-card import-dialog">
      <header class="modal-header">
        <h3>批量导入</h3>
        <button class="icon-btn" :disabled="batchImportLoading && batchImportStep === 'running'" @click="closeBatchImport">✕</button>
      </header>
      <div class="import-dialog-body">
        <div class="import-mode-row">
          <span class="import-mode-pill">覆盖模式</span>
          <span class="muted">导入后目标表会完全变成 Excel 文件中的数据</span>
        </div>
        <div class="import-toolbar">
          <button class="small-btn" :disabled="batchImportLoading" @click="chooseBatchImportFiles">选择 xlsx 文件</button>
          <label v-if="batchImportFiles.length > 0" class="export-select-all">
            <input type="checkbox"
              :checked="batchImportFiles.length > 0 && batchImportFiles.every(item => item.selected)"
              @change="toggleBatchImportSelectAll" />
            全选 ({{ batchImportSummary.selectedCount }}/{{ batchImportFiles.length }})
          </label>
          <span v-if="batchImportFiles.length > 0" class="import-summary">
            {{ batchImportSummary.readyCount }} 通过 · {{ batchImportSummary.errorCount }} 异常 · {{ batchImportSummary.totalRows }} 行
          </span>
        </div>
        <div v-if="batchImportError" class="import-error">{{ batchImportError }}</div>
        <div v-if="batchImportFiles.length === 0" class="import-empty">
          请选择一个或多个 xlsx 文件，文件名需要与目标表名一致。
        </div>
        <div v-else class="import-file-list">
          <label v-for="item in batchImportFiles" :key="item.path" :class="['import-file-item', item.status]">
            <input type="checkbox" :checked="item.selected" :disabled="batchImportLoading" @change="toggleBatchImportFile(item.path)" />
            <div class="import-file-main">
              <div class="import-file-title">
                <span class="import-file-name">{{ item.fileName }}</span>
                <span class="import-arrow">→</span>
                <code>{{ item.tableName || '-' }}</code>
              </div>
              <div class="import-file-meta">
                <span v-if="item.sheetName">工作表：{{ item.sheetName }}</span>
                <span v-if="item.status === 'ready'">将导入 {{ item.rowCount }} 行，覆盖现有 {{ item.existingRows ?? 0 }} 行</span>
                <span v-else-if="item.status === 'pending'">等待检测</span>
                <span v-else>检测未通过</span>
              </div>
              <ul v-if="item.errors && item.errors.length" class="import-file-errors">
                <li v-for="error in item.errors" :key="error">{{ error }}</li>
              </ul>
            </div>
            <span :class="['import-status-badge', item.status]">
              {{ item.status === 'ready' ? '通过' : item.status === 'error' ? '异常' : '待检测' }}
            </span>
          </label>
        </div>
        <div v-if="batchImportStep === 'running'" class="import-progress">
          <div class="progress-info"><span>{{ batchImportProgress.text }}</span></div>
          <div class="bar"><div class="bar-inner" :style="{ width: `${batchImportProgress.percent}%` }"></div></div>
        </div>
        <div v-if="batchImportStep === 'result' && batchImportResult" class="import-result">
          <h4>导入结果</h4>
          <div v-for="item in batchImportResult.files" :key="item.path" class="import-result-row">
            <code>{{ item.tableName }}</code>
            <span>{{ item.previousRows }} 行 → {{ item.importedRows }} 行</span>
          </div>
        </div>
      </div>
      <footer class="modal-footer">
        <button class="small-btn" :disabled="batchImportLoading && batchImportStep === 'running'" @click="closeBatchImport">
          {{ batchImportStep === 'result' ? '关闭' : '取消' }}
        </button>
        <button class="small-btn" :disabled="!batchImportSummary.canPreview || batchImportLoading" @click="previewBatchImportFiles">
          {{ batchImportLoading && batchImportStep === 'preview' ? '检测中...' : '检测能否导入' }}
        </button>
        <button class="primary-btn" :disabled="!batchImportSummary.canImport || batchImportLoading" @click="runBatchImport">
          {{ batchImportLoading && batchImportStep === 'running' ? '导入中...' : `导入 ${batchImportSummary.selectedCount} 张表` }}
        </button>
      </footer>
    </section>
  </div>

  <div v-if="updateDialogOpen" class="dialog-mask" @click.self="closeUpdateDialog">
    <section class="modal-card update-dialog">
      <header class="modal-header">
        <h3>发现新版本</h3>
        <button class="icon-btn" :disabled="updateInstalling" @click="closeUpdateDialog">✕</button>
      </header>
      <div class="update-dialog-body">
        <div class="update-version-row">
          <span>当前版本</span>
          <strong>v{{ updateCurrentVersion }}</strong>
        </div>
        <div class="update-version-row">
          <span>最新版本</span>
          <strong>v{{ updateLatestVersion }}</strong>
        </div>
        <div v-if="updateReleaseDate" class="update-version-row">
          <span>发布时间</span>
          <strong>{{ formatUpdateTimestamp(updateReleaseDate) }}</strong>
        </div>
        <div class="update-notes-card">
          <div class="update-notes-title">更新说明</div>
          <p>{{ updateNotesSummary }}</p>
        </div>
        <div v-if="updateProgress.status !== 'idle' || updateInstalling" class="update-progress-card">
          <div class="update-progress-header">
            <span>{{ updateInstalling ? "正在下载安装更新..." : "更新准备中" }}</span>
            <strong>{{ updateProgress.percent }}%</strong>
          </div>
          <div class="update-progress-bar">
            <span :style="{ width: `${updateProgress.percent}%` }"></span>
          </div>
          <div class="muted">
            {{ formatByteCount(updateProgress.downloadedBytes) }} / {{ formatByteCount(updateProgress.totalBytes) }}
          </div>
        </div>
        <div v-if="updateError" class="update-error">
          更新失败：{{ updateError }}
          <div class="update-error-hint">可前往 Gitee 手动下载最新版本安装包</div>
        </div>
      </div>
      <footer class="modal-footer update-dialog-footer">
        <button class="small-btn" :disabled="updateInstalling" @click="closeUpdateDialog">稍后</button>
        <button v-if="updateError" class="small-btn" @click="openGiteeReleasePage">手动下载</button>
        <button class="primary-btn" :disabled="updateInstalling" @click="installAvailableUpdate">
          {{ updateInstalling ? "下载安装中..." : "立即更新" }}
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
