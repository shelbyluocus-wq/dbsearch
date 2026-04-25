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
  applyIncompleteProfileState(profile, {
    message: "已新增模板，请在编辑模板里补全连接信息。",
    tone: "neutral",
  });
  if (settingsOpen.value) {
    syncSettingsDraftFromWorkspace({ editingProfileId: profile.id });
    settingsMessage.value = `已新增模板 ${profile.name}。`;
    settingsMessageTone.value = "neutral";
  }
  await persistWorkspaceState().catch(handleWorkspacePersistenceError);
}

defineExpose({
  addProfile,
  addProfileWithSeed: (seed) => addProfile(seed),
  activateProfile,
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
    const previousActiveProfile = activeProfile.value
      ? normalizeDbMigrationProfile(activeProfile.value)
      : null;
    const nextSnapshot = buildSettingsDraftSnapshot(activeProfileId.value);

    workspaceHotkey.value = normalizeDbMigrationWindowHotkey(normalizedHotkey);
    hotkeyDraft.value = workspaceHotkey.value;
    applyWorkspaceSnapshot(nextSnapshot);
    await persistWorkspaceState({
      profiles: nextSnapshot.profiles,
      lastUsedProfileId: nextSnapshot.lastUsedProfileId,
      applyToState: false,
    });

    const nextActiveProfile = workspaceProfiles.value.find(
      (profile) => profile.id === activeProfileId.value,
    ) || null;

    if (!nextActiveProfile) {
      applyEmptyWorkspaceState();
    } else if (!isDbMigrationProfileConnectionReady(nextActiveProfile)) {
      applyIncompleteProfileState(nextActiveProfile, {
        message: "模板已保存，请先在设置里补全连接信息。",
        tone: "neutral",
        clearExecution: false,
      });
    } else if (
      !currentConnection.value
      || !previousActiveProfile
      || previousActiveProfile.id !== nextActiveProfile.id
      || !isSameDbMigrationConnection(currentConnection.value, nextActiveProfile)
    ) {
      await connectProfile(nextActiveProfile);
    } else {
      applyProfileSelections(nextActiveProfile, availableDatabases.value);
      rememberProfileStatus(
        nextActiveProfile.id,
        availableDatabases.value.length >= 2 ? "success" : "error",
      );
      loginMessage.value = availableDatabases.value.length >= 2
        ? `已应用模板 ${nextActiveProfile.name}`
        : `已应用模板 ${nextActiveProfile.name}，但可见业务库少于 2 个`;
      loginMessageTone.value = availableDatabases.value.length >= 2 ? "success" : "error";
    }

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

    if (!settingsOpen.value || !profileId) {
      throw new Error("请先打开模板编辑，再导入 JSON 填充当前模板。");
    }

    const draftProfile = settingsProfilesDraft.value.find((profile) => profile.id === profileId);
    if (!draftProfile) {
      throw new Error("未找到要填充的模板。");
    }

    replaceDraftProfile(profileId, (profile, index) =>
      applyImportedDbMigrationProfileDraft(profile, imported, index));
    settingsEditingProfileId.value = profileId;
    settingsMessage.value = `已将 JSON 填充到模板 ${draftProfile.name || "当前模板"}。`;
    settingsMessageTone.value = "success";
  } catch (error) {
    settingsMessage.value = String(error);
    settingsMessageTone.value = "error";
  }
}

