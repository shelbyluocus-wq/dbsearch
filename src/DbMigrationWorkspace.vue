<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  appendDbMigrationTimeline,
  buildDbMigrationHeadline,
  DB_MIGRATION_PIPELINE_STEPS,
  filterMigrationDatabaseNames,
  FIXED_DB_MIGRATION_HOTKEY,
  isDbMigrationSelectionReady,
  shouldAutoExpandDbMigrationLog,
  shouldResetDbMigrationWorkspaceOnShow,
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

let unlistenProgress = null;
let unlistenReset = null;

const canSubmitLogin = computed(() =>
  [loginForm.host, loginForm.username].every((value) => String(value || "").trim().length > 0)
    && Number(loginForm.port) > 0,
);

const canRunMigration = computed(() =>
  !running.value
  && isDbMigrationSelectionReady({
    sourceDatabase: sourceDatabase.value,
    targetDatabase: targetDatabase.value,
  }),
);

const hasEnoughDatabases = computed(() => availableDatabases.value.length >= 2);

const currentStatusTone = computed(() => {
  if (running.value) return "running";
  if (executionMessageTone.value === "error") return "error";
  if (executionMessageTone.value === "success") return "success";
  if (phase.value === "confirming") return "running";
  if (phase.value === "ready") return "ready";
  return "idle";
});

const currentStatusText = computed(() => {
  if (running.value) return "迁移进行中";
  if (phase.value === "confirming") return "等待确认";
  if (executionMessageTone.value === "error") return "最近一次失败";
  if (executionMessageTone.value === "success") return "最近一次完成";
  if (phase.value === "ready") return "已连接";
  return "等待登录";
});

const workspaceHeadline = computed(() =>
  buildDbMigrationHeadline({
    sourceDatabase: sourceDatabase.value,
    targetDatabase: targetDatabase.value,
  }),
);

const logSummaryText = computed(() =>
  timelineView.value.length > 0 ? `详细日志（${timelineView.value.length}）` : "详细日志",
);

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
      if (status === "success" || status === "error" || status === "running") {
        encounteredActive = encounteredActive || status !== "success";
      }
    } else if (!encounteredActive && index === 0 && running.value) {
      status = "running";
      encounteredActive = true;
    }

    const timeLabel = entry?.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      : "";

    return {
      key: step.key,
      label: step.label,
      message: entry?.message || "",
      status,
      timeLabel,
      markerText: status === "success" ? "✓" : status === "error" ? "!" : "",
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
    statusTone: entry.status || "pending",
    message: entry.message || "",
    command: entry.command || "",
    detail: entry.detail || "",
  })),
);

watch([sourceDatabase, targetDatabase], () => {
  if (!running.value && phase.value === "finished") {
    phase.value = "ready";
    executionMessage.value = "";
    executionMessageTone.value = "neutral";
    timeline.value = [];
    latestSummary.value = "";
    backupDir.value = "";
    logExpanded.value = shouldAutoExpandDbMigrationLog();
  }
});

function resetExecutionState() {
  phase.value = "login";
  running.value = false;
  loginMessage.value = "";
  loginMessageTone.value = "neutral";
  executionMessage.value = "";
  executionMessageTone.value = "neutral";
  availableDatabases.value = [];
  sourceDatabase.value = "";
  targetDatabase.value = "";
  timeline.value = [];
  backupDir.value = "";
  latestSummary.value = "";
  logExpanded.value = shouldAutoExpandDbMigrationLog();
  loginForm.host = "";
  loginForm.port = 3306;
  loginForm.username = "";
  loginForm.password = "";
}

function setDefaultDatabases(databases) {
  sourceDatabase.value = databases[0] || "";
  targetDatabase.value = databases.find((item) => item !== sourceDatabase.value) || "";
}

function handleResetEvent() {
  if (shouldResetDbMigrationWorkspaceOnShow({ phase: phase.value, running: running.value })) {
    resetExecutionState();
  }
}

function handleLogToggle(event) {
  logExpanded.value = Boolean(event?.target?.open);
}

