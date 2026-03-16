const DEFAULT_SYNC_WINDOW_HOTKEY = "Shift+S";
const STATUS_LABELS = {
  idle: "未执行",
  running: "进行中",
  success: "上次成功",
  error: "上次失败",
};

const HOTKEY_ALIASES = {
  "?": "/",
  _: "-",
  "+": "=",
  ":": ";",
  "\"": "'",
  "<": ",",
  ">": ".",
  "{": "[",
  "}": "]",
  "|": "\\",
  "~": "`",
  slash: "/",
  question: "/",
  backslash: "\\",
  pipe: "\\",
  semicolon: ";",
  colon: ";",
  quote: "'",
  apostrophe: "'",
  comma: ",",
  lessthan: ",",
  period: ".",
  dot: ".",
  greaterthan: ".",
  minus: "-",
  underscore: "-",
  dash: "-",
  hyphen: "-",
  equal: "=",
  equals: "=",
  plus: "=",
  bracketleft: "[",
  leftbracket: "[",
  braceleft: "[",
  bracketright: "]",
  rightbracket: "]",
  braceright: "]",
  backquote: "`",
  grave: "`",
};

function resolveHotkeyAlias(token) {
  const normalized = String(token || "").trim().toLowerCase();
  return HOTKEY_ALIASES[normalized] || "";
}

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

  const aliased = resolveHotkeyAlias(lower) || resolveHotkeyAlias(raw);
  if (aliased) return aliased;

  if (/^f\d+$/i.test(raw)) return raw.toUpperCase();
  if (raw.length === 1 && /[a-z0-9]/i.test(raw)) return raw.toUpperCase();

  const named = {
    escape: "Esc",
    esc: "Esc",
    enter: "Enter",
    tab: "Tab",
    space: "Space",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    insert: "Insert",
    ins: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
  };

  return named[lower] || `${raw.slice(0, 1).toUpperCase()}${raw.slice(1)}`;
}

export function normalizeHotkeyDisplay(value) {
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

function mapEventKeyToHotkey(event = {}) {
  const key = String(event.key || "");
  const code = String(event.code || "");
  const lower = key.toLowerCase();
  const lowerCode = code.toLowerCase();

  if (["control", "shift", "alt", "meta", "os"].includes(lower)) {
    return "";
  }

  const aliased = resolveHotkeyAlias(lower) || resolveHotkeyAlias(lowerCode);
  if (aliased) return aliased;

  if (/^f\d+$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) {
    if (key === " ") return "Space";
    if (/[a-z0-9]/i.test(key)) return key.toUpperCase();
  }

  return normalizeHotkeyToken(code || key);
}

export function buildHotkeyFromEvent(event = {}) {
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  const key = mapEventKeyToHotkey(event);
  const shiftedSymbolChars = new Set(["?", "_", "+", ":", "\"", "<", ">", "|", "~"]);
  const shouldFoldShift = event.shiftKey
    && shiftedSymbolChars.has(String(event.key || ""))
    && /^[^\w\s]$/.test(key);
  if (event.shiftKey && !shouldFoldShift) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  if (key) parts.push(key);
  return normalizeHotkeyDisplay(parts.join("+"));
}

export function isEventMatchingHotkey(event, hotkey) {
  const target = normalizeHotkeyDisplay(hotkey);
  if (!target) return false;
  return buildHotkeyFromEvent(event) === target;
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

export function resolveSyncTargetDirectoryOpenRequest(targetPath) {
  const path = String(targetPath || "").trim();
  if (!path) return null;
  return {
    method: "invoke",
    command: "open_directory_in_explorer",
    path,
  };
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

export function appendTimelineByProfile(timelineByProfile = {}, event = {}) {
  const profileId = String(event.profileId || event.profile_id || "").trim();
  if (!profileId) return { ...timelineByProfile };
  return {
    ...timelineByProfile,
    [profileId]: reduceSyncTimeline(timelineByProfile[profileId] || [], event),
  };
}

export function getTimelineForProfile(timelineByProfile = {}, profileId = "") {
  const key = String(profileId || "").trim();
  if (!key) return [];
  return Array.isArray(timelineByProfile[key]) ? timelineByProfile[key] : [];
}
