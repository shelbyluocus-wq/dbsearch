<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { buildHotkeyFromEvent } from "./syncWorkspace.js";
import {
  applyImportedDbMigrationProfileDraft,
  appendDbMigrationTimeline,
  buildDbMigrationHeadline,
  createDbMigrationProfileDraft,
  DB_MIGRATION_PIPELINE_STEPS,
  DEFAULT_DB_MIGRATION_WINDOW_HOTKEY,
  describeDbMigrationProfile,
  extractDbMigrationJsonConfig,
  filterMigrationDatabaseNames,
  isDbMigrationProfileConnectionReady,
  isDbMigrationSelectionReady,
  isSameDbMigrationConnection,
  normalizeDbMigrationProfile,
  normalizeDbMigrationWindowHotkey,
  normalizeDbMigrationWorkspaceState,
  resolveDbMigrationProfileSelection,
  resolveDbMigrationSelections,
  shouldAutoExpandDbMigrationLog,
} from "./dbMigrationWorkspace.js";

const props = defineProps({
  embedded: {
    type: Boolean,
    default: false,
  },
  hideSidebar: {
    type: Boolean,
    default: false,
  },
  fileSyncSummary: {
    type: Object,
    default: () => ({
      name: "同步配置 1",
      status: "未执行",
      tone: "idle",
    }),
  },
});
const emit = defineEmits([
  "log-state",
  "sidebar-state",
  "switch-mode",
  "add-file-sync",
  "close-window",
  "minimize-window",
  "toggle-maximize",
]);

const isEmbedded = computed(() => props.embedded);
const hideSidebar = computed(() => props.hideSidebar);
const phase = ref("login");
const connecting = ref(false);
const running = ref(false);
const loginMessage = ref("");
const loginMessageTone = ref("neutral");
const executionMessage = ref("");
const executionMessageTone = ref("neutral");
const availableDatabases = ref([]);
const sourceDatabase = ref("");
const targetDatabase = ref("");
const timeline = ref([]);
const backupDir = ref("");
const latestSummary = ref("");
const logExpanded = ref(shouldAutoExpandDbMigrationLog());
const workspaceProfiles = ref([]);
const activeProfileId = ref("");
const currentConnection = ref(null);
const settingsOpen = ref(false);
const settingsSaving = ref(false);
const settingsMessage = ref("");
const settingsMessageTone = ref("neutral");
const settingsProfilesDraft = ref([]);
const settingsEditingProfileId = ref("");
const workspaceHotkey = ref(DEFAULT_DB_MIGRATION_WINDOW_HOTKEY);
const hotkeyDraft = ref(DEFAULT_DB_MIGRATION_WINDOW_HOTKEY);
const importInput = ref(null);
const pendingImportProfileId = ref("");
const profileStatusById = ref({});
const dbStep = ref("connection");

let selectionSyncDepth = 0;
let unlistenProgress = null;

function toSidebarStatusTone(tone) {
  if (tone === "ready" || tone === "success") return "success";
  if (tone === "neutral") return "idle";
  return tone;
}

function rememberProfileStatus(profileId, tone) {
  if (!profileId) return;
  const nextTone = toSidebarStatusTone(tone);
  if (profileStatusById.value[profileId] === nextTone) return;
  profileStatusById.value = {
    ...profileStatusById.value,
    [profileId]: nextTone,
  };
}

const activeProfile = computed(() =>
  workspaceProfiles.value.find((profile) => profile.id === activeProfileId.value) || null,
);

const activeProfileConnectionReady = computed(() =>
  isDbMigrationProfileConnectionReady(activeProfile.value),
);

const hasEnoughDatabases = computed(() => availableDatabases.value.length >= 2);

const canRunMigration = computed(() =>
  !running.value
  && !connecting.value
  && activeProfileConnectionReady.value
  && phase.value !== "login"
  && isDbMigrationSelectionReady({
    sourceDatabase: sourceDatabase.value,
    targetDatabase: targetDatabase.value,
  }),
);

const profilesView = computed(() =>
  workspaceProfiles.value.map((profile, index) => ({
    ...profile,
    summary: describeDbMigrationProfile(profile, index),
    statusTone:
      profile.id === activeProfileId.value
        ? toSidebarStatusTone(currentStatusTone.value)
        : isDbMigrationProfileConnectionReady(profile)
          ? profileStatusById.value[profile.id] || "idle"
          : "error",
  })),
);
const embeddedFileSyncSummary = computed(() => ({
  name: props.fileSyncSummary?.name || "同步配置 1",
  status: props.fileSyncSummary?.status || "未执行",
  tone: props.fileSyncSummary?.tone || "idle",
}));

const currentStatusTone = computed(() => {
  if (connecting.value || running.value) return "running";
  if (!activeProfile.value) return "idle";
  if (!activeProfileConnectionReady.value) return "error";
  if (executionMessageTone.value === "error") return "error";
  if (executionMessageTone.value === "success") return "success";
  if (phase.value !== "login") return "ready";
  if (loginMessageTone.value === "error") return "error";
  return "idle";
});

const currentStatusText = computed(() => {
  if (connecting.value) return "连接中";
  if (running.value) return "迁移进行中";
  if (!activeProfile.value) return "暂无模板";
  if (!activeProfileConnectionReady.value) return "待补全配置";
  if (executionMessageTone.value === "error") return "最近一次失败";
  if (executionMessageTone.value === "success") return "最近一次完成";
  if (phase.value !== "login") return "已连接";
  if (loginMessageTone.value === "error") return "连接失败";
  return "待连接";
});

