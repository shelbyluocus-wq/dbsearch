const DEFAULT_SYNC_WINDOW_HOTKEY = "Ctrl+Alt+S";
const STATUS_LABELS = {
  idle: "未执行",
  running: "进行中",
  success: "上次成功",
  error: "上次失败",
};

function normalizeHotkeyToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "ctrl" || lower === "control") return "Ctrl";
  if (lower === "shift") return "Shift";
  if (lower === "alt" || lower === "option") return "Alt";
  if (lower === "meta" || lower === "super" || lower === "win" || lower === "command" || lower === "cmd") {
    return "Meta";
  }
  if (lower.length === 1) return lower.toUpperCase();
  if (lower.startsWith("f") && lower.slice(1).match(/^\d+$/)) {
    return `F${lower.slice(1)}`;
  }
  if (lower.startsWith("arrow")) {
    return `Arrow${lower.slice(5, 6).toUpperCase()}${lower.slice(6)}`;
  }
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

function normalizeHotkeyDisplay(value) {
  return String(value || "")
    .split("+")
    .map((part) => normalizeHotkeyToken(part))
    .filter(Boolean)
    .join("+");
}

function isModifierOnlyHotkey(value) {
  const parts = String(value || "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((part) => ["ctrl", "shift", "alt", "meta"].includes(part));
}

function normalizeRunStatus(value) {
  return ["idle", "running", "success", "error"].includes(value) ? value : "idle";
}

function normalizeSyncProfile(profile, index) {
  const nextIndex = index + 1;
  return {
    id: String(profile?.id || `sync-profile-${nextIndex}`),
    name: String(profile?.name || "").trim() || `同步配置 ${nextIndex}`,
    script_executable_path: String(profile?.script_executable_path || ""),
    output_root: String(profile?.output_root || ""),
    target_path: String(profile?.target_path || ""),
    last_run_status: normalizeRunStatus(profile?.last_run_status),
    last_run_at: profile?.last_run_at ? String(profile.last_run_at) : "",
    last_run_summary: profile?.last_run_summary ? String(profile.last_run_summary) : "",
  };
}

export function normalizeSyncWindowHotkey(value) {
  const normalized = normalizeHotkeyDisplay(value);
  if (!normalized || isModifierOnlyHotkey(normalized)) {
    return DEFAULT_SYNC_WINDOW_HOTKEY;
  }
  return normalized;
}

export function normalizeSyncWorkspaceSettings(personal = {}) {
  const profiles = Array.isArray(personal.sync_profiles)
    ? personal.sync_profiles.map((profile, index) => normalizeSyncProfile(profile, index))
    : [];

  return {
    syncWindowHotkey: normalizeSyncWindowHotkey(personal.sync_window_hotkey),
    profiles,
    defaultProfileId: personal.default_sync_profile_id ? String(personal.default_sync_profile_id) : "",
    lastUsedProfileId: personal.last_used_sync_profile_id ? String(personal.last_used_sync_profile_id) : "",
  };
}

export function resolveSyncProfileSelection(
  profiles,
  { lastUsedProfileId = "", defaultProfileId = "" } = {},
) {
  const ids = new Set((profiles || []).map((profile) => profile.id));
  if (lastUsedProfileId && ids.has(lastUsedProfileId)) return lastUsedProfileId;
  if (defaultProfileId && ids.has(defaultProfileId)) return defaultProfileId;
  return profiles?.[0]?.id || "";
}

export function describeSyncProfileCard(profile, { defaultProfileId = "" } = {}) {
  const parts = [];
  if (profile?.id && profile.id === defaultProfileId) {
    parts.push("默认配置");
  }
  parts.push(STATUS_LABELS[normalizeRunStatus(profile?.last_run_status)] || STATUS_LABELS.idle);
  if (profile?.last_run_summary) {
    parts.push(profile.last_run_summary);
  }
  if (profile?.target_path) {
    parts.push(profile.target_path);
  }
  return parts.join(" · ");
}

export function reduceSyncTimeline(timeline = [], event = {}) {
  return [
    ...timeline,
    {
      step: event.step || "unknown",
      status: event.status || "running",
      message: event.message || "",
      detail: event.detail || "",
      command: event.command || "",
      path: event.path || "",
      timestamp: event.timestamp || new Date().toISOString(),
    },
  ];
}
