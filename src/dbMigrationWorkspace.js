import { normalizeHotkeyDisplay } from "./syncWorkspace.js";

export const DEFAULT_DB_MIGRATION_WINDOW_HOTKEY = "Shift+D";
export const FIXED_DB_MIGRATION_HOTKEY = DEFAULT_DB_MIGRATION_WINDOW_HOTKEY;
const DB_MIGRATION_PROFILE_ID_PREFIX = "db-migration-profile-";

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

function buildDbMigrationProfileId(index = 0) {
  return `${DB_MIGRATION_PROFILE_ID_PREFIX}${index + 1}`;
}

function buildDbMigrationProfileName(profile = {}, index = 0) {
  const sourceDatabase = normalizeOptionalString(
    profile?.sourceDatabase ?? profile?.source_database,
  );
  const targetDatabase = normalizeOptionalString(
    profile?.targetDatabase ?? profile?.target_database,
  );
  if (sourceDatabase && targetDatabase) {
    return `${sourceDatabase} -> ${targetDatabase}`;
  }

  const host = normalizeOptionalString(profile?.host);
  if (host) {
    return `${host}:${normalizePort(profile?.port)}`;
  }

  return `\u8fc1\u79fb\u6a21\u677f ${index + 1}`;
}

function getNextDbMigrationProfileNumber(profiles = []) {
  const numbers = (Array.isArray(profiles) ? profiles : [])
    .map((profile) => String(profile?.id || "").trim())
    .map((id) => {
      const match = id.match(/^db-migration-profile-(\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter((value) => Number.isInteger(value) && value > 0);

  return (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
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

export function normalizeDbMigrationProfile(profile = {}, index = 0) {
  return {
    id: normalizeOptionalString(profile?.id) || buildDbMigrationProfileId(index),
    name: normalizeOptionalString(profile?.name) || buildDbMigrationProfileName(profile, index),
    host: normalizeOptionalString(profile?.host),
    port: normalizePort(profile?.port),
    username: normalizeOptionalString(profile?.username ?? profile?.user),
    password: String(profile?.password ?? ""),
    sourceDatabase: normalizeOptionalString(
      profile?.sourceDatabase ?? profile?.source_database,
    ),
    targetDatabase: normalizeOptionalString(
      profile?.targetDatabase ?? profile?.target_database,
    ),
  };
}

export function resolveDbMigrationProfileSelection(
  profiles,
  { lastUsedProfileId = "" } = {},
) {
  const ids = new Set((profiles || []).map((profile) => profile.id));
  if (lastUsedProfileId && ids.has(lastUsedProfileId)) {
    return lastUsedProfileId;
  }
  return profiles?.[0]?.id || "";
}

export function normalizeDbMigrationWorkspaceState(state = {}) {
  const profileCandidates = Array.isArray(state?.profiles)
    ? state.profiles
    : [];
  const normalizedProfiles = profileCandidates
    .map((profile, index) => normalizeDbMigrationProfile(profile, index));

  const legacyRememberedConnection =
    normalizedProfiles.length === 0
      ? normalizeDbMigrationRememberedConnection(
        state?.rememberedConnection ?? state?.remembered_connection,
      )
      : null;

  const profiles = normalizedProfiles.length > 0
    ? normalizedProfiles
    : legacyRememberedConnection
      ? [normalizeDbMigrationProfile(legacyRememberedConnection, 0)]
      : [];

  return {
    hotkey: normalizeDbMigrationWindowHotkey(state?.hotkey),
    profiles,
    lastUsedProfileId: resolveDbMigrationProfileSelection(profiles, {
      lastUsedProfileId: normalizeOptionalString(
        state?.lastUsedProfileId ?? state?.last_used_profile_id,
      ),
    }),
  };
}

export function createDbMigrationProfileDraft(existingProfiles = [], seed = {}) {
  const nextNumber = getNextDbMigrationProfileNumber(existingProfiles);
  return normalizeDbMigrationProfile(
    {
      ...seed,
      id: `${DB_MIGRATION_PROFILE_ID_PREFIX}${nextNumber}`,
    },
    nextNumber - 1,
  );
}

export function applyImportedDbMigrationProfileDraft(profile = {}, imported = null, index = 0) {
  const baseProfile = normalizeDbMigrationProfile(profile, index);
  if (!imported || typeof imported !== "object") {
    return baseProfile;
  }

  return normalizeDbMigrationProfile(
    {
      ...baseProfile,
      ...imported,
      id: baseProfile.id,
      name: normalizeOptionalString(profile?.name),
    },
    index,
  );
}

export function isDbMigrationProfileConnectionReady(profile = {}) {
  const normalized = normalizeDbMigrationProfile(profile);
  return Boolean(normalized.host && normalized.username);
}

export function describeDbMigrationProfile(profile = {}, index = 0) {
  const normalized = normalizeDbMigrationProfile(profile, index);
  if (normalized.sourceDatabase && normalized.targetDatabase) {
    return `${normalized.sourceDatabase} -> ${normalized.targetDatabase}`;
  }
  if (normalized.host) {
    return `${normalized.host}:${normalized.port}`;
  }
  return "\u672a\u5b8c\u6210\u914d\u7f6e";
}

export function isSameDbMigrationConnection(left = {}, right = {}) {
  const normalizedLeft = normalizeDbMigrationProfile(left);
  const normalizedRight = normalizeDbMigrationProfile(right);
  return normalizedLeft.host === normalizedRight.host
    && normalizedLeft.port === normalizedRight.port
    && normalizedLeft.username === normalizedRight.username
    && normalizedLeft.password === normalizedRight.password;
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
