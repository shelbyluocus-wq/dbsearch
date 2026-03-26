export const FIXED_DB_MIGRATION_HOTKEY = "Shift+D";

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
