<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { buildHotkeyFromEvent } from "./syncWorkspace.js";
import {
  appendDbMigrationTimeline,
  buildDbMigrationHeadline,
  DB_MIGRATION_PIPELINE_STEPS,
  DEFAULT_DB_MIGRATION_WINDOW_HOTKEY,
  extractDbMigrationJsonConfig,
  filterMigrationDatabaseNames,
  isDbMigrationSelectionReady,
  normalizeDbMigrationRememberedConnection,
  normalizeDbMigrationWindowHotkey,
  resolveDbMigrationSelections,
  shouldAutoExpandDbMigrationLog,
} from "./dbMigrationWorkspace.js";

const loginForm = reactive({
  host: "",
  port: 3306,
  username: "",
  password: "",
});

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
const settingsOpen = ref(false);
const settingsSaving = ref(false);
const settingsMessage = ref("");
const settingsMessageTone = ref("neutral");
const workspaceHotkey = ref(DEFAULT_DB_MIGRATION_WINDOW_HOTKEY);
const hotkeyDraft = ref(DEFAULT_DB_MIGRATION_WINDOW_HOTKEY);
const rememberedConnectionSaved = ref(false);
const importInput = ref(null);

let unlistenProgress = null;

const canSubmitLogin = computed(() =>
  [loginForm.host, loginForm.username].every((value) => String(value || "").trim().length > 0)
  && Number(loginForm.port) > 0
  && !connecting.value
  && !running.value,
);

const hasEnoughDatabases = computed(() => availableDatabases.value.length >= 2);

const canRunMigration = computed(() =>
  !running.value
  && phase.value !== "login"
  && isDbMigrationSelectionReady({
    sourceDatabase: sourceDatabase.value,
    targetDatabase: targetDatabase.value,
  }),
);

const currentStatusTone = computed(() => {
  if (connecting.value || running.value) return "running";
  if (executionMessageTone.value === "error") return "error";
  if (executionMessageTone.value === "success") return "success";
  if (phase.value !== "login") return "ready";
  if (loginMessageTone.value === "error") return "error";
  return "idle";
});

const currentStatusText = computed(() => {
  if (connecting.value) return "连接中";
  if (running.value) return "迁移进行中";
  if (executionMessageTone.value === "error") return "最近一次失败";
  if (executionMessageTone.value === "success") return "最近一次完成";
  if (phase.value !== "login") return "已连接";
  if (loginMessageTone.value === "error") return "连接失败";
  return "等待登录";
});

const workspaceHeadline = computed(() =>
  buildDbMigrationHeadline({
    sourceDatabase: sourceDatabase.value,
    targetDatabase: targetDatabase.value,
  }),
);

const bannerMessage = computed(() => executionMessage.value || loginMessage.value);
const bannerTone = computed(() =>
  executionMessage.value ? executionMessageTone.value : loginMessageTone.value,
);

const sidebarServerText = computed(() => {
  const host = String(loginForm.host || "").trim();
  if (!host) return "未连接服务器";
  return `${host}:${Number(loginForm.port) || 3306}`;
});

const sidebarCredentialText = computed(() => {
  const username = String(loginForm.username || "").trim();
  if (!username) return "拖入 JSON 或手动输入连接信息";
  return username;
});

const sidebarStatusNote = computed(() => {
  if (latestSummary.value) return latestSummary.value;
  if (phase.value === "login") return "连接后选择源库和目标库。";
  if (!hasEnoughDatabases.value) return "当前账号可见业务库少于 2 个。";
  return "完整覆盖前会先备份源库和目标库。";
});