function triggerImport(profileId = "") {
  if (running.value || connecting.value) return;
  pendingImportProfileId.value = profileId;
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
        <section class="sync-center-sidebar-section is-transfer selected">
          <div class="sync-center-sidebar-section-row">
            <button class="sync-center-sidebar-section-head" type="button">
              <span class="sync-center-sidebar-icon">⌘</span>
              <span class="sync-center-sidebar-copy">
                <span>转表</span>
                <small>{{ currentStatusText }}</small>
              </span>
            </button>
            <button
              class="sync-center-sidebar-add"
              type="button"
              title="新增迁移模板"
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

            <div v-if="workspaceProfiles.length === 0" class="sync-center-sidebar-empty">暂无迁移模板</div>
          </div>
        </section>

        <section v-if="isEmbedded" class="sync-center-sidebar-section is-database-sync">
          <div class="sync-center-sidebar-section-row">
            <button
              class="sync-center-sidebar-section-head"
              type="button"
              @click="emit('switch-mode', 'file')"
            >
              <span :class="['sw-sidebar-status-dot', `is-${embeddedFileSyncSummary.tone}`]"></span>
              <span class="sync-center-sidebar-copy">
                <span>数据库同步</span>
                <small>{{ embeddedFileSyncSummary.status }}</small>
              </span>
            </button>
            <button
              class="sync-center-sidebar-add"
              type="button"
              title="新增同步配置"
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
            <div class="dmw-header-copy">
              <h1 class="sw-profile-name">{{ activeProfile.name }}</h1>
              <div class="dmw-header-subtitle">{{ activeProfileSummary }}</div>
            </div>
            <div class="sw-status-line">
              <span :class="['sw-status-badge', `is-${currentStatusTone}`]">{{ currentStatusText }}</span>
              <span>{{ headerHelperText }}</span>
            </div>
          </div>

          <div v-if="bannerMessage" :class="['sw-banner', `tone-${bannerTone}`]">
            {{ bannerMessage }}
          </div>

          <section class="dmw-section dmw-section-primary">
            <div class="dmw-section-head">
              <div>
                <h2 class="dmw-section-title">执行</h2>
                <p class="dmw-section-subtitle">{{ executionSectionSubtitle }}</p>
              </div>
              <div class="dmw-section-actions">
                <button
                  class="sw-open-dir-btn dmw-secondary-action"
                  type="button"
                  :disabled="running || connecting"
                  @click="openSettingsForActiveProfile"
                >
                  编辑模板
                </button>
              </div>
            </div>

            <div v-if="!activeProfileConnectionReady" class="dmw-incomplete-card">
              <div class="dmw-incomplete-title">模板还没配完整</div>
              <p class="dmw-inline-note">请在编辑模板里补全主机、端口、账号和密码；补全后点选模板会自动连接。</p>
              <div class="sw-action-row">
                <button class="sw-open-dir-btn" type="button" :disabled="running || connecting" @click="openSettingsForActiveProfile">
                  去编辑模板
                </button>
              </div>
            </div>

            <div class="dmw-selection-preview-grid">
              <div v-for="item in selectedDatabaseCards" :key="item.label" class="dmw-selection-preview">
                <span class="dmw-selection-preview-label">{{ item.label }}</span>
                <strong class="dmw-selection-preview-value" :title="item.value">{{ item.value }}</strong>
              </div>
            </div>

            <div class="dmw-select-grid">
              <div class="sw-config-field">
                <label>源库</label>
                <select
                  v-model="sourceDatabase"
                  class="dmw-select"
                  :title="sourceDatabase || '请选择源库'"
                  :disabled="phase === 'login' || running || connecting || !activeProfileConnectionReady"
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
                  :disabled="phase === 'login' || running || connecting || !activeProfileConnectionReady"
                >
                  <option value="">请选择目标库</option>
                  <option v-for="db in availableDatabases" :key="`target-${db}`" :value="db">
                    {{ db }}
                  </option>
                </select>
              </div>
            </div>

            <div class="sw-action-row">
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

            <p v-if="phase === 'login' && activeProfileConnectionReady" class="dmw-inline-note">
              当前模板尚未连接成功，连接后才能选择源库和目标库。
            </p>

            <p v-if="!hasEnoughDatabases && phase !== 'login'" class="dmw-inline-note">
              当前账号可见业务库少于 2 个，暂时无法执行完整覆盖。
            </p>

            <div v-if="backupDir" class="dmw-path-card">
              <span class="dmw-path-label">备份目录</span>
              <code class="dmw-path-value">{{ backupDir }}</code>
            </div>
          </section>

          <section v-if="!isEmbedded" class="dmw-section">
            <div class="dmw-section-head">
              <div>
                <h2 class="dmw-section-title">记录</h2>
                <p class="dmw-section-subtitle">执行步骤和详细日志。</p>
              </div>
            </div>

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
          <div class="sw-content-header">
            <div class="dmw-header-copy">
              <h1 class="sw-profile-name">数据库迁移工作台</h1>
              <div class="dmw-header-subtitle">左侧模板列表会保存多套连接配置和源/目标库选择。</div>
            </div>
            <div class="sw-status-line">
              <span :class="['sw-status-badge', `is-${currentStatusTone}`]">{{ currentStatusText }}</span>
              <span>{{ headerHelperText }}</span>
            </div>
          </div>

          <section class="dmw-empty-state">
            <h2 class="dmw-empty-title">先创建一个迁移模板</h2>
            <p class="dmw-empty-desc">
              模板会记住连接信息和源/目标库选择。创建后可在编辑模板里导入 JSON，并在中间执行区完成迁移。
            </p>
            <div class="sw-action-row">
              <button class="sw-run-btn" :disabled="running || connecting" @click="addProfile">新建模板</button>
            </div>
          </section>
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

          <div class="sw-settings-section">
            <div class="dmw-settings-section-head">
              <div>
                <div class="sw-settings-section-title">模板管理</div>
                <p class="dmw-settings-note">模板名称和连接信息在这里维护，源库/目标库仍在主区选择并自动回写。</p>
              </div>
              <button class="sw-settings-action-btn primary" type="button" :disabled="running || connecting" @click="addDraftProfile">
                新增模板
              </button>
            </div>

            <div v-if="settingsProfilesDraft.length === 0" class="dmw-settings-empty">
              暂无模板，点击“新增模板”或关闭后导入 JSON 创建。
            </div>

            <div
              v-for="(profile, index) in settingsProfilesDraft"
              :key="profile.id"
              class="sw-settings-profile-item dmw-settings-profile-item"
            >
              <button class="sw-settings-profile-row" @click="toggleSettingsProfileEdit(profile.id)">
                <span class="dmw-settings-profile-main">
                  <span class="sw-settings-profile-name">
                    {{ profile.name }}
                    <span v-if="profile.id === activeProfileId" class="dmw-settings-profile-current">当前</span>
                  </span>
                  <span class="dmw-settings-profile-summary">{{ describeDbMigrationProfile(profile, index) }}</span>
                </span>
                <span :class="['sw-settings-profile-chevron', { open: settingsEditingProfileId === profile.id }]">▶</span>
              </button>

              <div v-if="settingsEditingProfileId === profile.id" class="sw-settings-profile-edit">
                <div class="sw-settings-field">
                  <span class="sw-settings-field-label">模板名称</span>
                  <input
                    v-model="profile.name"
                    class="sw-settings-input"
                    type="text"
                    placeholder="例如：17服覆盖到15服"
                  />
                </div>

                <div class="sw-settings-path-row">
                  <div class="sw-settings-field">
                    <span class="sw-settings-field-label">主机</span>
                    <input
                      v-model="profile.host"
                      class="sw-settings-input"
                      type="text"
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div class="sw-settings-field">
                    <span class="sw-settings-field-label">端口</span>
                    <input
                      v-model.number="profile.port"
                      class="sw-settings-input"
                      type="number"
                      min="1"
                      placeholder="3306"
                    />
                  </div>
                </div>

                <div class="sw-settings-path-row">
                  <div class="sw-settings-field">
                    <span class="sw-settings-field-label">账号</span>
                    <input
                      v-model="profile.username"
                      class="sw-settings-input"
                      type="text"
                      placeholder="请输入账号"
                    />
                  </div>
                  <div class="sw-settings-field">
                    <span class="sw-settings-field-label">密码</span>
                    <input
                      v-model="profile.password"
                      class="sw-settings-input"
                      type="password"
                      placeholder="请输入密码"
                    />
                  </div>
                </div>

                <div class="dmw-settings-inline-actions">
                  <button
                    class="sw-settings-action-btn"
                    type="button"
                    :disabled="running || connecting"
                    @click="triggerImport(profile.id)"
                  >
                    导入 JSON
                  </button>
                  <button
                    class="sw-settings-action-btn primary"
                    type="button"
                    :disabled="running || connecting"
                    @click="connectDraftProfile(profile.id)"
                  >
                    {{ connecting && activeProfileId === profile.id ? '连接中...' : '连接当前模板' }}
                  </button>
                </div>

                <div class="sw-settings-profile-actions">
                  <button
                    class="sw-settings-action-btn danger"
                    type="button"
                    :disabled="running || connecting"
                    @click="removeDraftProfile(profile.id)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="settingsMessage" :class="['sw-banner', `tone-${settingsMessageTone}`]">
            {{ settingsMessage }}
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