async function connectServer() {
  if (!canSubmitLogin.value || connecting.value) return;
  connecting.value = true;
  loginMessage.value = "正在连接...";
  loginMessageTone.value = "running";

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
    availableDatabases.value = databases;
    setDefaultDatabases(databases);
    phase.value = "ready";
    loginMessage.value = databases.length >= 2
      ? `已连接 ${result.host}:${result.port}`
      : "已连接，但可见业务库少于 2 个";
    loginMessageTone.value = databases.length >= 2 ? "success" : "error";
    executionMessage.value = "";
    executionMessageTone.value = "neutral";
    timeline.value = [];
    backupDir.value = "";
    latestSummary.value = "";
    logExpanded.value = shouldAutoExpandDbMigrationLog();
  } catch (error) {
    loginMessage.value = String(error);
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
  timeline.value = [];
  backupDir.value = "";
  latestSummary.value = "";
  logExpanded.value = shouldAutoExpandDbMigrationLog();
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
  } catch (error) {
    executionMessage.value = String(error);
    executionMessageTone.value = "error";
    phase.value = "finished";
  } finally {
    running.value = false;
  }
}

function returnToLogin() {
  if (running.value) return;
  resetExecutionState();
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

onMounted(async () => {
  unlistenProgress = await listen("db-migration-progress", (event) => {
    timeline.value = appendDbMigrationTimeline(timeline.value, event.payload || {});
  });
  unlistenReset = await listen("db-migration-reset", () => {
    handleResetEvent();
  });
});

onBeforeUnmount(() => {
  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
  }
  if (unlistenReset) {
    unlistenReset();
    unlistenReset = null;
  }
});
</script>