const connectionDetails = computed(() => [
  { label: "主机", value: String(loginForm.host || "").trim() || "-" },
  { label: "端口", value: String(Number(loginForm.port) || 3306) },
  { label: "账号", value: String(loginForm.username || "").trim() || "-" },
  { label: "可见库", value: String(availableDatabases.value.length || 0) },
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

watch([sourceDatabase, targetDatabase], () => {
  if (!running.value && phase.value === "finished") {
    phase.value = "ready";
    executionMessage.value = "";
    executionMessageTone.value = "neutral";
    timeline.value = [];
    backupDir.value = "";
    latestSummary.value = "";
    logExpanded.value = shouldAutoExpandDbMigrationLog();
  }

  if (phase.value !== "login" && !connecting.value) {
    persistRememberedConnection().catch(() => {});
  }
});

function clearExecutionArtifacts() {
  executionMessage.value = "";
  executionMessageTone.value = "neutral";
  timeline.value = [];
  backupDir.value = "";
  latestSummary.value = "";
  logExpanded.value = shouldAutoExpandDbMigrationLog();
}

function resetWorkspaceState({ clearForm = true } = {}) {
  phase.value = "login";
  connecting.value = false;
  running.value = false;
  availableDatabases.value = [];
  sourceDatabase.value = "";
  targetDatabase.value = "";
  clearExecutionArtifacts();
  loginMessage.value = "";
  loginMessageTone.value = "neutral";

  if (clearForm) {
    loginForm.host = "";
    loginForm.port = 3306;
    loginForm.username = "";
    loginForm.password = "";
  }
}

function applyConnectionToForm(connection = null) {
  const remembered = normalizeDbMigrationRememberedConnection(connection);
  if (!remembered) return;
  loginForm.host = remembered.host;
  loginForm.port = remembered.port;
  loginForm.username = remembered.username;
  loginForm.password = remembered.password;
  sourceDatabase.value = remembered.sourceDatabase;
  targetDatabase.value = remembered.targetDatabase;
}

function buildRememberedConnectionPayload() {
  return normalizeDbMigrationRememberedConnection({
    host: loginForm.host,
    port: loginForm.port,
    username: loginForm.username,
    password: loginForm.password,
    sourceDatabase: sourceDatabase.value,
    targetDatabase: targetDatabase.value,
  });
}

async function persistRememberedConnection() {
  const connection = buildRememberedConnectionPayload();
  await invoke("save_db_migration_workspace_connection", { connection });
  rememberedConnectionSaved.value = Boolean(connection);
}

async function clearRememberedConnection() {
  await invoke("save_db_migration_workspace_connection", { connection: null });
  rememberedConnectionSaved.value = false;
}

async function restoreWorkspaceState() {
  try {
    const state = await invoke("get_db_migration_workspace_state");
    workspaceHotkey.value = normalizeDbMigrationWindowHotkey(state.hotkey);
    hotkeyDraft.value = workspaceHotkey.value;
    rememberedConnectionSaved.value = Boolean(state.rememberedConnection);

    const rememberedConnection = normalizeDbMigrationRememberedConnection(state.rememberedConnection);
    if (!rememberedConnection) return;

    applyConnectionToForm(rememberedConnection);
    await connectServer({ restoring: true });
  } catch {
    workspaceHotkey.value = DEFAULT_DB_MIGRATION_WINDOW_HOTKEY;
    hotkeyDraft.value = DEFAULT_DB_MIGRATION_WINDOW_HOTKEY;
  }
}

async function connectServer({ restoring = false } = {}) {
  if (!canSubmitLogin.value && !restoring) return;
  connecting.value = true;
  loginMessage.value = restoring ? "正在恢复连接..." : "正在连接...";
  loginMessageTone.value = "running";

  const requestedSelection = {
    sourceDatabase: sourceDatabase.value,
    targetDatabase: targetDatabase.value,
  };

  try {
    const result = await invoke("connect_db_migration_server", {
      params: {
        host: loginForm.host.trim(),
        port: Number(loginForm.port) || 3306,
        username: loginForm.username.trim(),
        password: loginForm.password,
      },
    });
    const databases = filterMigrationDatabaseNames(result.databases || []);
    const resolvedSelection = resolveDbMigrationSelections(databases, requestedSelection);

    availableDatabases.value = databases;
    sourceDatabase.value = resolvedSelection.sourceDatabase;
    targetDatabase.value = resolvedSelection.targetDatabase;
    phase.value = "ready";
    clearExecutionArtifacts();
    loginMessage.value = databases.length >= 2
      ? `已连接 ${result.host}:${result.port}`
      : `已连接 ${result.host}:${result.port}，但可见业务库少于 2 个`;
    loginMessageTone.value = databases.length >= 2 ? "success" : "error";
    await persistRememberedConnection();
  } catch (error) {
    phase.value = "login";
    availableDatabases.value = [];
    clearExecutionArtifacts();
    loginMessage.value = restoring
      ? `恢复连接失败：${String(error)}`
      : `连接失败：${String(error)}`;
    loginMessageTone.value = "error";
  } finally {
    connecting.value = false;
  }
}

async function confirmAndRunMigration() {
  if (!canRunMigration.value) return;
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
  running.value = true;
  phase.value = "running";
  clearExecutionArtifacts();
  executionMessage.value = `正在备份并覆盖 ${workspaceHeadline.value}`;
  executionMessageTone.value = "running";

  try {
    const result = await invoke("run_db_migration", {
      request: {
        host: loginForm.host.trim(),
        port: Number(loginForm.port) || 3306,
        username: loginForm.username.trim(),
        password: loginForm.password,
        sourceDatabase: sourceDatabase.value,
        targetDatabase: targetDatabase.value,
      },
    });
    latestSummary.value = result.summary || "";
    backupDir.value = result.backupDir || "";
    executionMessage.value = result.summary || "迁移完成";
    executionMessageTone.value = "success";
    phase.value = "finished";
    await persistRememberedConnection();
  } catch (error) {
    executionMessage.value = String(error);
    executionMessageTone.value = "error";
    phase.value = "finished";
  } finally {
    running.value = false;
  }
}

async function switchConnection() {
  if (running.value) return;
  await clearRememberedConnection().catch(() => {});
  resetWorkspaceState({ clearForm: true });
  loginMessage.value = "已清除当前连接，请重新输入。";
  loginMessageTone.value = "neutral";
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

async function importDbConfigFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported = extractDbMigrationJsonConfig(parsed);
    if (!imported) {
      throw new Error("JSON 解析失败或缺少连接字段");
    }

    resetWorkspaceState({ clearForm: false });
    loginForm.host = imported.host;
    loginForm.port = imported.port;
    loginForm.username = imported.username;
    loginForm.password = imported.password;
    sourceDatabase.value = imported.sourceDatabase;
    targetDatabase.value = imported.targetDatabase;
    loginMessage.value = "已导入 JSON，请连接。";
    loginMessageTone.value = "success";
  } catch (error) {
    loginMessage.value = String(error);
    loginMessageTone.value = "error";
  }
}

function triggerImport() {
  importInput.value?.click?.();
}

async function onImportConfig(event) {
  const file = event.target?.files?.[0];
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

function openSettings() {
  hotkeyDraft.value = workspaceHotkey.value;
  settingsMessage.value = "";
  settingsMessageTone.value = "neutral";
  settingsOpen.value = true;
}

function closeSettings() {
  settingsOpen.value = false;
  hotkeyDraft.value = workspaceHotkey.value;
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

async function saveSettings() {
  if (settingsSaving.value) return;
  settingsSaving.value = true;
  settingsMessage.value = "";
  settingsMessageTone.value = "neutral";

  try {
    const normalized = await invoke("register_db_migration_window_hotkey", {
      hotkey: hotkeyDraft.value,
    });
    workspaceHotkey.value = normalizeDbMigrationWindowHotkey(normalized);
    hotkeyDraft.value = workspaceHotkey.value;
    settingsMessage.value = "设置已保存。";
    settingsMessageTone.value = "success";
    settingsOpen.value = false;
  } catch (error) {
    settingsMessage.value = String(error);
    settingsMessageTone.value = "error";
  } finally {
    settingsSaving.value = false;
  }
}

async function clearRememberedConnectionFromSettings() {
  if (running.value) return;
  try {
    await clearRememberedConnection();
    settingsMessage.value = "已清除已记住的连接。";
    settingsMessageTone.value = "success";
  } catch (error) {
    settingsMessage.value = String(error);
    settingsMessageTone.value = "error";
  }
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
  <main
    class="sw-root dmw-root"
    @contextmenu.prevent
    @dragover.prevent
    @drop.prevent="onDropConfig"
  >
    <header class="sw-toolbar" @pointerdown="startDragging">
      <div class="traffic-lights" @dblclick.stop @pointerdown.stop>
        <button class="traffic-btn traffic-red" title="关闭" :disabled="running" @click="closeWindow" />
        <button class="traffic-btn traffic-yellow" title="最小化" @click="minimizeWindow" />
        <button class="traffic-btn traffic-green" title="最大化/还原" @click="toggleMaximizeWindow" />
      </div>
      <span class="sw-toolbar-title">数据库迁移工作台</span>
      <div class="sw-toolbar-actions">
        <button class="sw-toolbar-btn" title="设置" @click="openSettings">⚙</button>
      </div>
    </header>

    <div class="sw-body">
      <aside class="sw-sidebar dmw-sidebar">
        <section class="dmw-sidebar-card">
          <div class="dmw-sidebar-kicker">当前服务器</div>
          <div class="dmw-sidebar-value">{{ sidebarServerText }}</div>
          <div class="dmw-sidebar-meta">{{ sidebarCredentialText }}</div>
        </section>

        <section class="dmw-sidebar-card">
          <div class="dmw-sidebar-kicker">当前迁移</div>
          <div class="dmw-sidebar-value">{{ workspaceHeadline }}</div>
          <div class="dmw-sidebar-meta">
            {{ phase === 'login' ? '连接后选择源库和目标库。' : '源库将完整覆盖目标库。' }}
          </div>
        </section>

        <section class="dmw-sidebar-card">
          <div class="dmw-sidebar-kicker">状态</div>
          <div class="sw-status-line">
            <span :class="['sw-status-badge', `is-${currentStatusTone}`]">{{ currentStatusText }}</span>
          </div>
          <div class="dmw-sidebar-meta">{{ sidebarStatusNote }}</div>
        </section>

        <div class="dmw-sidebar-footer">
          <span class="dmw-hotkey-pill">{{ workspaceHotkey }}</span>
          <span class="dmw-drop-hint">支持拖入 JSON 自动填充</span>
        </div>
      </aside>

      <section class="sw-content dmw-content">
        <div class="sw-content-header">
          <h1 class="sw-profile-name">{{ workspaceHeadline }}</h1>
          <div class="sw-status-line">
            <span :class="['sw-status-badge', `is-${currentStatusTone}`]">{{ currentStatusText }}</span>
            <span>{{ phase === 'login' ? '配置连接后即可开始。' : '界面会记住上次连接和窗口大小。' }}</span>
          </div>
        </div>

        <div v-if="bannerMessage" :class="['sw-banner', `tone-${bannerTone}`]">
          {{ bannerMessage }}
        </div>

        <section class="dmw-section">
          <div class="dmw-section-head">
            <div>
              <h2 class="dmw-section-title">连接</h2>
              <p class="dmw-section-subtitle">支持拖入 JSON 自动填充，不自动连接。</p>
            </div>
            <div class="dmw-section-actions">
              <button class="sw-open-dir-btn" type="button" @click="triggerImport">导入 JSON</button>
              <button
                v-if="phase !== 'login'"
                class="sw-open-dir-btn dmw-secondary-action"
                type="button"
                :disabled="running"
                @click="switchConnection"
              >
                切换连接
              </button>
            </div>
          </div>

          <div v-if="phase === 'login'" class="sw-config-form dmw-form">
            <div class="dmw-form-grid">
              <div class="sw-config-field">
                <label>主机</label>
                <input v-model="loginForm.host" type="text" placeholder="127.0.0.1" />
              </div>
              <div class="sw-config-field">
                <label>端口</label>
                <input v-model.number="loginForm.port" type="number" min="1" placeholder="3306" />
              </div>
              <div class="sw-config-field">
                <label>用户名</label>
                <input v-model="loginForm.username" type="text" placeholder="请输入用户名" />
              </div>
              <div class="sw-config-field">
                <label>密码</label>
                <input v-model="loginForm.password" type="password" placeholder="请输入密码" />
              </div>
            </div>

            <div class="sw-action-row">
              <button class="sw-run-btn" :disabled="!canSubmitLogin" @click="connectServer()">
                {{ connecting ? '连接中...' : '连接 MySQL' }}
              </button>
            </div>
          </div>

          <div v-else class="dmw-connection-grid">
            <div v-for="item in connectionDetails" :key="item.label" class="dmw-connection-card">
              <span class="dmw-connection-label">{{ item.label }}</span>
              <span class="dmw-connection-value">{{ item.value }}</span>
            </div>
          </div>
        </section>

        <section class="dmw-section">
          <div class="dmw-section-head">
            <div>
              <h2 class="dmw-section-title">执行</h2>
              <p class="dmw-section-subtitle">先备份，再完整覆盖目标库。</p>
            </div>
          </div>

          <div class="dmw-select-grid">
            <div class="sw-config-field">
              <label>源库</label>
              <select v-model="sourceDatabase" class="dmw-select" :disabled="phase === 'login' || running">
                <option value="">请选择源库</option>
                <option v-for="db in availableDatabases" :key="`source-${db}`" :value="db">
                  {{ db }}
                </option>
              </select>
            </div>

            <div class="sw-config-field">
              <label>目标库</label>
              <select v-model="targetDatabase" class="dmw-select" :disabled="phase === 'login' || running">
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

          <p v-if="!hasEnoughDatabases && phase !== 'login'" class="dmw-inline-note">
            当前账号可见业务库少于 2 个，暂时无法执行完整覆盖。
          </p>

          <div v-if="backupDir" class="dmw-path-card">
            <span class="dmw-path-label">备份目录</span>
            <code class="dmw-path-value">{{ backupDir }}</code>
          </div>
        </section>

        <section class="dmw-section">
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
            v-if="timelineView.length > 0"
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
      <section class="sw-settings-sheet">
        <header class="sw-settings-header">
          <h2>迁移工作台设置</h2>
          <button class="sw-toolbar-btn" @click="closeSettings">✕</button>
        </header>

        <div class="sw-settings-body">
          <div class="sw-settings-section">
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
            <div class="sw-settings-section-title">连接记忆</div>
            <p class="dmw-settings-note">
              {{ rememberedConnectionSaved ? '下次打开会自动恢复已记住的连接。' : '当前没有已记住的连接。' }}
            </p>
            <div class="sw-settings-profile-actions">
              <button
                class="sw-settings-action-btn danger"
                :disabled="running || !rememberedConnectionSaved"
                @click="clearRememberedConnectionFromSettings"
              >
                清除已记住的连接
              </button>
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
  </main>
</template>
