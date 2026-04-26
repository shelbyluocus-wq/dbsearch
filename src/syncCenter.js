const SYNC_CENTER_MODES = new Set(["file", "database"]);

const MODE_ALIASES = {
  sync: "file",
  sync_center: "file",
  file_sync: "file",
  files: "file",
  db: "database",
  db_sync: "database",
  migration: "database",
  db_migration: "database",
};

export const SYNC_CENTER_SIDEBAR_WIDTH = {
  min: 280,
  max: 460,
  default: 320,
};

export function normalizeSyncCenterMode(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  const aliased = MODE_ALIASES[normalized] || MODE_ALIASES[raw] || normalized;
  return SYNC_CENTER_MODES.has(aliased) ? aliased : "file";
}

export function shouldShowSyncCenterLogDrawer({ manualOpen = false, running = false } = {}) {
  return Boolean(manualOpen || running);
}

export function normalizeSyncCenterSidebarWidth(value) {
  const width = Math.round(Number(value));
  if (!Number.isFinite(width)) return SYNC_CENTER_SIDEBAR_WIDTH.default;
  return Math.min(
    SYNC_CENTER_SIDEBAR_WIDTH.max,
    Math.max(SYNC_CENTER_SIDEBAR_WIDTH.min, width),
  );
}

export function normalizeSyncCenterSidebarCollapsed(value) {
  return value === true || value === "1" || value === "true";
}

export function resolveSyncCenterSectionToggle(section, currentMode, collapsedState = {}) {
  const nextMode = normalizeSyncCenterMode(section);
  const current = normalizeSyncCenterMode(currentMode);
  const collapsed = {
    database: Boolean(collapsedState.database),
    file: Boolean(collapsedState.file),
  };

  if (nextMode !== current) {
    return {
      mode: nextMode,
      collapsed: {
        ...collapsed,
        [nextMode]: false,
      },
    };
  }

  return {
    mode: nextMode,
    collapsed: {
      ...collapsed,
      [nextMode]: !collapsed[nextMode],
    },
  };
}