<template>
  <main class="mw-root" @contextmenu.prevent>
    <header class="mw-toolbar" @pointerdown="startDragging">
      <div class="traffic-lights" @dblclick.stop @pointerdown.stop>
        <button class="traffic-btn traffic-red" title="关闭" :disabled="running" @click="closeWindow" />
        <button class="traffic-btn traffic-yellow" title="最小化" @click="minimizeWindow" />
        <button class="traffic-btn traffic-green" title="最大化或还原" @click="toggleMaximizeWindow" />
      </div>

      <div class="mw-toolbar-meta">
        <span class="mw-toolbar-title">MySQL 快速迁移</span>
        <span class="mw-toolbar-subtitle">固定快捷键 {{ FIXED_DB_MIGRATION_HOTKEY }}</span>
      </div>

      <span :class="['mw-status-badge', `is-${currentStatusTone}`]">{{ currentStatusText }}</span>
    </header>

    <section v-if="phase === 'login'" class="mw-login-shell">
      <div class="mw-login-card">
        <div class="mw-card-header">
          <h1 class="mw-card-title">连接 MySQL</h1>
          <p class="mw-card-subtitle">登录后选择源库和目标库。</p>
        </div>

        <label class="mw-field">
          <span>主机</span>
          <input v-model="loginForm.host" type="text" placeholder="127.0.0.1" />
        </label>

        <label class="mw-field">
          <span>端口</span>
          <input v-model.number="loginForm.port" type="number" min="1" placeholder="3306" />
        </label>

        <label class="mw-field">
          <span>用户名</span>
          <input v-model="loginForm.username" type="text" placeholder="请输入用户名" />
        </label>

        <label class="mw-field">
          <span>密码</span>
          <input v-model="loginForm.password" type="password" placeholder="请输入密码" />
        </label>

        <div v-if="loginMessage" :class="['mw-banner', `tone-${loginMessageTone}`]">
          {{ loginMessage }}
        </div>

        <button class="mw-primary-btn" :disabled="!canSubmitLogin || connecting" @click="connectServer">
          {{ connecting ? "连接中..." : "连接" }}
        </button>
      </div>
    </section>

    <section v-else class="mw-workspace">
      <div class="mw-surface">
        <div class="mw-page-header">
          <div class="mw-page-copy">
            <span class="mw-page-kicker">数据库迁移</span>
            <h1 class="mw-page-title">{{ workspaceHeadline }}</h1>
          </div>
          <div class="mw-page-meta">
            <span :class="['mw-status-badge', `is-${currentStatusTone}`]">{{ currentStatusText }}</span>
            <span v-if="latestSummary" class="mw-page-summary">{{ latestSummary }}</span>
          </div>
        </div>

        <div v-if="executionMessage" :class="['mw-banner', `tone-${executionMessageTone}`]">
          {{ executionMessage }}
        </div>

        <section class="mw-section">
          <div class="mw-section-head">
            <div>
              <h2 class="mw-section-title">数据库</h2>
              <p class="mw-section-subtitle">选择同一实例内的源库和目标库。</p>
            </div>
            <button class="mw-secondary-btn" :disabled="running" @click="returnToLogin">切换连接</button>
          </div>

          <div class="mw-selection-grid">
            <label class="mw-field">
              <span>源库</span>
              <select v-model="sourceDatabase" :disabled="running">
                <option value="">请选择源库</option>
                <option v-for="db in availableDatabases" :key="`source-${db}`" :value="db">
                  {{ db }}
                </option>
              </select>
            </label>

            <label class="mw-field">
              <span>目标库</span>
              <select v-model="targetDatabase" :disabled="running">
                <option value="">请选择目标库</option>
                <option v-for="db in availableDatabases" :key="`target-${db}`" :value="db">
                  {{ db }}
                </option>
              </select>
            </label>
          </div>

          <p v-if="!hasEnoughDatabases" class="mw-inline-note">
            当前账号可见业务库少于 2 个，暂时无法执行完整覆盖。
          </p>
        </section>

        <section class="mw-section">
          <div class="mw-section-head">
            <div>
              <h2 class="mw-section-title">执行</h2>
              <p class="mw-section-subtitle">先备份，再完整覆盖目标库。</p>
            </div>
          </div>

          <div class="mw-action-row">
            <button class="mw-primary-btn" :disabled="!canRunMigration || !hasEnoughDatabases" @click="confirmAndRunMigration">
              {{ running ? "迁移中..." : "开始完整覆盖" }}
            </button>
            <button class="mw-secondary-btn" :disabled="!backupDir" @click="openBackupDirectory">打开备份目录</button>
          </div>

          <div class="mw-inline-meta">
            <span class="mw-inline-pill">{{ FIXED_DB_MIGRATION_HOTKEY }}</span>
            <span class="mw-inline-text">{{ currentStatusText }}</span>
          </div>

          <div v-if="backupDir" class="mw-path-row">
            <span class="mw-path-label">备份目录</span>
            <span class="mw-path-value">{{ backupDir }}</span>
          </div>
        </section>

        <section class="mw-section">
          <div class="mw-section-head">
            <div>
              <h2 class="mw-section-title">记录</h2>
              <p class="mw-section-subtitle">步骤状态和详细日志。</p>
            </div>
          </div>

          <ul class="mw-step-list">
            <li v-for="step in pipelineView" :key="step.key" class="mw-step-item">
              <span :class="['mw-step-marker', `is-${step.status}`]">{{ step.markerText }}</span>
              <div class="mw-step-copy">
                <span class="mw-step-label">{{ step.label }}</span>
                <span v-if="step.message" class="mw-step-message">{{ step.message }}</span>
              </div>
              <span v-if="step.timeLabel" class="mw-step-time">{{ step.timeLabel }}</span>
            </li>
          </ul>

          <details
            v-if="timelineView.length > 0"
            class="mw-log-card"
            :open="logExpanded"
            @toggle="handleLogToggle"
          >
            <summary>{{ logSummaryText }}</summary>
            <ol class="mw-log-list">
              <li v-for="entry in timelineView" :key="entry.key" class="mw-log-entry">
                <div class="mw-log-head">
                  <span class="mw-log-step">{{ entry.stepLabel }}</span>
                  <span class="mw-log-time">{{ entry.timeLabel }}</span>
                  <span :class="['mw-log-status', `is-${entry.statusTone}`]">{{ entry.statusText }}</span>
                </div>
                <div v-if="entry.message" class="mw-log-message">{{ entry.message }}</div>
                <div v-if="entry.command" class="mw-log-command">{{ entry.command }}</div>
                <pre v-if="entry.detail" class="mw-log-detail">{{ entry.detail }}</pre>
              </li>
            </ol>
          </details>
        </section>
      </div>
    </section>
  </main>
</template>