const activeProfileSummary = computed(() => {
  if (!activeProfile.value) return "模板会保存连接信息、源库和目标库选择。";
  return describeDbMigrationProfile(activeProfile.value);
});

const workspaceHeadline = computed(() =>
  buildDbMigrationHeadline({
    sourceDatabase: sourceDatabase.value,
    targetDatabase: targetDatabase.value,
  }),
);

const passiveLoginBannerMessage = computed(() => {
  if (!loginMessage.value) return "";
  if (!activeProfile.value) return loginMessage.value;
  if (loginMessageTone.value === "running" || loginMessageTone.value === "error") {
    return loginMessage.value;
  }
  return "";
});

const bannerMessage = computed(() => executionMessage.value || passiveLoginBannerMessage.value);
const bannerTone = computed(() =>
  executionMessage.value
    ? executionMessageTone.value
    : passiveLoginBannerMessage.value
      ? loginMessageTone.value
      : "neutral",
);

const headerHelperText = computed(() => {
  if (!activeProfile.value) return "左侧保存多套迁移模板，点击后会自动连接或重连。";
  if (!activeProfileConnectionReady.value) return "补全模板后即可在中间执行区选择源库和目标库。";
  if (phase.value === "login") return "连接成功后即可开始完整覆盖。";
  return "源库和目标库的选择会自动记回当前模板。";
});

const executionSectionSubtitle = computed(() => {
  if (!activeProfile.value) return "源库和目标库在这里选择，选择结果会自动回写到当前模板。";
  if (!activeProfileConnectionReady.value) {
    return "先在编辑模板里补全连接信息，连接成功后这里就会成为主要操作区。";
  }
  return "源库和目标库在这里选择，选择结果会自动回写到当前模板。";
});

const selectedDatabaseCards = computed(() => [
  { label: "当前源库", value: sourceDatabase.value || "未选择" },
  { label: "当前目标库", value: targetDatabase.value || "未选择" },
]);

