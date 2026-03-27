import { normalizeHotkeyDisplay } from "./syncWorkspace.js";

export const DEFAULT_DB_MIGRATION_WINDOW_HOTKEY = "Shift+D";
export const FIXED_DB_MIGRATION_HOTKEY = DEFAULT_DB_MIGRATION_WINDOW_HOTKEY;

export const DB_MIGRATION_SYSTEM_DATABASES = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);

export const DB_MIGRATION_PIPELINE_STEPS = [
  { key: "validate", label: "校验配置" },
  { key: "backup_source", label: "备份源库" },
  { key: "backup_target", label: "备份目标库" },
  { key: "drop_target_tables", label: "清空目标表" },
  { key: "recreate_tables", label: "重建表结构" },
  { key: "copy_data", label: "复制数据" },
  { key: "finish", label: "完成迁移" },
];

function isModifierOnlyHotkey(value) {
  const parts = String(value || "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((part) => ["ctrl", "shift", "alt", "meta"].includes(part));
}

function normalizePort(value, fallback = 3306) {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

function normalizeOptionalString(value) {
  return String(value ?? "").trim();
}

export function normalizeDbMigrationWindowHotkey(value) {
  const normalized = normalizeHotkeyDisplay(value);
  if (!normalized || isModifierOnlyHotkey(normalized)) {
    return DEFAULT_DB_MIGRATION_WINDOW_HOTKEY;
  }
  return normalized;
}

export function filterMigrationDatabaseNames(databases = []) {
  const names = Array.isArray(databases) ? databases : [];
  return [
    ...new Set(
      names
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .filter((item) => !DB_MIGRATION_SYSTEM_DATABASES.has(item.toLowerCase())),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export function appendDbMigrationTimeline(timeline = [], event = {}) {
  return [
    ...timeline,
    {
      step: String(event.step || "unknown"),
      status: String(event.status || "running"),
      message: String(event.message || ""),
      detail: event.detail ? String(event.detail) : "",
      command: event.command ? String(event.command) : "",
      path: event.path ? String(event.path) : "",
      timestamp: event.timestamp || new Date().toISOString(),
    },
  ];
}

export function shouldResetDbMigrationWorkspaceOnShow({ phase = "login", running = false } = {}) {
  if (running) return false;
  return ["login", "ready", "confirming", "finished"].includes(String(phase || "login"));
}

export function isDbMigrationSelectionReady({ sourceDatabase = "", targetDatabase = "" } = {}) {
  const source = String(sourceDatabase || "").trim();
  const target = String(targetDatabase || "").trim();
  return source.length > 0 && target.length > 0 && source !== target;
}

export function buildDbMigrationHeadline({ sourceDatabase = "", targetDatabase = "" } = {}) {
  const source = String(sourceDatabase || "").trim();
  const target = String(targetDatabase || "").trim();
  if (!source || !target) return "选择源库和目标库";
  return `${source} -> ${target}`;
}

export function shouldAutoExpandDbMigrationLog() {
  return false;
}

export function normalizeDbMigrationRememberedConnection(connection = null) {
  if (!connection || typeof connection !== "object") return null;

  const host = normalizeOptionalString(connection.host);
  const username = normalizeOptionalString(connection.username ?? connection.user);
  if (!host || !username) return null;

  return {
    host,
    port: normalizePort(connection.port),
    username,
    password: String(connection.password ?? ""),
    sourceDatabase: normalizeOptionalString(
      connection.sourceDatabase ?? connection.source_database,
    ),
    targetDatabase: normalizeOptionalString(
      connection.targetDatabase ?? connection.target_database,
    ),
  };
}

export function resolveDbMigrationSelections(databases = [], rememberedConnection = null) {
  const visibleDatabases = filterMigrationDatabaseNames(databases);
  if (visibleDatabases.length === 0) {
    return {
      sourceDatabase: "",
      targetDatabase: "",
    };
  }

  const requestedSource = normalizeOptionalString(
    rememberedConnection?.sourceDatabase ?? rememberedConnection?.source_database,
  );
  const requestedTarget = normalizeOptionalString(
    rememberedConnection?.targetDatabase ?? rememberedConnection?.target_database,
  );

  let sourceDatabase = visibleDatabases.includes(requestedSource)
    ? requestedSource
    : visibleDatabases[0] || "";

  let targetDatabase = visibleDatabases.includes(requestedTarget) && requestedTarget !== sourceDatabase
    ? requestedTarget
    : visibleDatabases.find((item) => item !== sourceDatabase) || "";

  if (!sourceDatabase && targetDatabase) {
    sourceDatabase = visibleDatabases.find((item) => item !== targetDatabase) || targetDatabase;
  }

  return {
    sourceDatabase,
    targetDatabase,
  };
}

export function extractDbMigrationJsonConfig(parsed) {
  const dbConfig = parsed?.db && typeof parsed.db === "object" ? parsed.db : parsed;
  if (!dbConfig || typeof dbConfig !== "object") return null;

  const host = normalizeOptionalString(dbConfig.host);
  const username = normalizeOptionalString(dbConfig.username ?? dbConfig.user);
  if (!host || !username) return null;

  return {
    host,
    port: normalizePort(dbConfig.port),
    username,
    password: String(dbConfig.password ?? ""),
    sourceDatabase: normalizeOptionalString(
      parsed?.sourceDatabase ?? parsed?.source_database ?? dbConfig.sourceDatabase ?? dbConfig.source_database,
    ),
    targetDatabase: normalizeOptionalString(
      parsed?.targetDatabase ?? parsed?.target_database ?? dbConfig.targetDatabase ?? dbConfig.target_database,
    ),
  };
}