const pipelineView = computed(() => {
  const latestByStep = new Map();
  for (const entry of timeline.value) {
    latestByStep.set(entry.step, entry);
  }

  let encounteredActive = false;
  return DB_MIGRATION_PIPELINE_STEPS.map((step, index) => {
    const entry = latestByStep.get(step.key);
    let status = "pending";
    if (entry) {
      status = entry.status || "running";
      if (status !== "success") {
        encounteredActive = true;
      }
    } else if (!encounteredActive && index === 0 && running.value) {
      status = "running";
      encounteredActive = true;
    }

    return {
      key: step.key,
      label: step.label,
      status,
      icon: status === "success" ? "✓" : status === "error" ? "!" : status === "running" ? "…" : "·",
      message: entry?.message || "",
      timeLabel: entry?.timestamp
        ? new Date(entry.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
        : "",
    };
  });
});

const timelineView = computed(() =>
  timeline.value.map((entry, index) => ({
    key: `${entry.step}-${entry.timestamp}-${index}`,
    stepLabel: DB_MIGRATION_PIPELINE_STEPS.find((item) => item.key === entry.step)?.label || entry.step,
    timeLabel: entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      : "",
    statusText:
      entry.status === "success"
        ? "完成"
        : entry.status === "error"
          ? "失败"
          : entry.status === "running"
            ? "进行中"
            : "等待中",
    statusTone: entry.status || "idle",
    message: entry.message || "",
    command: entry.command || "",
    detail: entry.detail || "",
  })),
);

const logSummaryText = computed(() =>
  timelineView.value.length > 0 ? `详细日志 (${timelineView.value.length})` : "详细日志",
);

watch([timelineView, running, connecting], () => {
  emit("log-state", {
    entries: timelineView.value.map((entry) => ({ ...entry })),
    running: Boolean(running.value || connecting.value),
    steps: pipelineView.value.map((step) => ({ ...step })),
  });
}, { immediate: true, deep: true });

watch([profilesView, activeProfileId, currentStatusText, currentStatusTone, running, connecting], () => {
  emit("sidebar-state", {
    profiles: profilesView.value.map((profile) => ({ ...profile })),
    activeProfileId: activeProfileId.value,
    statusText: currentStatusText.value,
    statusTone: currentStatusTone.value,
    running: Boolean(running.value),
    connecting: Boolean(connecting.value),
  });
}, { immediate: true, deep: true });

watch(activeProfileId, () => {
  if (!activeProfile.value || !activeProfileConnectionReady.value) {
    dbStep.value = "connection";
  }
});

watch(activeProfileConnectionReady, (ready) => {
  if (ready && dbStep.value === "connection") {
    dbStep.value = "selection";
  } else if (!ready) {
    dbStep.value = "connection";
  }
});

watch([sourceDatabase, targetDatabase], () => {
  if (selectionSyncDepth > 0 || !activeProfile.value) return;

  if (!running.value && phase.value === "finished") {
    phase.value = "ready";
    executionMessage.value = "";
    executionMessageTone.value = "neutral";
    timeline.value = [];
    backupDir.value = "";
    latestSummary.value = "";
    logExpanded.value = shouldAutoExpandDbMigrationLog();
  }

  updateProfileFields(activeProfile.value.id, {
    sourceDatabase: sourceDatabase.value,
    targetDatabase: targetDatabase.value,
  });
  persistWorkspaceState().catch(handleWorkspacePersistenceError);
});

function setWorkspaceProfiles(profiles = []) {
  const normalizedProfiles = (Array.isArray(profiles) ? profiles : [])
    .map((profile, index) => normalizeDbMigrationProfile(profile, index));
  const validIds = new Set(normalizedProfiles.map((profile) => profile.id).filter(Boolean));
  workspaceProfiles.value = normalizedProfiles;
  profileStatusById.value = Object.fromEntries(
    Object.entries(profileStatusById.value).filter(([profileId]) => validIds.has(profileId)),
  );
}

function updateProfileFields(profileId, fields = {}) {
  setWorkspaceProfiles(
    workspaceProfiles.value.map((profile) =>
      profile.id === profileId ? { ...profile, ...fields } : profile),
  );
}

function withSelectionSyncPaused(callback) {
  selectionSyncDepth += 1;
  try {
    callback();
  } finally {
    selectionSyncDepth = Math.max(0, selectionSyncDepth - 1);
  }
}

function setSelectedDatabases(selection = {}) {
  withSelectionSyncPaused(() => {
    sourceDatabase.value = String(selection.sourceDatabase || "");
    targetDatabase.value = String(selection.targetDatabase || "");
  });
}

function clearExecutionArtifacts() {
  executionMessage.value = "";
  executionMessageTone.value = "neutral";
  timeline.value = [];
  backupDir.value = "";
  latestSummary.value = "";
  logExpanded.value = shouldAutoExpandDbMigrationLog();
}

function applyEmptyWorkspaceState() {
  activeProfileId.value = "";
  currentConnection.value = null;
  phase.value = "login";
  connecting.value = false;
  running.value = false;
  availableDatabases.value = [];
  setSelectedDatabases({
    sourceDatabase: "",
    targetDatabase: "",
  });
  clearExecutionArtifacts();
  if (workspaceProfiles.value.length === 0) {
    profileStatusById.value = {};
  }
  loginMessage.value = "请先创建一个迁移模板。";
  loginMessageTone.value = "neutral";
}

function applyIncompleteProfileState(
  profile,
  {
    message = "模板未完成配置，请先在设置里补全连接信息。",
    tone = "neutral",
    clearExecution = true,
  } = {},
) {
  currentConnection.value = null;
  phase.value = "login";
  connecting.value = false;
  availableDatabases.value = [];
  if (profile?.id) {
    rememberProfileStatus(profile.id, "error");
  }
  if (clearExecution) {
    clearExecutionArtifacts();
  }
  setSelectedDatabases({
    sourceDatabase: profile?.sourceDatabase || "",
    targetDatabase: profile?.targetDatabase || "",
  });
  loginMessage.value = message;
  loginMessageTone.value = tone;
}

function buildWorkspaceSnapshot({
  profiles = workspaceProfiles.value,
  lastUsedProfileId = activeProfileId.value,
} = {}) {
  const normalizedProfiles = (Array.isArray(profiles) ? profiles : [])
    .map((profile, index) => normalizeDbMigrationProfile(profile, index));
  const resolvedLastUsedProfileId = resolveDbMigrationProfileSelection(normalizedProfiles, {
    lastUsedProfileId,
  });

  return {
    profiles: normalizedProfiles,
    lastUsedProfileId: resolvedLastUsedProfileId,
  };
}

async function persistWorkspaceState(options = {}) {
  const snapshot = buildWorkspaceSnapshot(options);
  if (options.applyToState !== false) {
    setWorkspaceProfiles(snapshot.profiles);
    activeProfileId.value = snapshot.lastUsedProfileId;
  }
  await invoke("save_db_migration_workspace_state", {
    workspaceState: {
      profiles: snapshot.profiles,
      lastUsedProfileId: snapshot.lastUsedProfileId,
    },
  });
  return snapshot;
}

function handleWorkspacePersistenceError(error) {
  loginMessage.value = `保存模板状态失败：${String(error)}`;
  loginMessageTone.value = "error";
}

function applyProfileSelections(profile, databases = availableDatabases.value) {
  const resolvedSelection = resolveDbMigrationSelections(databases, {
    sourceDatabase: profile?.sourceDatabase,
    targetDatabase: profile?.targetDatabase,
  });
  setSelectedDatabases(resolvedSelection);
  if (profile?.id) {
    updateProfileFields(profile.id, resolvedSelection);
  }
  return resolvedSelection;
}

async function connectProfile(profile, { restoring = false } = {}) {
  if (!profile || !isDbMigrationProfileConnectionReady(profile) || running.value) {
    return false;
  }

  rememberProfileStatus(profile.id, "running");
  connecting.value = true;
  phase.value = "login";
  clearExecutionArtifacts();
  loginMessage.value = restoring
    ? `正在恢复 ${profile.name} 的连接...`
    : `正在连接 ${profile.name}...`;
  loginMessageTone.value = "running";

  try {
    const result = await invoke("connect_db_migration_server", {
      params: {
        host: profile.host.trim(),
        port: Number(profile.port) || 3306,
        username: profile.username.trim(),
        password: profile.password,
      },
    });
    const databases = filterMigrationDatabaseNames(result.databases || []);
    availableDatabases.value = databases;
    currentConnection.value = normalizeDbMigrationProfile(profile);
    phase.value = "ready";
    applyProfileSelections(profile, databases);
    rememberProfileStatus(profile.id, databases.length >= 2 ? "success" : "error");
    loginMessage.value = databases.length >= 2
      ? `已连接 ${result.host}:${result.port}`
      : `已连接 ${result.host}:${result.port}，但可见业务库少于 2 个`;
    loginMessageTone.value = databases.length >= 2 ? "success" : "error";
    await persistWorkspaceState().catch(handleWorkspacePersistenceError);
    return true;
  } catch (error) {
    currentConnection.value = null;
    availableDatabases.value = [];
    phase.value = "login";
    rememberProfileStatus(profile.id, "error");
    setSelectedDatabases({
      sourceDatabase: profile.sourceDatabase || "",
      targetDatabase: profile.targetDatabase || "",
    });
    loginMessage.value = restoring
      ? `恢复连接失败：${String(error)}`
      : `连接失败：${String(error)}`;
    loginMessageTone.value = "error";
    return false;
  } finally {
    connecting.value = false;
  }
}

async function activateProfile(profileId, { restoring = false, persist = true } = {}) {
  if ((running.value || connecting.value) && !restoring) return false;

  const profile = workspaceProfiles.value.find((item) => item.id === profileId) || null;
  if (!profile) {
    if (workspaceProfiles.value.length === 0) {
      applyEmptyWorkspaceState();
    }
    return false;
  }

  const previousProfileId = activeProfileId.value;
  activeProfileId.value = profile.id;
  if (persist) {
    await persistWorkspaceState().catch(handleWorkspacePersistenceError);
  }

  if (!isDbMigrationProfileConnectionReady(profile)) {
    applyIncompleteProfileState(profile, {
      clearExecution: profile.id !== previousProfileId,
    });
    return true;
  }

  const canReuseCurrentConnection = phase.value !== "login"
    && currentConnection.value
    && isSameDbMigrationConnection(currentConnection.value, profile);

  if (canReuseCurrentConnection) {
    if (profile.id !== previousProfileId) {
      clearExecutionArtifacts();
    }
    phase.value = "ready";
    currentConnection.value = normalizeDbMigrationProfile(profile);
    applyProfileSelections(profile, availableDatabases.value);
    rememberProfileStatus(profile.id, availableDatabases.value.length >= 2 ? "success" : "error");
    loginMessage.value = availableDatabases.value.length >= 2
      ? `已复用 ${profile.host}:${profile.port} 的连接`
      : `已复用 ${profile.host}:${profile.port} 的连接，但可见业务库少于 2 个`;
    loginMessageTone.value = availableDatabases.value.length >= 2 ? "success" : "error";
    await persistWorkspaceState().catch(handleWorkspacePersistenceError);
    return true;
  }

  return connectProfile(profile, { restoring });
}

async function restoreWorkspaceState() {
  try {
    const state = normalizeDbMigrationWorkspaceState(
      await invoke("get_db_migration_workspace_state"),
    );
    workspaceHotkey.value = normalizeDbMigrationWindowHotkey(state.hotkey);
    hotkeyDraft.value = workspaceHotkey.value;
    setWorkspaceProfiles(state.profiles);
    activeProfileId.value = state.lastUsedProfileId;

    if (!workspaceProfiles.value.length) {
      applyEmptyWorkspaceState();
      return;
    }

    const restoredProfileId = state.lastUsedProfileId || workspaceProfiles.value[0]?.id || "";
    if (!restoredProfileId) {
      applyEmptyWorkspaceState();
      return;
    }
    await activateProfile(restoredProfileId, {
      restoring: true,
      persist: false,
    });
  } catch {
    workspaceHotkey.value = DEFAULT_DB_MIGRATION_WINDOW_HOTKEY;
    hotkeyDraft.value = DEFAULT_DB_MIGRATION_WINDOW_HOTKEY;
    applyEmptyWorkspaceState();
  }
}

async function confirmAndRunMigration() {
  if (!canRunMigration.value || !activeProfile.value) return;
  phase.value = "confirming";

  const confirmed = await ask(
    `将完整覆盖目标库。\n\n源库：${sourceDatabase.value}\n目标库：${targetDatabase.value}\n\n执行前会先备份两个数据库到桌面，然后删除目标库普通表，再从源库重建并复制数据。`,
    {
      title: "确认完整覆盖",
      kind: "warning",
      okLabel: "开始完整覆盖",
      cancelLabel: "取消",
    },
  );

  if (!confirmed) {
    phase.value = "ready";
    return;
  }

  await runMigration();
}

async function runMigration() {
  if (!activeProfile.value) return;

  running.value = true;
  phase.value = "running";
  clearExecutionArtifacts();
  executionMessage.value = `正在备份并覆盖 ${workspaceHeadline.value}`;
  executionMessageTone.value = "running";

  try {
    const result = await invoke("run_db_migration", {
      request: {
        host: activeProfile.value.host.trim(),
        port: Number(activeProfile.value.port) || 3306,
        username: activeProfile.value.username.trim(),
        password: activeProfile.value.password,
        sourceDatabase: sourceDatabase.value,
        targetDatabase: targetDatabase.value,
      },
    });
    latestSummary.value = result.summary || "";
    backupDir.value = result.backupDir || "";
    executionMessage.value = result.summary || "迁移完成";
    executionMessageTone.value = "success";
    phase.value = "finished";
    await persistWorkspaceState().catch(handleWorkspacePersistenceError);
  } catch (error) {
    executionMessage.value = String(error);
    executionMessageTone.value = "error";
    phase.value = "finished";
  } finally {
    running.value = false;
  }
}

async function openBackupDirectory() {
  if (!backupDir.value) return;
  try {
    await invoke("open_directory_in_explorer", { path: backupDir.value });
  } catch (error) {
    executionMessage.value = `打开备份目录失败：${String(error)}`;
    executionMessageTone.value = "error";
  }
}

function syncSettingsDraftFromWorkspace({ editingProfileId = "" } = {}) {
  settingsProfilesDraft.value = workspaceProfiles.value
    .map((profile, index) => normalizeDbMigrationProfile(profile, index));
  settingsEditingProfileId.value = editingProfileId
    || settingsProfilesDraft.value[0]?.id
    || "";
}

function openSettings({ editingProfileId = "", preserveDraft = false } = {}) {
  hotkeyDraft.value = workspaceHotkey.value;
  settingsMessage.value = "";
  settingsMessageTone.value = "neutral";
  if (!preserveDraft) {
    syncSettingsDraftFromWorkspace({ editingProfileId });
  } else if (editingProfileId) {
    settingsEditingProfileId.value = editingProfileId;
  }
  settingsOpen.value = true;
}

function closeSettings() {
  settingsOpen.value = false;
  settingsProfilesDraft.value = [];
  settingsEditingProfileId.value = "";
  hotkeyDraft.value = workspaceHotkey.value;
}

function addDraftProfile() {
  const profile = createDbMigrationProfileDraft(settingsProfilesDraft.value);
  settingsProfilesDraft.value = [
    ...settingsProfilesDraft.value,
    profile,
  ];
  settingsEditingProfileId.value = profile.id;
  return profile;
}

async function addProfile(seed = {}) {
  if (running.value || connecting.value) return;
  const profile = createDbMigrationProfileDraft(workspaceProfiles.value, seed);
  setWorkspaceProfiles([...workspaceProfiles.value, profile]);
  activeProfileId.value = profile.id;
  dbStep.value = "connection";
  applyIncompleteProfileState(profile, {
    message: "已新增模板，请补全连接信息。",
    tone: "neutral",
  });
  await persistWorkspaceState().catch(handleWorkspacePersistenceError);
}

async function removeProfile(profileId) {
  if (running.value || connecting.value) return;
  const remaining = workspaceProfiles.value.filter((p) => p.id !== profileId);
  if (remaining.length === workspaceProfiles.value.length) return;
  setWorkspaceProfiles(remaining);
  if (activeProfileId.value === profileId) {
    const nextProfile = remaining[0] || null;
    if (nextProfile) {
      activeProfileId.value = nextProfile.id;
      if (!isDbMigrationProfileConnectionReady(nextProfile)) {
        applyIncompleteProfileState(nextProfile);
      }
    } else {
      applyEmptyWorkspaceState();
    }
  }
  if (settingsOpen.value) {
    syncSettingsDraftFromWorkspace({
      editingProfileId: activeProfileId.value || remaining[0]?.id || "",
    });
  }
  await persistWorkspaceState().catch(handleWorkspacePersistenceError);
}

async function nextStepFromConnection() {
  if (!activeProfile.value || connecting.value || running.value) return;
  if (!isDbMigrationProfileConnectionReady(activeProfile.value)) return;
  const connected = await connectProfile(activeProfile.value);
  if (connected) {
    dbStep.value = "selection";
  }
}

defineExpose({
  addProfile,
  addProfileWithSeed: (seed) => addProfile(seed),
  activateProfile,
  removeProfile,
  openSettings,
});

function toggleSettingsProfileEdit(profileId) {
  settingsEditingProfileId.value = settingsEditingProfileId.value === profileId ? "" : profileId;
}

function removeDraftProfile(profileId) {
  settingsProfilesDraft.value = settingsProfilesDraft.value.filter((profile) => profile.id !== profileId);
  if (settingsEditingProfileId.value === profileId) {
    settingsEditingProfileId.value = settingsProfilesDraft.value[0]?.id || "";
  }
}

function buildSettingsDraftSnapshot(lastUsedProfileId = activeProfileId.value) {
  const fallbackProfileId = settingsProfilesDraft.value.some((profile) => profile.id === lastUsedProfileId)
    ? lastUsedProfileId
    : settingsEditingProfileId.value || settingsProfilesDraft.value[0]?.id || "";
  return buildWorkspaceSnapshot({
    profiles: settingsProfilesDraft.value,
    lastUsedProfileId: fallbackProfileId,
  });
}

function applyWorkspaceSnapshot(snapshot) {
  setWorkspaceProfiles(snapshot.profiles);
  activeProfileId.value = snapshot.lastUsedProfileId;
  return workspaceProfiles.value.find((profile) => profile.id === activeProfileId.value) || null;
}

function replaceDraftProfile(profileId, updater) {
  settingsProfilesDraft.value = settingsProfilesDraft.value.map((profile, index) => {
    if (profile.id !== profileId) {
      return normalizeDbMigrationProfile(profile, index);
    }
    const nextProfile = typeof updater === "function"
      ? updater(profile, index)
      : { ...profile, ...updater };
    return normalizeDbMigrationProfile(nextProfile, index);
  });
}

async function saveSettings() {
  if (settingsSaving.value) return;
  settingsSaving.value = true;
  settingsMessage.value = "";
  settingsMessageTone.value = "neutral";

  try {
    const normalizedHotkey = await invoke("register_db_migration_window_hotkey", {
      hotkey: hotkeyDraft.value,
    });
    workspaceHotkey.value = normalizeDbMigrationWindowHotkey(normalizedHotkey);
    hotkeyDraft.value = workspaceHotkey.value;
    settingsMessage.value = "设置已保存。";
    settingsMessageTone.value = "success";
    closeSettings();
  } catch (error) {
    settingsMessage.value = String(error);
    settingsMessageTone.value = "error";
  } finally {
    settingsSaving.value = false;
  }
}

function openSettingsForActiveProfile() {
  openSettings({ editingProfileId: activeProfileId.value });
}

async function connectDraftProfile(profileId) {
  if (!profileId || running.value || connecting.value) return;
  settingsMessage.value = "";
  settingsMessageTone.value = "neutral";

  try {
    const nextSnapshot = buildSettingsDraftSnapshot(profileId);
    const nextActiveProfile = applyWorkspaceSnapshot(nextSnapshot);
    await persistWorkspaceState({
      profiles: nextSnapshot.profiles,
      lastUsedProfileId: nextSnapshot.lastUsedProfileId,
      applyToState: false,
    });

    if (!nextActiveProfile || !isDbMigrationProfileConnectionReady(nextActiveProfile)) {
      applyIncompleteProfileState(nextActiveProfile, {
        message: "模板未完成配置，请先在编辑模板里补全连接信息。",
        tone: "neutral",
        clearExecution: false,
      });
      settingsMessage.value = "模板未完成配置，请先补全连接信息。";
      settingsMessageTone.value = "error";
      return;
    }

    const connected = await activateProfile(nextActiveProfile.id, { persist: false });
    if (!connected) {
      settingsMessage.value = loginMessage.value || "连接失败。";
      settingsMessageTone.value = "error";
      return;
    }

    closeSettings();
  } catch (error) {
    settingsMessage.value = String(error);
    settingsMessageTone.value = "error";
  }
}

async function importDbConfigFile(file, profileId = pendingImportProfileId.value) {
  if (!file || running.value) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported = extractDbMigrationJsonConfig(parsed);
    if (!imported) {
      throw new Error("JSON 解析失败或缺少连接字段");
    }

    const targetId = profileId || activeProfileId.value;
    if (!targetId) {
      throw new Error("请先选中一个模板，再导入 JSON。");
    }

    const profile = workspaceProfiles.value.find((p) => p.id === targetId);
    if (!profile) {
      throw new Error("未找到要填充的模板。");
    }

    const index = workspaceProfiles.value.indexOf(profile);
    const updated = applyImportedDbMigrationProfileDraft(profile, imported, index);
    updateProfileFields(targetId, updated);
    await persistWorkspaceState().catch(handleWorkspacePersistenceError);

    loginMessage.value = `已将 JSON 填充到模板 ${profile.name || "当前模板"}。`;
    loginMessageTone.value = "success";
  } catch (error) {
    loginMessage.value = String(error);
    loginMessageTone.value = "error";
  }
}

function triggerImport(profileId = "") {
  if (running.value || connecting.value) return;
  pendingImportProfileId.value = profileId || activeProfileId.value;
  importInput.value?.click?.();
}

async function onImportConfig(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  try {
    await importDbConfigFile(file);
  } finally {
    pendingImportProfileId.value = "";
    event.target.value = "";
  }
}

function onHotkeyInputKeydown(event) {
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Backspace" || event.key === "Delete") {
    hotkeyDraft.value = "";
    return;
  }
  if (event.key === "Escape") {
    closeSettings();
    return;
  }

  hotkeyDraft.value = buildHotkeyFromEvent(event);
}

async function closeWindow() {
  try {
    await invoke("hide_db_migration_window");
  } catch (error) {
    executionMessage.value = String(error);
    executionMessageTone.value = "error";
  }
}

async function minimizeWindow() {
  await getCurrentWindow().minimize().catch(() => {});
}

async function toggleMaximizeWindow() {
  const appWindow = getCurrentWindow();
  const maximized = await appWindow.isMaximized().catch(() => false);
  if (maximized) {
    await appWindow.unmaximize().catch(() => {});
  } else {
    await appWindow.maximize().catch(() => {});
  }
}

function startDragging(event) {
  if (event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest("button, input, textarea, select, label, summary")) {
    return;
  }
  getCurrentWindow().startDragging().catch(() => {});
}

function handleLogToggle(event) {
  logExpanded.value = Boolean(event?.target?.open);
}

onMounted(async () => {
  unlistenProgress = await listen("db-migration-progress", (event) => {
    timeline.value = appendDbMigrationTimeline(timeline.value, event.payload || {});
  });
  await restoreWorkspaceState();
});

onBeforeUnmount(() => {
  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
  }
});
</script>

<template>
  <component
    :is="isEmbedded ? 'section' : 'main'"
    :class="['sw-root', 'dmw-root', { 'dmw-root--embedded': isEmbedded }]"
    @contextmenu.prevent
  >
    <header v-if="!isEmbedded" class="sw-toolbar" @pointerdown="startDragging">
      <div class="traffic-lights" @dblclick.stop @pointerdown.stop>
        <button class="traffic-btn traffic-red" title="关闭" :disabled="running" @click="closeWindow" />
        <button class="traffic-btn traffic-yellow" title="最小化" @click="minimizeWindow" />
        <button class="traffic-btn traffic-green" title="最大化/还原" @click="toggleMaximizeWindow" />
      </div>
      <span class="sw-toolbar-title">数据库迁移工作台</span>
      <div class="sw-toolbar-actions">
        <button class="sw-toolbar-btn" title="新增模板" :disabled="running || connecting" @click="addProfile">+</button>
        <button class="sw-toolbar-btn" title="设置" @click="openSettings()">⚙</button>
      </div>
    </header>
    <div class="sw-body">
      <aside v-if="!hideSidebar" class="sw-sidebar dmw-sidebar">
        <div v-if="isEmbedded" class="sync-center-sidebar-chrome" @pointerdown="startDragging">
          <div class="traffic-lights" @dblclick.stop @pointerdown.stop>
            <button class="traffic-btn traffic-red" title="关闭" :disabled="running" @click="emit('close-window')" />
            <button class="traffic-btn traffic-yellow" title="最小化" @click="emit('minimize-window')" />
            <button class="traffic-btn traffic-green" title="最大化/还原" @click="emit('toggle-maximize')" />
          </div>
        </div>
        <section class="sync-center-sidebar-section is-database-sync selected">
          <div class="sync-center-sidebar-section-row">
            <button class="sync-center-sidebar-section-head" type="button">
              <span class="sync-center-sidebar-icon">⇄</span>
              <span class="sync-center-sidebar-copy">
                <span>数据库同步</span>
                <small>{{ currentStatusText }}</small>
              </span>
            </button>
            <button
              class="sync-center-sidebar-add"
              type="button"
              title="新增同步配置"
              :disabled="running || connecting"
              @click.stop="addProfile"
            >
              +
            </button>
          </div>

          <div class="sync-center-sidebar-items">
            <button
              v-for="profile in profilesView"
              :key="profile.id"
              :class="['sw-sidebar-item', 'dmw-sidebar-item', { selected: profile.id === activeProfileId }]"
              :disabled="running || connecting"
              @click="activateProfile(profile.id)"
            >
              <span :class="['sw-sidebar-status-dot', `is-${profile.statusTone}`]"></span>
              <span class="dmw-sidebar-copy">
                <span class="dmw-sidebar-name">{{ profile.name }}</span>
                <span class="dmw-sidebar-summary" :title="profile.summary">{{ profile.summary }}</span>
              </span>
            </button>

            <div v-if="workspaceProfiles.length === 0" class="sync-center-sidebar-empty">暂无同步配置</div>
          </div>
        </section>

        <section v-if="isEmbedded" class="sync-center-sidebar-section is-transfer">
          <div class="sync-center-sidebar-section-row">
            <button
              class="sync-center-sidebar-section-head"
              type="button"
              @click="emit('switch-mode', 'file')"
            >
              <span :class="['sw-sidebar-status-dot', `is-${embeddedFileSyncSummary.tone}`]"></span>
              <span class="sync-center-sidebar-copy">
                <span>转表并同步</span>
                <small>{{ embeddedFileSyncSummary.status }}</small>
              </span>
            </button>
            <button
              class="sync-center-sidebar-add"
              type="button"
              title="新增迁移模板"
              @click.stop="emit('add-file-sync')"
            >
              +
            </button>
          </div>
          <div class="sync-center-sidebar-items">
            <button class="sw-sidebar-item dmw-sidebar-item" type="button" @click="emit('switch-mode', 'file')">
              <span :class="['sw-sidebar-status-dot', `is-${embeddedFileSyncSummary.tone}`]"></span>
              <span class="dmw-sidebar-copy">
                <span class="dmw-sidebar-name">{{ embeddedFileSyncSummary.name }}</span>
                <span class="dmw-sidebar-summary">{{ embeddedFileSyncSummary.status }}</span>
              </span>
            </button>
          </div>
        </section>

      </aside>

      <section class="sw-content dmw-content">
        <template v-if="activeProfile">
          <div class="sw-content-header">
            <h1 class="sw-profile-name">{{ activeProfile.name }}</h1>
            <div class="sw-status-line">
              <span :class="['sw-status-badge', `is-${currentStatusTone}`]">{{ currentStatusText }}</span>
            </div>
            <div class="sync-center-hero-metrics" aria-label="数据库同步摘要">
              <span><strong>2</strong><small>配置步骤</small></span>
              <span><strong>{{ availableDatabases.length }}</strong><small>可选数据库</small></span>
            </div>
          </div>

          <!-- Step indicator -->
          <div class="dmw-steps">
            <button
              :class="['dmw-step-tab', { active: dbStep === 'connection', done: activeProfileConnectionReady }]"
              :disabled="running || connecting"
              @click="dbStep = 'connection'"
            >
              <span class="dmw-step-num">1</span>
              <span>连接配置</span>
            </button>
            <span class="dmw-step-arrow">›</span>
            <button
              :class="['dmw-step-tab', { active: dbStep === 'selection', disabled: !activeProfileConnectionReady }]"
              :disabled="!activeProfileConnectionReady || running || connecting"
              @click="dbStep = 'selection'"
            >
              <span class="dmw-step-num">2</span>
              <span>选择数据库</span>
            </button>
          </div>

          <div v-if="bannerMessage" :class="['sw-banner', `tone-${bannerTone}`]">
            {{ bannerMessage }}
          </div>

          <!-- Step 1: Connection -->
          <div v-if="dbStep === 'connection'" class="sw-config-form dmw-step-card">
            <div class="sw-config-field">
              <label>模板名称</label>
              <input
                v-model="activeProfile.name"
                type="text"
                placeholder="例如：17服覆盖到15服"
                :disabled="running || connecting"
                @change="persistWorkspaceState().catch(handleWorkspacePersistenceError)"
              />
            </div>
            <div class="sw-config-field sw-config-path-row">
              <div>
                <label>主机</label>
                <input
                  v-model="activeProfile.host"
                  type="text"
                  placeholder="127.0.0.1"
                  :disabled="running || connecting"
                  @change="persistWorkspaceState().catch(handleWorkspacePersistenceError)"
                />
              </div>
              <div>
                <label>端口</label>
                <input
                  v-model.number="activeProfile.port"
                  type="number"
                  min="1"
                  placeholder="3306"
                  :disabled="running || connecting"
                  @change="persistWorkspaceState().catch(handleWorkspacePersistenceError)"
                />
              </div>
            </div>
            <div class="sw-config-field sw-config-path-row">
              <div>
                <label>账号</label>
                <input
                  v-model="activeProfile.username"
                  type="text"
                  placeholder="请输入账号"
                  :disabled="running || connecting"
                  @change="persistWorkspaceState().catch(handleWorkspacePersistenceError)"
                />
              </div>
              <div>
                <label>密码</label>
                <input
                  v-model="activeProfile.password"
                  type="password"
                  placeholder="请输入密码"
                  :disabled="running || connecting"
                  @change="persistWorkspaceState().catch(handleWorkspacePersistenceError)"
                />
              </div>
            </div>
            <div class="dmw-step-card-actions">
              <button
                class="sw-run-btn"
                :disabled="!activeProfileConnectionReady || connecting || running"
                @click="nextStepFromConnection"
              >
                {{ connecting ? '连接中...' : '下一步' }}
              </button>
              <button
                class="sw-open-dir-btn"
                :disabled="running || connecting"
                @click="triggerImport(activeProfile.id)"
              >
                导入 JSON
              </button>
            </div>
          </div>

          <!-- Step 2: Database Selection -->
          <div v-if="dbStep === 'selection'" class="dmw-step-card">
            <div class="sw-action-row dmw-selection-actions">
              <button
                class="sw-run-btn"
                :disabled="!canRunMigration || !hasEnoughDatabases"
                @click="confirmAndRunMigration"
              >
                {{ running ? '迁移中...' : '开始完整覆盖' }}
              </button>
              <button class="sw-open-dir-btn" :disabled="!backupDir" @click="openBackupDirectory">
                打开备份目录
              </button>
            </div>

            <div class="sw-config-form" style="margin-top: 12px;">
              <div class="sw-config-form-title">选择源库和目标库</div>
              <div class="sw-config-field">
                <label>源库</label>
                <select
                  v-model="sourceDatabase"
                  class="dmw-select"
                  :title="sourceDatabase || '请选择源库'"
                  :disabled="phase === 'login' || running || connecting"
                >
                  <option value="">请选择源库</option>
                  <option v-for="db in availableDatabases" :key="`source-${db}`" :value="db">
                    {{ db }}
                  </option>
                </select>
              </div>
              <div class="sw-config-field">
                <label>目标库</label>
                <select
                  v-model="targetDatabase"
                  class="dmw-select"
                  :title="targetDatabase || '请选择目标库'"
                  :disabled="phase === 'login' || running || connecting"
                >
                  <option value="">请选择目标库</option>
                  <option v-for="db in availableDatabases" :key="`target-${db}`" :value="db">
                    {{ db }}
                  </option>
                </select>
              </div>
              <p v-if="!hasEnoughDatabases" class="dmw-step-note">
                当前账号可见业务库少于 2 个，暂时无法执行完整覆盖。
              </p>
            </div>
          </div>

          <!-- Pipeline & Log (non-embedded only) -->
          <section v-if="!isEmbedded && dbStep === 'selection'" class="dmw-section">
            <div class="sw-pipeline">
              <div class="sw-pipeline-title">执行步骤</div>
              <ul class="sw-step-list">
                <li v-for="step in pipelineView" :key="step.key" class="sw-step-item">
                  <span :class="['sw-step-icon', `is-${step.status}`]">{{ step.icon }}</span>
                  <span :class="['sw-step-label', { 'is-pending': step.status === 'pending' }]">
                    {{ step.label }}
                  </span>
                  <span v-if="step.message" class="sw-step-msg" :title="step.message">{{ step.message }}</span>
                  <span v-if="step.timeLabel" class="sw-step-time">{{ step.timeLabel }}</span>
                </li>
              </ul>
            </div>

            <details
              v-if="!isEmbedded && timelineView.length > 0"
              class="sw-log-details"
              :open="logExpanded"
              @toggle="handleLogToggle"
            >
              <summary>{{ logSummaryText }}</summary>
              <ol class="sw-log-list-inner">
                <li v-for="entry in timelineView" :key="entry.key" class="sw-log-entry">
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
        </template>

        <template v-else>
          <div class="sw-empty">
            <div class="sw-empty-title">先创建一个迁移模板</div>
            <div class="sw-empty-desc">连接 MySQL，然后选择源数据库和目标数据库</div>
            <button class="sw-empty-btn" :disabled="running || connecting" @click="addProfile">新建模板</button>
          </div>
        </template>

        <input
          ref="importInput"
          class="dmw-hidden-input"
          type="file"
          accept="application/json"
          @change="onImportConfig"
        />
      </section>
    </div>

    <div v-if="settingsOpen" class="sw-settings-overlay" @click.self="closeSettings">
      <section class="sw-settings-sheet dmw-settings-sheet">
        <header class="sw-settings-header">
          <h2>迁移工作台设置</h2>
          <button class="sw-toolbar-btn" @click="closeSettings">✕</button>
        </header>

        <div class="sw-settings-body">
          <div v-if="!isEmbedded" class="sw-settings-section">
            <div class="sw-settings-section-title">快捷键</div>
            <div class="sw-settings-field">
              <span class="sw-settings-field-label">打开迁移工作台</span>
              <input
                class="sw-settings-input"
                :value="hotkeyDraft"
                type="text"
                readonly
                placeholder="点击后按下快捷键"
                @keydown="onHotkeyInputKeydown"
              />
            </div>
          </div>
        </div>

        <footer class="sw-settings-footer">
          <button class="sw-settings-cancel-btn" @click="closeSettings">取消</button>
          <button class="sw-settings-save-btn" :disabled="settingsSaving" @click="saveSettings">
            {{ settingsSaving ? '保存中...' : '保存' }}
          </button>
        </footer>
      </section>
    </div>
  </component>
</template>
